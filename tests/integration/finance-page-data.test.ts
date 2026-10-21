import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFinanceData } from "@/features/finance/data";
import {
  getFinanceAccountsPageData, getFinanceGoalsPageData, getFinanceInvoicesPageData,
  getFinanceProfilePageData, getFinanceTagsPageData, getFinanceTransactionsPageData,
} from "@/features/finance/page-data";
import { calculateInvoices } from "@/features/finance/calculations";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? new PrismaClient() : null;
const suite = enabled ? describe : describe.skip;

suite("consultas financeiras específicas por tela", () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  let userId = "";
  let otherUserId = "";
  let cardId = "";
  const id = (name: string) => `${name}-${suffix}`;

  beforeAll(async () => {
    const owner = await db!.user.create({ data: {
      email: `finance-page-${suffix}@example.com`, name: "Titular",
      financeProfile: { create: { monthlyIncome: "1234.56", financialMonthStart: 5 } },
      preference: { create: { timeZone: "America/Manaus" } },
    } });
    userId = owner.id;
    const other = await db!.user.create({ data: { email: `finance-page-other-${suffix}@example.com` } });
    otherUserId = other.id;
    const card = await db!.financialAccount.create({ data: {
      userId, source: "MANUAL", type: "CREDIT_CARD", name: "Cartão USD", currencyCode: "USD",
      dueDay: 14, closingDay: 7, balance: "20.5", balanceBrl: "102.5",
      balanceFxRateToBrl: "5", balanceFxRateDate: new Date("2026-08-25T00:00:00Z"), balanceFxSource: "MANUAL",
    } });
    cardId = card.id;
    const bank = await db!.financialAccount.create({ data: {
      userId, source: "MANUAL", type: "BANK_ACCOUNT", name: "Conta corrente",
    } });
    const inactive = await db!.financialAccount.create({ data: {
      userId, source: "MANUAL", type: "CREDIT_CARD", name: "Cartão inativo", active: false,
    } });
    const otherCard = await db!.financialAccount.create({ data: {
      userId: otherUserId, source: "MANUAL", type: "CREDIT_CARD", name: "Cartão alheio",
    } });
    const base = {
      userId, accountId: card.id, source: "MANUAL" as const, kind: "EXPENSE" as const,
      description: "Parcela USD", amount: "-20.5", currencyCode: "USD", reportingAmountBrl: "-102.5",
      fxRateToBrl: "5", fxRateDate: new Date("2026-08-25T00:00:00Z"), fxSource: "YAHOO" as const,
      date: new Date("2026-08-25T13:00:00Z"), referenceYear: 2026, referenceMonth: 8,
      installmentNumber: 2, installmentTotal: 3,
    };
    await db!.financeTransaction.createMany({ data: [
      { ...base, id: id("normal"), providerLifecycle: "KEPT_MANUAL" },
      { ...base, id: id("ignored"), ignored: true },
      { ...base, id: id("removed"), providerLifecycle: "REMOVED" },
      { ...base, id: id("boundary"), date: new Date("2025-10-25T13:00:00Z"), referenceYear: 2025, referenceMonth: 10 },
      { ...base, id: id("too-old"), referenceYear: 2025, referenceMonth: 9 },
      { ...base, id: id("future"), referenceYear: 2026, referenceMonth: 10 },
      { ...base, id: id("deleted"), deleted: true },
      { ...base, id: id("bank"), accountId: bank.id },
      { ...base, id: id("inactive"), accountId: inactive.id },
      { ...base, id: id("other"), userId: otherUserId, accountId: otherCard.id },
    ] });
    await db!.financeTag.create({ data: { userId: otherUserId, name: "Tag alheia" } });
  });

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: [userId, otherUserId].filter(Boolean) } } });
    await db.$disconnect();
  });

  it("restringe cartões, propriedade, atividade, exclusões e a mesma janela histórica", async () => {
    const result = await getFinanceInvoicesPageData(userId, 2026, 9, "America/Manaus");
    expect(result.accounts.map((account) => account.id)).toEqual([cardId]);
    expect(result.historyTransactions.map((transaction) => transaction.id).sort()).toEqual([
      id("normal"), id("ignored"), id("removed"), id("boundary"),
    ].sort());
    expect(result.accounts[0]).toMatchObject({ currencyCode: "USD", balance: "20.5", balanceBrl: "102.5", transactionCount: 7 });
    expect(result.historyTransactions.find((transaction) => transaction.id === id("normal"))).toMatchObject({
      amount: "-20.5", reportingAmountBrl: "-102.5", fxRateToBrl: "5", fxSource: "YAHOO",
      fxRateDate: "2026-08-25T00:00:00.000Z", installmentNumber: 2, installmentTotal: 3,
      providerLifecycle: "KEPT_MANUAL",
    });
  });

  it("preserva fechamento, totais nativos e câmbio histórico da consulta ampla", async () => {
    const previous = await getFinanceData(userId, 2026, 9, { transactionScope: "INVOICE_HISTORY" });
    const current = await getFinanceInvoicesPageData(userId, 2026, 9, "America/Manaus");
    const now = new Date("2026-09-20T12:00:00Z");
    const previousCard = previous.accounts.find((account) => account.id === cardId)!;
    expect(calculateInvoices(current.accounts[0], current.historyTransactions, now, current.profile.timeZone))
      .toEqual(calculateInvoices(previousCard, previous.historyTransactions, now, previous.profile.timeZone));
  });

  it("carregar páginas não cria defaults e não inclui tags ou contas alheias", async () => {
    const [profile, goals, tags, accounts, transactions] = await Promise.all([
      getFinanceProfilePageData(userId), getFinanceGoalsPageData(userId), getFinanceTagsPageData(userId),
      getFinanceAccountsPageData(userId), getFinanceTransactionsPageData(userId, 2026, 9),
    ]);
    expect(profile.profile).toMatchObject({ monthlyIncome: "1234.56", timeZone: "America/Manaus" });
    expect(goals.goals.FIXED_COSTS).toBe(30);
    expect(tags).toEqual({ tags: [], classificationRules: [] });
    expect(accounts.accounts.map((account) => account.name).sort()).toEqual(["Cartão USD", "Conta corrente"].sort());
    expect(transactions.tags).toEqual([]);
    expect(await db!.financeGoal.count({ where: { userId } })).toBe(0);
    expect(await db!.financeTag.count({ where: { userId } })).toBe(0);
    expect(await db!.financeProfile.count({ where: { userId } })).toBe(1);
  });
});
