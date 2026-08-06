import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { absorbManualTransactionsIntoBalance } from "@/features/finance/manual-account-balance";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("marcos de saldo de contas manuais", () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  let userId = "";
  let otherUserId = "";
  let accountId = "";

  beforeAll(async () => {
    const [user, otherUser] = await Promise.all([
      db!.user.create({ data: { email: `balance-${suffix}@example.com` } }),
      db!.user.create({ data: { email: `balance-other-${suffix}@example.com` } }),
    ]);
    userId = user.id;
    otherUserId = otherUser.id;
    const account = await db!.financialAccount.create({
      data: {
        userId,
        source: "MANUAL",
        type: "BANK_ACCOUNT",
        name: "Conta com saldo corrigido",
        balance: 100,
        balanceBrl: 100,
        currencyCode: "BRL",
      },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await db.$disconnect();
  });

  it("absorve as transações manuais existentes ao definir um novo saldo", async () => {
    const existing = await db!.financeTransaction.create({
      data: {
        userId,
        accountId,
        source: "MANUAL",
        kind: "EXPENSE",
        description: "Saída anterior ao marco",
        amount: -25,
        currencyCode: "BRL",
        reportingAmountBrl: -25,
        balanceApplied: true,
        date: new Date("2026-08-01T12:00:00.000Z"),
        referenceYear: 2026,
        referenceMonth: 8,
      },
    });
    const snapshotAt = new Date();
    await db!.$transaction(async (tx) => {
      await tx.financialAccount.update({
        where: { id: accountId },
        data: { balance: 68.38, balanceBrl: 68.38, balanceSnapshotAt: snapshotAt },
      });
      await absorbManualTransactionsIntoBalance(tx, userId, accountId);
    });

    const [account, transaction] = await Promise.all([
      db!.financialAccount.findUniqueOrThrow({ where: { id: accountId } }),
      db!.financeTransaction.findUniqueOrThrow({ where: { id: existing.id } }),
    ]);
    expect(account.balance.toFixed(2)).toBe("68.38");
    expect(account.balanceSnapshotAt?.getTime()).toBe(snapshotAt.getTime());
    expect(transaction.balanceApplied).toBe(false);
  });

  it("não absorve transações de outro usuário", async () => {
    const later = await db!.financeTransaction.create({
      data: {
        userId,
        accountId,
        source: "MANUAL",
        kind: "INCOME",
        description: "Entrada posterior ao marco",
        amount: 490,
        currencyCode: "BRL",
        reportingAmountBrl: 490,
        balanceApplied: true,
        date: new Date("2026-08-02T12:00:00.000Z"),
        referenceYear: 2026,
        referenceMonth: 8,
      },
    });

    const result = await db!.$transaction((tx) =>
      absorbManualTransactionsIntoBalance(tx, otherUserId, accountId));
    const stored = await db!.financeTransaction.findUniqueOrThrow({ where: { id: later.id } });
    expect(result.count).toBe(0);
    expect(stored.balanceApplied).toBe(true);
  });
});
