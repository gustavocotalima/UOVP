import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/pluggy/webhook/route";
import {
  acknowledgePluggySync,
  requestPluggySync,
} from "@/features/open-finance/sync-requests";
import { storePluggyWebhookSecret } from "@/features/open-finance/pluggy-credentials";
import { clearAuthRateLimit } from "@/lib/auth-security";

const enabled = Boolean(process.env.DATABASE_URL);
const webhookEnabled = Boolean(
  process.env.CREDENTIAL_ENCRYPTION_KEYS
  && process.env.CREDENTIAL_ENCRYPTION_ACTIVE_KEY
  && (process.env.AUTH_RATE_LIMIT_PEPPER || process.env.AUTH_SECRET),
);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("versões de solicitações de sincronização Pluggy", () => {
  const users: string[] = [];

  async function fixture() {
    const user = await db!.user.create({ data: { email: `sync-requests-${randomUUID()}@example.com` } });
    users.push(user.id);
    const item = await db!.pluggyItem.create({
      data: {
        userId: user.id, pluggyItemId: randomUUID(), connectorName: "Banco de teste",
        status: "UPDATED", syncPending: true,
      },
    });
    return { user, item };
  }

  afterAll(async () => {
    if (!db) return;
    if (webhookEnabled) {
      await Promise.all(users.map((userId) => clearAuthRateLimit("operation-pluggy-webhook", userId)));
    }
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  it("mantém um novo webhook pendente quando o ACK antigo espera pelo lock", async () => {
    const f = await fixture();
    await db!.$transaction((tx) => requestPluggySync(tx, { userId: f.user.id, pluggyItemId: f.item.pluggyItemId }));
    const captured = await db!.pluggyItem.findUniqueOrThrow({ where: { id: f.item.id } });
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const continueWebhook = new Promise<void>((resolve) => { release = resolve; });
    const webhook = db!.$transaction(async (tx) => {
      await requestPluggySync(tx, { userId: f.user.id, pluggyItemId: f.item.pluggyItemId });
      entered();
      await continueWebhook;
    });
    await started;
    let acknowledgementEntered!: () => void;
    const acknowledgementStarted = new Promise<void>((resolve) => { acknowledgementEntered = resolve; });
    const acknowledgement = db!.$transaction(async (tx) => {
      acknowledgementEntered();
      return acknowledgePluggySync(tx, {
        userId: f.user.id, itemId: f.item.id,
        requestedVersion: captured.syncRequestedVersion, partial: false,
      });
    });
    await acknowledgementStarted;
    release();
    await webhook;
    expect(await acknowledgement).toEqual({
      syncRequestedVersion: 2, syncProcessedVersion: 1, syncPending: true,
    });
    expect(await db!.$transaction((tx) => acknowledgePluggySync(tx, {
      userId: f.user.id, itemId: f.item.id, requestedVersion: 2, partial: false,
    }))).toEqual({ syncRequestedVersion: 2, syncProcessedVersion: 2, syncPending: false });
  });

  it("não reconhece versões em snapshot parcial e permite completar a mesma versão", async () => {
    const f = await fixture();
    await db!.$transaction((tx) => requestPluggySync(tx, { userId: f.user.id, pluggyItemId: f.item.pluggyItemId }));
    expect(await db!.$transaction((tx) => acknowledgePluggySync(tx, {
      userId: f.user.id, itemId: f.item.id, requestedVersion: 1, partial: true,
    }))).toEqual({ syncRequestedVersion: 1, syncProcessedVersion: 0, syncPending: true });
    expect(await db!.$transaction((tx) => acknowledgePluggySync(tx, {
      userId: f.user.id, itemId: f.item.id, requestedVersion: 1, partial: false,
    }))).toEqual({ syncRequestedVersion: 1, syncProcessedVersion: 1, syncPending: false });
  });

  it("não regride o contador com ACK atrasado nem reconhece versão futura", async () => {
    const f = await fixture();
    await db!.$transaction(async (tx) => {
      await requestPluggySync(tx, { userId: f.user.id, pluggyItemId: f.item.pluggyItemId });
      await requestPluggySync(tx, { userId: f.user.id, pluggyItemId: f.item.pluggyItemId });
      await acknowledgePluggySync(tx, { userId: f.user.id, itemId: f.item.id, requestedVersion: 2, partial: false });
    });
    expect(await db!.$transaction((tx) => acknowledgePluggySync(tx, {
      userId: f.user.id, itemId: f.item.id, requestedVersion: 1, partial: false,
    }))).toEqual({ syncRequestedVersion: 2, syncProcessedVersion: 2, syncPending: false });
    expect(await db!.$transaction((tx) => acknowledgePluggySync(tx, {
      userId: f.user.id, itemId: f.item.id, requestedVersion: 99, partial: false,
    }))).toEqual({ syncRequestedVersion: 2, syncProcessedVersion: 2, syncPending: false });
  });

  it("mantém a pendência inicial mesmo sem webhook quando o snapshot é parcial", async () => {
    const f = await fixture();
    expect(await db!.$transaction((tx) => acknowledgePluggySync(tx, {
      userId: f.user.id, itemId: f.item.id, requestedVersion: 0, partial: true,
    }))).toEqual({ syncRequestedVersion: 0, syncProcessedVersion: 0, syncPending: true });
  });

  it("aplica isolamento de usuário ao solicitar e reconhecer versões", async () => {
    const first = await fixture();
    const other = await fixture();
    expect(await db!.$transaction((tx) => requestPluggySync(tx, {
      userId: first.user.id, pluggyItemId: other.item.pluggyItemId,
    }))).toBe(0);
    expect(await db!.$transaction((tx) => acknowledgePluggySync(tx, {
      userId: first.user.id, itemId: other.item.id, requestedVersion: 0, partial: false,
    }))).toBeNull();
    const unchanged = await db!.pluggyItem.findUniqueOrThrow({ where: { id: other.item.id } });
    expect(unchanged).toMatchObject({ syncRequestedVersion: 0, syncProcessedVersion: 0, syncPending: true });
  });

  it.skipIf(!webhookEnabled)("reentrega do mesmo webhook não incrementa a versão novamente", async () => {
    const f = await fixture();
    const secret = `sync-${randomUUID()}-${randomUUID()}`;
    await storePluggyWebhookSecret(f.user.id, secret);
    const payload = {
      event: "transactions/deleted", eventId: randomUUID(), itemId: f.item.pluggyItemId,
      clientUserId: f.user.id, transactionIds: [],
    };
    const request = () => new Request("http://localhost/api/pluggy/webhook", {
      method: "POST", headers: { "content-type": "application/json", "x-pluggy-webhook-secret": secret },
      body: JSON.stringify(payload),
    });
    const first = await POST(request());
    const duplicate = await POST(request());
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ received: true, duplicate: true });
    expect(await db!.pluggyItem.findUniqueOrThrow({ where: { id: f.item.id } }))
      .toMatchObject({ syncRequestedVersion: 1, syncProcessedVersion: 0, syncPending: true });
  });
});
