import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { markPluggyItemDisconnected } from "@/features/open-finance/disconnection";
import {
  requirePluggyWebhookSecret,
  rotatePluggyWebhookSecretEncryption,
} from "@/features/open-finance/pluggy-credentials";
import { registerPluggyItemForUser } from "@/features/open-finance/sync";
import {
  assertUserOperationRateLimit,
  OperationRateLimitError,
} from "@/lib/operation-security";
import { clientIpFromHeaders, consumeAuthRateLimit } from "@/lib/auth-security";
import { prisma } from "@/lib/prisma";
import { secretsMatch } from "@/lib/request-security";

export const MAX_PLUGGY_WEBHOOK_BODY_BYTES = 256 * 1_024;
export const MAX_PENDING_PLUGGY_WEBHOOK_EVENTS = 100;
export const MAX_RETAINED_PLUGGY_WEBHOOK_EVENTS = 10_000;

const MAX_EVENT_ATTEMPTS = 12;
const FAILED_EVENT_RETENTION_MS = 24 * 60 * 60_000;
const PROCESSED_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const PLUGGY_DATA_EVENTS = [
  "item/created",
  "item/updated",
  "item/deleted",
  "item/error",
  "item/waiting_user_input",
  "item/waiting_user_action",
  "item/login_succeeded",
  "transactions/created",
  "transactions/updated",
  "transactions/deleted",
] as const;

const webhookSchema = z
  .object({
    event: z.enum(PLUGGY_DATA_EVENTS),
    eventId: z.string().uuid(),
    itemId: z.string().uuid(),
    clientUserId: z.string().min(1).max(128).optional().nullable(),
    id: z.string().uuid().optional(),
    triggeredBy: z.enum(["USER", "CLIENT", "SYNC", "INTERNAL"]).optional(),
    accountId: z.string().uuid().optional(),
    transactionIds: z.array(z.string().uuid()).max(5_000).optional(),
    transactionsCount: z.number().int().nonnegative().max(1_000_000).optional(),
    transactionsMinDate: z.string().datetime().optional(),
    transactionsCreatedAtFrom: z.string().datetime().optional(),
    createdTransactionsLink: z.string().url().max(2_048).optional(),
    error: z
      .object({
        code: z.string().max(200).optional(),
        message: z.string().max(2_000).optional(),
        parameter: z.string().max(200).optional(),
      })
      .strip()
      .optional(),
  })
  .strict();

class WebhookRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WebhookRequestError";
  }
}

class WebhookQuotaError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("O limite de eventos pendentes deste webhook foi atingido.");
    this.name = "WebhookQuotaError";
  }
}

async function readLimitedJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new WebhookRequestError(415, "O webhook precisa enviar JSON.");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PLUGGY_WEBHOOK_BODY_BYTES) {
      throw new WebhookRequestError(413, "O evento excede o tamanho permitido.");
    }
  }

  if (!request.body) throw new WebhookRequestError(400, "Evento inválido.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_PLUGGY_WEBHOOK_BODY_BYTES) {
        await reader.cancel();
        throw new WebhookRequestError(413, "O evento excede o tamanho permitido.");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new WebhookRequestError(400, "Evento inválido.");
  }
}

