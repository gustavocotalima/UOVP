import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consumeRegistrationInviteInTransaction,
  createRegistrationInvite,
} from "@/features/auth/invitations";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("convites de cadastro", () => {
  let adminId = "";
  const userIds: string[] = [];

  beforeAll(async () => {
    adminId = (await db!.user.create({
      data: { email: `invite-admin-${randomUUID()}@example.com` },
    })).id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: [adminId, ...userIds] } } });
    await db.$disconnect();
  });

  async function createConsumer() {
    const user = await db!.user.create({
      data: { email: `invite-user-${randomUUID()}@example.com` },
    });
    userIds.push(user.id);
    return user.id;
  }

  it("rejeita convite expirado, revogado e usado por outro e-mail", async () => {
    const expired = await createRegistrationInvite(adminId, "expired@example.com");
    await db!.registrationInvite.update({
      where: { id: expired.invite.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(db!.$transaction((tx) =>
      consumeRegistrationInviteInTransaction(tx, expired.token, "expired@example.com", createConsumerId),
    )).rejects.toThrow(/convite/i);

    const revoked = await createRegistrationInvite(adminId, "revoked@example.com");
    await db!.registrationInvite.update({
      where: { id: revoked.invite.id },
      data: { revokedAt: new Date() },
    });
    const revokedUserId = await createConsumer();
    await expect(db!.$transaction((tx) =>
      consumeRegistrationInviteInTransaction(tx, revoked.token, "revoked@example.com", revokedUserId),
    )).rejects.toThrow(/convite/i);

    const wrongEmail = await createRegistrationInvite(adminId, "right@example.com");
    const wrongEmailUserId = await createConsumer();
    await expect(db!.$transaction((tx) =>
      consumeRegistrationInviteInTransaction(tx, wrongEmail.token, "wrong@example.com", wrongEmailUserId),
    )).rejects.toThrow(/convite/i);
  });

  it("é de uso único sob consumo concorrente", async () => {
    const email = `concurrent-${randomUUID()}@example.com`;
    const { token, invite } = await createRegistrationInvite(adminId, email);
    const [firstUserId, secondUserId] = await Promise.all([createConsumer(), createConsumer()]);
    const attempts = await Promise.allSettled([
      db!.$transaction((tx) =>
        consumeRegistrationInviteInTransaction(tx, token, email, firstUserId),
        { isolationLevel: "Serializable" },
      ),
      db!.$transaction((tx) =>
        consumeRegistrationInviteInTransaction(tx, token, email, secondUserId),
        { isolationLevel: "Serializable" },
      ),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect((await db!.registrationInvite.findUniqueOrThrow({ where: { id: invite.id } })).usedByUserId)
      .toMatch(new RegExp(`^(${firstUserId}|${secondUserId})$`));
  });

  it("não permite reutilizar um convite já consumido", async () => {
    const email = `used-${randomUUID()}@example.com`;
    const { token } = await createRegistrationInvite(adminId, email);
    const [firstUserId, secondUserId] = await Promise.all([createConsumer(), createConsumer()]);
    await db!.$transaction((tx) =>
      consumeRegistrationInviteInTransaction(tx, token, email, firstUserId),
    );
    await expect(db!.$transaction((tx) =>
      consumeRegistrationInviteInTransaction(tx, token, email, secondUserId),
    )).rejects.toThrow(/convite/i);
  });
});

const createConsumerId = "00000000-0000-4000-8000-000000000000";
