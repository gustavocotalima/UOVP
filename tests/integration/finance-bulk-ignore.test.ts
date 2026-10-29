import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => currentUser.id }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setFinanceTransactionsIgnoredAction } from "@/features/finance/actions";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("atomicidade de transações ignoradas em lote", () => {
  const userIds: string[] = [];

  async function fixture() {
    const suffix = randomUUID();
    const [user, other] = await Promise.all([
      db!.user.create({ data: { email: `bulk-ignore-${suffix}@example.com` } }),
      db!.user.create({ data: { email: `bulk-ignore-other-${suffix}@example.com` } }),
    ]);
    userIds.push(user.id, other.id);
    currentUser.id = user.id;
    const accounts = await Promise.all([user, other].map((owner) => db!.financialAccount.create({
      data: { userId: owner.id, source: "MANUAL", type: "BANK_ACCOUNT", name: "Conta de teste" },
    })));
    const create = (userId: string, deleted = false) => db!.financeTransaction.create({
      data: {
        userId,
        accountId: accounts.find((account) => account.userId === userId)!.id,
        source: "MANUAL",
        kind: "EXPENSE",
        description: "Transação para validar atomicidade",
        amount: -10,
        currencyCode: "BRL",
        reportingAmountBrl: -10,
        date: new Date("2026-10-01T12:00:00Z"),
        referenceYear: 2026,
        referenceMonth: 10,
        ignored: false,
        deleted,
      },
    });
    const [valid, second, deleted, foreign] = await Promise.all([
      create(user.id), create(user.id), create(user.id, true), create(other.id),
    ]);
    return { valid, second, deleted, foreign };
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it.each(["missing", "deleted", "foreign"] as const)(
    "reverte as alterações válidas quando há um ID %s", async (invalid) => {
      const { valid, deleted, foreign } = await fixture();
      const invalidId = invalid === "missing" ? randomUUID() : { deleted, foreign }[invalid].id;

      await expect(setFinanceTransactionsIgnoredAction([valid.id, invalidId], true))
        .rejects.toThrow("Uma ou mais transações são inválidas.");

      const stored = await db!.financeTransaction.findUniqueOrThrow({ where: { id: valid.id } });
      expect(stored.ignored).toBe(false);
      const foreignStored = await db!.financeTransaction.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(foreignStored.ignored).toBe(false);
    },
  );

  it("altera todos os registros únicos e permite restaurá-los", async () => {
    const { valid, second } = await fixture();
    const ids = [valid.id, second.id, valid.id];
    await setFinanceTransactionsIgnoredAction(ids, true);
    expect(await db!.financeTransaction.count({ where: { id: { in: ids }, ignored: true } })).toBe(2);

    await setFinanceTransactionsIgnoredAction(ids, false);
    expect(await db!.financeTransaction.count({ where: { id: { in: ids }, ignored: false } })).toBe(2);
  });
});
