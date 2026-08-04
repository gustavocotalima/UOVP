import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/pluggy/webhook/route";
import { MAX_PENDING_PLUGGY_WEBHOOK_EVENTS } from "@/features/open-finance/webhook-limits";
import { storePluggyWebhookSecret } from "@/features/open-finance/pluggy-credentials";
import { clearAuthRateLimit } from "@/lib/auth-security";

const enabled = Boolean(
  process.env.DATABASE_URL
  && process.env.CREDENTIAL_ENCRYPTION_KEYS
  && process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY
  && (process.env.AUTH_RATE_LIMIT_PEPPER || process.env.AUTH_SECRET),
);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

function webhookRequest(
  payload: {
    event: string;
    eventId: string;
    itemId: string;
    clientUserId?: string;
  },
  secret: string,
) {
  return new Request("http://localhost/api/pluggy/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pluggy-webhook-secret": secret,
    },
    body: JSON.stringify(payload),
  });
}

suite("webhook Pluggy isolado por usuário", () => {
  const firstSecret = `first-${randomUUID()}-${randomUUID()}`;
  const secondSecret = `second-${randomUUID()}-${randomUUID()}`;
  let firstUserId = "";
  let secondUserId = "";
  let firstItemId = "";
  let firstIsolationItemId = "";
  let secondItemId = "";

  beforeAll(async () => {
    const suffix = randomUUID();
    const [first, second] = await Promise.all([
      db!.user.create({ data: { email: `webhook-a-${suffix}@example.com` } }),
      db!.user.create({ data: { email: `webhook-b-${suffix}@example.com` } }),
    ]);
    firstUserId = first.id;
    secondUserId = second.id;
    firstItemId = randomUUID();
    firstIsolationItemId = randomUUID();
    secondItemId = randomUUID();
    await Promise.all([
      storePluggyWebhookSecret(firstUserId, firstSecret),
      storePluggyWebhookSecret(secondUserId, secondSecret),
      db!.pluggyItem.createMany({
        data: [
          {
            userId: firstUserId,
            pluggyItemId: firstItemId,
            connectorName: "Banco do webhook",
            status: "UPDATED",
          },
          {
            userId: firstUserId,
            pluggyItemId: firstIsolationItemId,
            connectorName: "Banco A isolado",
            status: "UPDATED",
          },
          {
            userId: secondUserId,
            pluggyItemId: secondItemId,
            connectorName: "Banco B isolado",
            status: "UPDATED",
          },
        ],
      }),
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await Promise.all([
      clearAuthRateLimit("operation-pluggy-webhook", firstUserId),
      clearAuthRateLimit("operation-pluggy-webhook", secondUserId),
    ]);
    await db.user.deleteMany({ where: { id: { in: [firstUserId, secondUserId] } } });
    await db.$disconnect();
  });

  it("recusa segredo incorreto sem registrar o evento", async () => {
    const eventId = randomUUID();
    const response = await POST(webhookRequest({
      event: "item/updated",
      eventId,
      itemId: firstItemId,
      clientUserId: firstUserId,
    }, secondSecret));

    expect(response.status).toBe(401);
    expect(await db!.pluggyWebhookEvent.count({
      where: { userId: firstUserId, eventId },
    })).toBe(0);
  });

  it("recusa clientUserId conflitante com o proprietário do item", async () => {
    const eventId = randomUUID();
    const response = await POST(webhookRequest({
      event: "item/updated",
      eventId,
      itemId: firstItemId,
      clientUserId: secondUserId,
    }, firstSecret));

    expect(response.status).toBe(401);
    expect(await db!.pluggyWebhookEvent.count({ where: { eventId } })).toBe(0);
  });

  it("aceita o segredo correto e trata a reentrega como duplicata", async () => {
    const payload = {
      event: "item/deleted",
      eventId: randomUUID(),
      itemId: firstItemId,
      clientUserId: firstUserId,
    };
    const firstResponse = await POST(webhookRequest(payload, firstSecret));
    const replayResponse = await POST(webhookRequest(payload, firstSecret));

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({ received: true });
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual({ received: true, duplicate: true });
    expect(await db!.pluggyWebhookEvent.count({
      where: { userId: firstUserId, eventId: payload.eventId },
    })).toBe(1);
  });

  it("isola o mesmo eventId entre duas aplicações Pluggy", async () => {
    const eventId = randomUUID();
    const [firstResponse, secondResponse] = await Promise.all([
      POST(webhookRequest({
        event: "item/deleted",
        eventId,
        itemId: firstIsolationItemId,
        clientUserId: firstUserId,
      }, firstSecret)),
      POST(webhookRequest({
        event: "item/deleted",
        eventId,
        itemId: secondItemId,
        clientUserId: secondUserId,
      }, secondSecret)),
    ]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(await db!.pluggyWebhookEvent.count({ where: { eventId } })).toBe(2);
  });

  it("aplica retenção finita a falhas e eventos processados, inclusive exclusões", async () => {
    const now = Date.now();
    const staleFailureId = randomUUID();
    const retainedDeletionId = randomUUID();
    const expiredUpdateId = randomUUID();
    await db!.pluggyWebhookEvent.createMany({
      data: [
        {
          userId: firstUserId,
          eventId: staleFailureId,
          event: "item/error",
          itemId: firstItemId,
          attempts: 9,
          createdAt: new Date(now - 25 * 60 * 60_000),
        },
        {
          userId: firstUserId,
          eventId: retainedDeletionId,
          event: "item/deleted",
          itemId: firstItemId,
          attempts: 1,
          processedAt: new Date(now - 31 * 24 * 60 * 60_000),
          createdAt: new Date(now - 31 * 24 * 60 * 60_000),
        },
        {
          userId: firstUserId,
          eventId: expiredUpdateId,
          event: "item/updated",
          itemId: firstItemId,
          attempts: 1,
          processedAt: new Date(now - 31 * 24 * 60 * 60_000),
          createdAt: new Date(now - 31 * 24 * 60 * 60_000),
        },
      ],
    });

    const response = await POST(webhookRequest({
      event: "item/deleted",
      eventId: randomUUID(),
      itemId: firstItemId,
      clientUserId: firstUserId,
    }, firstSecret));

    expect(response.status).toBe(200);
    const retained = await db!.pluggyWebhookEvent.findMany({
      where: { eventId: { in: [staleFailureId, retainedDeletionId, expiredUpdateId] } },
      select: { eventId: true },
    });
    expect(retained.map((event) => event.eventId)).toEqual([]);
  });

  it("limita a quantidade de eventos pendentes de um usuário", async () => {
    await db!.pluggyWebhookEvent.createMany({
      data: Array.from({ length: MAX_PENDING_PLUGGY_WEBHOOK_EVENTS }, () => ({
        userId: secondUserId,
        eventId: randomUUID(),
        event: "item/error",
        itemId: secondItemId,
        attempts: 1,
      })),
    });

    const response = await POST(webhookRequest({
      event: "item/deleted",
      eventId: randomUUID(),
      itemId: secondItemId,
      clientUserId: secondUserId,
    }, secondSecret));

    expect(response.status).toBe(429);
    await db!.pluggyWebhookEvent.deleteMany({
      where: { userId: secondUserId, processedAt: null },
    });
  });
});