async function claimEvent(userId: string, payload: z.infer<typeof webhookSchema>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.pluggyWebhookEvent.deleteMany({
          where: {
            userId,
            OR: [
              { processedAt: { lt: new Date(now.getTime() - PROCESSED_EVENT_RETENTION_MS) } },
              {
                processedAt: null,
                createdAt: { lt: new Date(now.getTime() - FAILED_EVENT_RETENTION_MS) },
              },
            ],
          },
        });
        const existing = await tx.pluggyWebhookEvent.findUnique({
          where: { userId_eventId: { userId, eventId: payload.eventId } },
        });
        if (existing?.processedAt || (existing?.attempts ?? 0) >= MAX_EVENT_ATTEMPTS) return null;
        if (!existing) {
          const [pending, retained] = await Promise.all([
            tx.pluggyWebhookEvent.count({ where: { userId, processedAt: null } }),
            tx.pluggyWebhookEvent.count({ where: { userId } }),
          ]);
          if (
            pending >= MAX_PENDING_PLUGGY_WEBHOOK_EVENTS
            || retained >= MAX_RETAINED_PLUGGY_WEBHOOK_EVENTS
          ) {
            throw new WebhookQuotaError(60 * 60);
          }
          return tx.pluggyWebhookEvent.create({
            data: {
              userId,
              eventId: payload.eventId,
              event: payload.event,
              itemId: payload.itemId ?? null,
              processingStartedAt: now,
              attempts: 1,
            },
          });
        }
        const staleBefore = new Date(now.getTime() - 5 * 60_000);
        const claimed = await tx.pluggyWebhookEvent.updateMany({
          where: {
            id: existing.id,
            processedAt: null,
            attempts: { lt: MAX_EVENT_ATTEMPTS },
            OR: [
              { processingStartedAt: null },
              { processingStartedAt: { lt: staleBefore } },
            ],
          },
          data: {
            processingStartedAt: now,
            attempts: { increment: 1 },
            lastError: null,
          },
        });
        return claimed.count
          ? tx.pluggyWebhookEvent.findUniqueOrThrow({ where: { id: existing.id } })
          : null;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 2) throw error;
    }
  }
  return null;
}

async function assertWebhookPreAuthRateLimit(request: Request) {
  const secretFingerprint = request.headers.get("x-pluggy-webhook-secret")?.slice(0, 1_024) || "missing";
  const ip = clientIpFromHeaders(request.headers);
  const results = await Promise.all([
    consumeAuthRateLimit({
      scope: "pluggy-webhook-preauth-global",
      identifier: "application",
      limit: 3_000,
      windowMs: 5 * 60_000,
      blockMs: 5 * 60_000,
    }),
    consumeAuthRateLimit({
      scope: "pluggy-webhook-preauth-secret",
      identifier: secretFingerprint,
      limit: 600,
      windowMs: 5 * 60_000,
      blockMs: 5 * 60_000,
    }),
    ip
      ? consumeAuthRateLimit({
          scope: "pluggy-webhook-preauth-ip",
          identifier: ip,
          limit: 1_000,
          windowMs: 5 * 60_000,
          blockMs: 5 * 60_000,
        })
      : Promise.resolve({ allowed: true, retryAfterMs: 0 }),
  ]);
  const blocked = results.find((result) => !result.allowed);
  if (blocked) {
    throw new OperationRateLimitError(Math.max(1, Math.ceil(blocked.retryAfterMs / 1_000)));
  }
}

