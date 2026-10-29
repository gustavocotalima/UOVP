import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { type Prisma } from "@/generated/prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { financialReferenceForTimeZone } from "@/lib/calendar";
import type { UserOperationLeaseContext } from "@/lib/operation-security";
import {
  lockFinancialReferenceSettings,
  previewFinancialReferenceRepair,
  recalculateFinancialReferences,
  updateFinancialReferenceSettings,
  writeFinancialReferenceBatches,
} from "@/features/finance/financial-reference";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("referências financeiras no calendário local", () => {
  const userIds: string[] = [];

  async function fixture() {
    const user = await db!.user.create({
      data: {
        email: `financial-reference-${randomUUID()}@example.com`,
        financeProfile: { create: { financialMonthStart: 1 } },
        preference: { create: { timeZone: "America/Sao_Paulo" } },
      },
    });
    userIds.push(user.id);
    const account = await db!.financialAccount.create({
      data: { userId: user.id, source: "MANUAL", type: "BANK_ACCOUNT", name: "Conta de teste" },
    });
    const createTransaction = (date: string, referenceOverridden = false) => db!.financeTransaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "PLUGGY",
        kind: "EXPENSE",
        description: "Teste de referência financeira",
        amount: -10,
        date: new Date(date),
        referenceYear: 1900,
        referenceMonth: 1,
        referenceOverridden,
        updatedAt: new Date("2020-01-01T00:00:00Z"),
      },
    });
    return { user, createTransaction };
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it.each([
    { date: "2026-10-01T01:00:00Z", start: 1, zone: "America/Sao_Paulo", expected: { year: 2026, month: 9 } },
    { date: "2026-01-01T01:00:00Z", start: 1, zone: "America/Rio_Branco", expected: { year: 2025, month: 12 } },
    { date: "2026-10-15T02:30:00Z", start: 15, zone: "America/Sao_Paulo", expected: { year: 2026, month: 9 } },
    { date: "2026-10-15T02:30:00Z", start: 15, zone: "America/Noronha", expected: { year: 2026, month: 10 } },
    { date: "2026-03-28T04:00:00Z", start: 28, zone: "America/Manaus", expected: { year: 2026, month: 3 } },
    { date: "2018-11-04T03:30:00Z", start: 4, zone: "America/Sao_Paulo", expected: { year: 2018, month: 11 } },
  ])("alinha SQL e regra de calendário para $date, início $start, $zone", async ({ date, start, zone, expected }) => {
    const { user, createTransaction } = await fixture();
    const transaction = await createTransaction(date);
    expect(financialReferenceForTimeZone(new Date(date), start, zone)).toEqual(expected);

    const count = await db!.$transaction(async (tx) => {
      await lockFinancialReferenceSettings(tx, user.id);
      return recalculateFinancialReferences(tx, user.id, { financialMonthStart: start, timeZone: zone });
    });

    expect(count).toBe(1);
    const stored = await db!.financeTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect({ year: stored.referenceYear, month: stored.referenceMonth }).toEqual(expected);
  });

  it("simula sem gravar, preserva overrides/outros usuários e é idempotente", async () => {
    const first = await fixture();
    const second = await fixture();
    const [automatic, overridden, foreign] = await Promise.all([
      first.createTransaction("2026-10-01T01:00:00Z"),
      first.createTransaction("2026-10-01T01:00:00Z", true),
      second.createTransaction("2026-10-01T01:00:00Z"),
    ]);
    const settings = { financialMonthStart: 1, timeZone: "America/Sao_Paulo" };
    const preview = await db!.$transaction((tx) => previewFinancialReferenceRepair(tx, first.user.id, settings));
    expect(preview.total).toBe(1);
    expect(preview.samples).toEqual([expect.objectContaining({ id: automatic.id, nextYear: 2026, nextMonth: 9 })]);
    expect((await db!.financeTransaction.findUniqueOrThrow({ where: { id: automatic.id } })).referenceYear).toBe(1900);

    const apply = () => db!.$transaction(async (tx) => {
      await lockFinancialReferenceSettings(tx, first.user.id);
      return recalculateFinancialReferences(tx, first.user.id, settings);
    });
    expect(await apply()).toBe(1);
    const firstUpdatedAt = (await db!.financeTransaction.findUniqueOrThrow({ where: { id: automatic.id } })).updatedAt;
    expect(await apply()).toBe(0);
    expect((await db!.financeTransaction.findUniqueOrThrow({ where: { id: automatic.id } })).updatedAt).toEqual(firstUpdatedAt);
    for (const unchanged of [overridden, foreign]) {
      const stored = await db!.financeTransaction.findUniqueOrThrow({ where: { id: unchanged.id } });
      expect(stored.referenceYear).toBe(1900);
      expect(stored.updatedAt).toEqual(unchanged.updatedAt);
    }
  });

  it("reverte configuração e referências se a transação falhar após o recálculo", async () => {
    const { user, createTransaction } = await fixture();
    const transaction = await createTransaction("2026-10-15T02:30:00Z");

    await expect(db!.$transaction(async (tx) => {
      await updateFinancialReferenceSettings(tx, user.id, { financialMonthStart: 15 }, () =>
        tx.financeProfile.update({ where: { userId: user.id }, data: { financialMonthStart: 15 } }));
      throw new Error("Falha após o recálculo");
    })).rejects.toThrow("Falha após o recálculo");

    expect((await db!.financeProfile.findUniqueOrThrow({ where: { userId: user.id } })).financialMonthStart).toBe(1);
    expect((await db!.financeTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).referenceYear).toBe(1900);
  });

  it("combina alterações concorrentes de início e fuso usando o mesmo lock", async () => {
    const { user, createTransaction } = await fixture();
    const transaction = await createTransaction("2026-10-15T02:30:00Z");
    let releaseFirst!: () => void;
    let markFirstLocked!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstLocked = new Promise<void>((resolve) => { markFirstLocked = resolve; });
    const first = db!.$transaction((tx) => updateFinancialReferenceSettings(
      tx, user.id, { financialMonthStart: 15 }, async () => {
        await tx.financeProfile.update({ where: { userId: user.id }, data: { financialMonthStart: 15 } });
        markFirstLocked();
        await firstMayFinish;
      },
    ));
    await firstLocked;
    const second = db!.$transaction((tx) => updateFinancialReferenceSettings(
      tx, user.id, { timeZone: "America/Noronha" }, () =>
        tx.userPreference.update({ where: { userId: user.id }, data: { timeZone: "America/Noronha" } }),
    ));
    releaseFirst();
    await Promise.all([first, second]);

    const stored = await db!.financeTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect({ year: stored.referenceYear, month: stored.referenceMonth }).toEqual({ year: 2026, month: 10 });
    expect((await db!.financeProfile.findUniqueOrThrow({ where: { userId: user.id } })).financialMonthStart).toBe(15);
    expect((await db!.userPreference.findUniqueOrThrow({ where: { userId: user.id } })).timeZone).toBe("America/Noronha");
  });

  it("não restaura referências antigas quando as regras mudam entre lotes importados", async () => {
    const { user, createTransaction } = await fixture();
    const transactions = await Promise.all(Array.from({ length: 3 }, () =>
      createTransaction("2026-10-15T02:30:00Z")));
    await db!.financeProfile.update({ where: { userId: user.id }, data: { financialMonthStart: 15 } });
    let batches = 0;
    const lease = {
      runFencedTransaction: async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        await db!.$transaction(operation);
        batches += 1;
        if (batches === 1) {
          await db!.$transaction((tx) => updateFinancialReferenceSettings(
            tx, user.id, { financialMonthStart: 10, timeZone: "America/Noronha" }, async () => {
              await tx.financeProfile.update({ where: { userId: user.id }, data: { financialMonthStart: 10 } });
              await tx.userPreference.update({ where: { userId: user.id }, data: { timeZone: "America/Noronha" } });
            },
          ));
        }
      },
    } as unknown as UserOperationLeaseContext;

    await writeFinancialReferenceBatches(lease, user.id, transactions.map((transaction) => async (tx, settings) => {
      const reference = financialReferenceForTimeZone(
        transaction.date, settings.financialMonthStart, settings.timeZone,
      );
      await tx.financeTransaction.update({
        where: { id: transaction.id },
        data: { referenceYear: reference.year, referenceMonth: reference.month },
      });
    }), 2);

    const stored = await db!.financeTransaction.findMany({ where: { userId: user.id } });
    expect(batches).toBe(2);
    expect(stored).toHaveLength(3);
    expect(stored.every((transaction) => transaction.referenceYear === 2026 && transaction.referenceMonth === 10)).toBe(true);
  });
});
