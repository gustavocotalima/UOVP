import { NextResponse } from "next/server";
import { z } from "zod";
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

async function cleanupWebhookEvents(userId: string, now: Date) {
  await prisma.pluggyWebhookEvent.deleteMany({
    where: {
      userId,
      OR: [
        {
          event: { not: "item/deleted" },
          processedAt: { lt: new Date(now.getTime() - PROCESSED_EVENT_RETENTION_MS) },
        },
        {
          processedAt: null,
          createdAt: { lt: new Date(now.getTime() - FAILED_EVENT_RETENTION_MS) },
        },
      ],
    },
  });
}

async function claimEvent(userId: string, payload: z.infer<typeof webhookSchema>) {
  const now = new Date();
  await cleanupWebhookEvents(userId, now);

  const existing = await prisma.pluggyWebhookEvent.findUnique({
    where: { userId_eventId: { userId, eventId: payload.eventId } },
  });
  if (existing?.processedAt || (existing?.attempts ?? 0) >= MAX_EVENT_ATTEMPTS) return null;

  if (!existing) {
    const [pending, retained] = await Promise.all([
      prisma.pluggyWebhookEvent.count({ where: { userId, processedAt: null } }),
      prisma.pluggyWebhookEvent.count({ where: { userId } }),
    ]);
    if (
      pending >= MAX_PENDING_PLUGGY_WEBHOOK_EVENTS
      || retained >= MAX_RETAINED_PLUGGY_WEBHOOK_EVENTS
    ) {
      throw new WebhookQuotaError(60 * 60);
    }
  }

  const created = await prisma.pluggyWebhookEvent.createMany({
    data: [
      {
        userId,
        eventId: payload.eventId,
        event: payload.event,
        itemId: payload.itemId ?? null,
        processingStartedAt: now,
        attempts: 1,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count) {
    return prisma.pluggyWebhookEvent.findUniqueOrThrow({
      where: { userId_eventId: { userId, eventId: payload.eventId } },
    });
  }

  const duplicate = existing ?? await prisma.pluggyWebhookEvent.findUnique({
    where: { userId_eventId: { userId, eventId: payload.eventId } },
  });
  if (duplicate?.processedAt || (duplicate?.attempts ?? 0) >= MAX_EVENT_ATTEMPTS) return null;
  const staleBefore = new Date(now.getTime() - 5 * 60_000);
  const claimed = await prisma.pluggyWebhookEvent.updateMany({
    where: {
      eventId: payload.eventId,
      userId,
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
    ? prisma.pluggyWebhookEvent.findUniqueOrThrow({
        where: { userId_eventId: { userId, eventId: payload.eventId } },
      })
    : null;
}

export async function POST(request: Request) {
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
    return NextResponse.json({ error: "Falha temporária ao processar o webhook." }, { status: 500 });
  }
}