export async function POST(request: Request) {
  try {
    await assertWebhookPreAuthRateLimit(request);
  } catch (error) {
    if (error instanceof OperationRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    throw error;
  }
  let rawPayload: unknown;
  try {
    rawPayload = await readLimitedJson(request);
  } catch (error) {
    if (error instanceof WebhookRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Evento inválido." }, { status: 400 });
  }
  const payload = webhookSchema.safeParse(rawPayload);
  if (!payload.success) return NextResponse.json({ error: "Evento inválido." }, { status: 400 });

  const existing = await prisma.pluggyItem.findUnique({
    where: { pluggyItemId: payload.data.itemId },
    select: { userId: true },
  });
  if (
    existing
    && payload.data.clientUserId
    && existing.userId !== payload.data.clientUserId
  ) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const userId = existing?.userId ?? payload.data.clientUserId;
  if (!userId) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  let configuredSecret: string;
  try {
    configuredSecret = await requirePluggyWebhookSecret(userId, { rotate: false });
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!secretsMatch(request.headers.get("x-pluggy-webhook-secret"), configuredSecret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  await rotatePluggyWebhookSecretEncryption(userId).catch(() => undefined);

  if (!existing && payload.data.event !== "item/created") {
    return NextResponse.json({ received: true, linked: false });
  }

  let event: Awaited<ReturnType<typeof claimEvent>>;
  try {
    await assertUserOperationRateLimit({
      userId,
      operation: "pluggy-webhook",
      limit: 300,
      windowMs: 5 * 60_000,
    });
    event = await claimEvent(userId, payload.data);
  } catch (error) {
    if (error instanceof OperationRateLimitError || error instanceof WebhookQuotaError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    throw error;
  }
  if (!event) {
    const duplicate = await prisma.pluggyWebhookEvent.findUnique({
      where: { userId_eventId: { userId, eventId: payload.data.eventId } },
      select: { processedAt: true },
    });
    if (duplicate?.processedAt) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json(
      { error: "Evento ainda em processamento." },
      { status: 409, headers: { "Retry-After": "5" } },
    );
  }

  try {
    if (payload.data.event === "item/deleted") {
      await markPluggyItemDisconnected(payload.data.itemId);
      await prisma.pluggyWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), processingStartedAt: null },
      });
      return NextResponse.json({ received: true });
    }

    if (payload.data.event === "transactions/deleted") {
      const account = payload.data.accountId
        ? await prisma.pluggyAccount.findFirst({
            where: {
              pluggyAccountId: payload.data.accountId,
              item: { pluggyItemId: payload.data.itemId, userId },
            },
            select: { id: true },
          })
        : null;
      if (payload.data.accountId && !account) {
        throw new WebhookRequestError(400, "Conta do evento não pertence ao item informado.");
      }
      const transactionIds = [...new Set(payload.data.transactionIds ?? [])];
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        if (transactionIds.length && account) {
          const ownedRows = await tx.pluggyTransaction.findMany({
            where: {
              pluggyAccountDbId: account.id,
              pluggyTransactionId: { in: transactionIds },
            },
            select: { pluggyTransactionId: true },
          });
          const ownedIds = ownedRows.map((row) => row.pluggyTransactionId);
          if (ownedIds.length) {
            await tx.pluggyTransaction.updateMany({
              where: {
                pluggyAccountDbId: account.id,
                pluggyTransactionId: { in: ownedIds },
              },
              data: { providerAvailable: false, providerRemovedAt: now },
            });
            await tx.financeTransaction.updateMany({
              where: {
                userId,
                source: "PLUGGY",
                externalId: { in: ownedIds },
                providerLifecycle: { not: "REMOVED" },
              },
              data: {
                providerLifecycle: "DELETION_PENDING",
                providerDeletedAt: now,
                deleted: false,
              },
            });
          }
        }
        await tx.pluggyItem.updateMany({
          where: { pluggyItemId: payload.data.itemId, userId },
          data: { syncPending: true },
        });
        await tx.pluggyWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: now, processingStartedAt: null },
        });
      });
      return NextResponse.json({ received: true, linked: true });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      await prisma.pluggyWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), processingStartedAt: null },
      });
      return NextResponse.json({ received: true, linked: false });
    }
    const item = await registerPluggyItemForUser(user.id, payload.data.itemId);
    if (item.status === "DELETED") {
      await markPluggyItemDisconnected(payload.data.itemId);
      await prisma.pluggyWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), processingStartedAt: null },
      });
      return NextResponse.json({ received: true, linked: true });
    }
    await prisma.$transaction([
      prisma.pluggyItem.update({ where: { id: item.id }, data: { syncPending: true } }),
      prisma.pluggyWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), processingStartedAt: null },
      }),
    ]);
    return NextResponse.json({ received: true, linked: true });
  } catch (error) {
    await prisma.pluggyWebhookEvent.update({
      where: { id: event.id },
      data: {
        processingStartedAt: null,
        lastError: error instanceof Error ? error.message.slice(0, 2_000) : "Falha desconhecida.",
      },
    }).catch(() => undefined);
    if (error instanceof WebhookRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Falha temporária ao processar o webhook." }, { status: 500 });
  }
}
