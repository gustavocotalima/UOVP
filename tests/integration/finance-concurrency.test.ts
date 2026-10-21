import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userId: "", historicalFx: vi.fn(), afterSelection: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => mocks.userId }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  const client = new Client();
  return {
    prisma: client.$extends({
      query: {
        financeTransaction: {
          async findMany({ args, query }) {
            const rows = await query(args);
            await mocks.afterSelection();
            return rows;
          },
        },
      },
    }),
  };
});
vi.mock("@/features/finance/account-fx", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/finance/account-fx")>(),
  resolveHistoricalFinancialFx: mocks.historicalFx,
}));

import { prisma } from "@/lib/prisma";
import { classifyFinanceTransactionsForUser } from "@/features/finance/classification-service";
import {
  saveFinancialAccountAction,
  toggleFinanceInternalTransferAction,
  updateFinanceTransactionAction,
  updateFinanceTransactionCategoryAction,
  updateFinanceTransactionTagsAction,
} from "@/features/finance/actions";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;
const transactionDate = new Date("2026-10-21T12:00:00Z");
const fx = { rateToBrl: new Prisma.Decimal(5), rateDate: transactionDate, source: "YAHOO" as const, fetchedAt: transactionDate };

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

suite("concorrência de classificação e edição financeira", () => {
  const userIds: string[] = [];

  beforeEach(() => {
    mocks.historicalFx.mockReset().mockResolvedValue(fx);
    mocks.afterSelection.mockReset();
  });

  async function fixture(source: "PLUGGY" | "MANUAL") {
    const user = await db!.user.create({ data: { email: `finance-race-${randomUUID()}@example.com` } });
    userIds.push(user.id);
    mocks.userId = user.id;
    const account = await db!.financialAccount.create({
      data: {
        userId: user.id, source: "MANUAL", type: "BANK_ACCOUNT", name: "Conta de origem",
        currencyCode: source === "MANUAL" ? "USD" : "BRL", balance: 90, balanceBrl: source === "MANUAL" ? 450 : 90,
        balanceFxRateToBrl: source === "MANUAL" ? 5 : 1,
      },
    });
    const transaction = await db!.financeTransaction.create({
      data: {
        userId: user.id, accountId: account.id, source, kind: "EXPENSE", description: "Mercado concorrente",
        providerCategory: source === "PLUGGY" ? "Groceries" : null,
        amount: -10, currencyCode: account.currencyCode, reportingAmountBrl: source === "MANUAL" ? -50 : -10,
        fxRateToBrl: source === "MANUAL" ? 5 : 1, fxRateDate: transactionDate,
        fxSource: source === "MANUAL" ? "YAHOO" : "NATIVE", balanceApplied: source === "MANUAL",
        date: transactionDate, referenceYear: 2026, referenceMonth: 10,
      },
    });
    return { user, account, transaction };
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
    await prisma.$disconnect();
  });

  it.each([true, false])("preserva decisões manuais posteriores à seleção inicial (tags: %s)", async (withTags) => {
    const f = await fixture("PLUGGY");
    const manualTag = await db!.financeTag.create({ data: { userId: f.user.id, name: "Escolha pessoal", color: "#123456" } });
    const automaticTag = await db!.financeTag.create({ data: { userId: f.user.id, name: "Regra automática", color: "#654321" } });
    await db!.financeClassificationRule.create({
      data: {
        userId: f.user.id, kind: "EXPENSE", matchType: "DESCRIPTION", matchValue: "MERCADO CONCORRENTE", matchLabel: "Mercado",
        assignsBudgetCategory: true, budgetCategory: "FIXED_COSTS", assignsTags: true, assignsInternalTransfer: true, internalTransfer: false,
        tags: { create: { tagId: automaticTag.id } },
      },
    });
    const selected = barrier();
    const resume = barrier();
    mocks.afterSelection.mockImplementationOnce(async () => {
      selected.release();
      await resume.promise;
    });
    const classification = classifyFinanceTransactionsForUser(f.user.id, [f.transaction.id]);
    await selected.promise;
    try {
      await updateFinanceTransactionCategoryAction(f.transaction.id, withTags ? "GOALS" : null);
      await updateFinanceTransactionTagsAction(f.transaction.id, withTags ? [manualTag.id] : []);
      await toggleFinanceInternalTransferAction(f.transaction.id);
    } finally {
      resume.release();
    }
    const summary = await classification;
    const stored = await db!.financeTransaction.findUniqueOrThrow({ where: { id: f.transaction.id }, include: { tags: true } });
    expect(stored).toMatchObject({
      budgetCategory: withTags ? "GOALS" : null,
      budgetCategorySource: "MANUAL", tagAssignmentSource: "MANUAL",
      internalTransfer: true, internalTransferSource: "MANUAL", classificationRuleId: null,
    });
    expect(stored.tags.map((tag) => ({ tagId: tag.tagId, source: tag.source })))
      .toEqual(withTags ? [{ tagId: manualTag.id, source: "MANUAL" }] : []);
    expect(summary).toMatchObject({ processed: 1, metasAssigned: 0, tagsAssigned: 0, internalTransfersDetected: 0 });
  });

  it("mantém a classificação na transação fornecida pelo chamador", async () => {
    const f = await fixture("PLUGGY");
    await expect(prisma.$transaction(async (tx) => {
      const summary = await classifyFinanceTransactionsForUser(f.user.id, [f.transaction.id], tx);
      expect(summary).toMatchObject({ processed: 1, metasAssigned: 1 });
      throw new Error("rollback do chamador");
    })).rejects.toThrow("rollback do chamador");
    const stored = await db!.financeTransaction.findUniqueOrThrow({ where: { id: f.transaction.id } });
    expect(stored.budgetCategorySource).toBe("UNASSIGNED");
    expect(stored.classifiedAt).toBeNull();
  });

  it("reverte a edição quando a conta de destino muda de USD para BRL durante FX", async () => {
    const f = await fixture("MANUAL");
    const destination = await db!.financialAccount.create({
      data: { userId: f.user.id, source: "MANUAL", type: "BANK_ACCOUNT", name: "Destino vazio", currencyCode: "USD", balance: 0, balanceBrl: 0 },
    });
    const entered = barrier();
    const resume = barrier();
    mocks.historicalFx.mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return fx;
    });
    const update = updateFinanceTransactionAction({
      id: f.transaction.id, accountId: destination.id, amount: 20, description: "Descrição em edição",
      referenceYear: 2026, referenceMonth: 10, tagIds: [],
    });
    await entered.promise;
    try {
      await saveFinancialAccountAction({
        id: destination.id, type: "BANK_ACCOUNT", name: destination.name,
        balance: 0, expectedBalance: 0, currencyCode: "BRL",
      });
    } finally {
      resume.release();
    }
    await expect(update).rejects.toThrow("A moeda da conta mudou");
    const [source, target, transaction] = await Promise.all([
      db!.financialAccount.findUniqueOrThrow({ where: { id: f.account.id } }),
      db!.financialAccount.findUniqueOrThrow({ where: { id: destination.id } }),
      db!.financeTransaction.findUniqueOrThrow({ where: { id: f.transaction.id } }),
    ]);
    expect(source.balance.toString()).toBe("90");
    expect(target.balance.toString()).toBe("0");
    expect(target.currencyCode).toBe("BRL");
    expect(transaction).toMatchObject({ accountId: f.account.id, description: f.transaction.description, currencyCode: "USD" });
    expect(transaction.amount.toString()).toBe("-10");
    expect(transaction.reportingAmountBrl?.toString()).toBe("-50");
  });

  it("permite transferir a transação quando a moeda confirmada continua estável", async () => {
    const f = await fixture("MANUAL");
    const destination = await db!.financialAccount.create({
      data: { userId: f.user.id, source: "MANUAL", type: "BANK_ACCOUNT", name: "Destino USD", currencyCode: "USD", balance: 0, balanceBrl: 0, balanceFxRateToBrl: 5 },
    });
    await expect(updateFinanceTransactionAction({
      id: f.transaction.id, accountId: destination.id, amount: 20, referenceYear: 2026, referenceMonth: 10, tagIds: [],
    })).resolves.toEqual({ ok: true });
    const [source, target, transaction] = await Promise.all([
      db!.financialAccount.findUniqueOrThrow({ where: { id: f.account.id } }),
      db!.financialAccount.findUniqueOrThrow({ where: { id: destination.id } }),
      db!.financeTransaction.findUniqueOrThrow({ where: { id: f.transaction.id } }),
    ]);
    expect(source.balance.toString()).toBe("100");
    expect(target.balance.toString()).toBe("-20");
    expect(transaction.accountId).toBe(destination.id);
    expect(transaction.reportingAmountBrl?.toString()).toBe("-100");
  });
});
