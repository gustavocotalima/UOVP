import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { financeTransactionOperation } from "@/features/open-finance/sync";

const db = process.env.DATABASE_URL ? createPrismaClient() : null;
const suite = db ? describe : describe.skip;

suite("reimportação financeira e câmbio congelado", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });
  async function fixture(currencyCode: string) {
    const user = await db!.user.create({ data: { email: `sync-fx-${randomUUID()}@example.com` } });
    userIds.push(user.id);
    const account = await db!.financialAccount.create({
      data: { userId: user.id, source: "PLUGGY", type: "BANK_ACCOUNT", name: "Conta", currencyCode },
    });
    const input = {
      id: randomUUID(), accountId: randomUUID(), description: "Compra",
      amount: -100, currencyCode, type: "DEBIT", date: "2026-07-18T12:00:00Z",
    };
    const write = (changes: Partial<typeof input> = {}, rate?: number) => db!.$transaction((tx) =>
      financeTransactionOperation(tx, user.id, account.id, currencyCode, { ...input, ...changes }, 1,
        "America/Sao_Paulo", rate === undefined ? undefined : {
          rateDate: new Date("2026-07-17T00:00:00Z"), rateToBrl: new Prisma.Decimal(rate),
        }));
    return { input, write };
  }
  it("corrige o valor reportável BRL no mesmo ID sem perder escolhas manuais", async () => {
    const { input, write } = await fixture("BRL");
    const first = await write();
    await db!.financeTransaction.update({
      where: { id: first.id },
      data: { referenceOverridden: true, referenceYear: 2025, referenceMonth: 12,
        budgetCategory: "GOALS", budgetCategorySource: "MANUAL" },
    });
    await write({ amount: -120 });
    const stored = await db!.financeTransaction.findUniqueOrThrow({ where: { externalId: input.id } });
    expect(stored.amount.toString()).toBe("-120");
    expect(stored.reportingAmountBrl?.toString()).toBe("-120");
    expect(stored.referenceMonth).toBe(12);
    expect(stored.referenceYear).toBe(2025);
    expect(stored.budgetCategorySource).toBe("MANUAL");
    expect(stored.budgetCategory).toBe("GOALS");
  });
  it("corrige USD com a taxa congelada e descarta taxa incompatível após mudar a data", async () => {
    const { input, write } = await fixture("USD");
    await write({}, 5);
    await write({ amount: -120 }, 6);
    let stored = await db!.financeTransaction.findUniqueOrThrow({ where: { externalId: input.id } });
    expect(stored.reportingAmountBrl?.toString()).toBe("-600");
    expect(stored.fxRateToBrl?.toString()).toBe("5");
    expect(stored.fxRateDate).toEqual(new Date("2026-07-17T00:00:00Z"));
    await write({ date: "2026-07-21T12:00:00Z" });
    stored = await db!.financeTransaction.findUniqueOrThrow({ where: { externalId: input.id } });
    expect(stored.reportingAmountBrl).toBeNull();
    expect(stored.fxSource).toBeNull();
  });
});
