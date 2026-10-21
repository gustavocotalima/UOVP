import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({
  user: vi.fn(), profile: vi.fn(), preference: vi.fn(), goals: vi.fn(),
  accounts: vi.fn(), transactions: vi.fn(), tags: vi.fn(), rules: vi.fn(),
  items: vi.fn(), count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(),
  profileUpsert: vi.fn(), goalUpsert: vi.fn(), tagUpsert: vi.fn(), transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUniqueOrThrow: queries.user },
  financeProfile: { findUniqueOrThrow: queries.profile, upsert: queries.profileUpsert },
  userPreference: { findUnique: queries.preference },
  financeGoal: { findMany: queries.goals, upsert: queries.goalUpsert },
  financialAccount: { findMany: queries.accounts },
  financeTransaction: {
    findMany: queries.transactions, count: queries.count,
    aggregate: queries.aggregate, groupBy: queries.groupBy,
  },
  financeTag: { findMany: queries.tags, upsert: queries.tagUpsert },
  financeClassificationRule: { findMany: queries.rules },
  pluggyItem: { findMany: queries.items },
  $transaction: queries.transaction,
} }));

import { getFinanceData, getFinanceTransactionsPage } from "@/features/finance/data";
import {
  getFinanceAccountsPageData, getFinanceGoalsPageData, getFinanceInvoicesPageData,
  getFinanceProfilePageData, getFinanceTagsPageData, getFinanceTransactionsPageData,
} from "@/features/finance/page-data";
import {
  FINANCE_ACCOUNT_SELECT, FINANCE_CLASSIFICATION_RULE_SELECT,
  FINANCE_PROFILE_SELECT, FINANCE_TRANSACTION_SELECT,
  mapFinanceTransaction,
} from "@/features/finance/read-models";
import { calculateInvoices } from "@/features/finance/calculations";
import { initialFinanceTransactionQuery } from "@/features/finance/transaction-query";

const decimal = (value: string) => new Prisma.Decimal(value);
const account = {
  id: "card", source: "MANUAL", providerItemId: null, type: "CREDIT_CARD", subtype: null,
  name: "Cartão USD", institutionName: "Instituição", institutionImageUrl: null,
  accountNumber: "123", agency: null, numberLastFour: "0123", bankCode: null, brand: "VISA",
  balance: decimal("150.20"), balanceBrl: decimal("751.00"), balanceFxRateToBrl: decimal("5"),
  balanceFxRateDate: new Date("2026-09-20T00:00:00Z"), balanceFxSource: "MANUAL",
  balanceSnapshotAt: new Date("2026-09-20T12:00:00Z"), creditLimit: decimal("1000"),
  availableCredit: decimal("849.8"), dueDay: 14, closingDay: 7, currencyCode: "USD",
  sortOrder: 1, providerUpdatedAt: null, investmentLink: null, _count: { transactions: 12 },
} satisfies Prisma.FinancialAccountGetPayload<{ select: typeof FINANCE_ACCOUNT_SELECT }>;

const transaction = {
  id: "transaction", accountId: account.id, source: "MANUAL", kind: "EXPENSE",
  description: "Parcela importada", descriptionRaw: null, merchantName: null,
  merchantBusinessName: null, merchantCnpj: null, merchantCategory: null,
  counterpartyName: null, paymentMethod: null, amount: decimal("-20.5"), currencyCode: "USD",
  reportingAmountBrl: decimal("-102.5"), fxRateToBrl: decimal("5"),
  fxRateDate: new Date("2026-08-25T00:00:00Z"), fxSource: "YAHOO",
  originalAmount: decimal("20.5"), originalCurrencyCode: "USD",
  date: new Date("2026-08-25T13:00:00Z"), referenceYear: 2026, referenceMonth: 8,
  budgetCategory: "GOALS", budgetCategorySource: "MANUAL", tagAssignmentSource: "MANUAL",
  providerCategory: null, providerCategoryId: null, status: "POSTED", note: "Referência manual",
  ignored: false, balanceApplied: false, providerLifecycle: "KEPT_MANUAL", providerDeletedAt: null,
  internalTransfer: false, internalTransferSource: "UNASSIGNED", installmentNumber: 2,
  installmentTotal: 3, classificationRule: null, classifiedAt: null,
  account: { name: account.name, type: account.type, institutionName: account.institutionName,
    institutionImageUrl: null, bankCode: null, providerItemId: null },
  tags: [{ tag: { id: "tag", systemKey: null, name: "Viagem", color: "#123456" } }],
} satisfies Parameters<typeof mapFinanceTransaction>[0];

beforeEach(() => {
  vi.resetAllMocks();
  queries.user.mockResolvedValue({ name: "Pessoa", email: "pessoa@example.com", image: null });
  queries.profile.mockResolvedValue({ monthlyIncome: decimal("1234.56"), financialMonthStart: 5, objectives: "Reserva" });
  queries.preference.mockResolvedValue({ timeZone: "America/Manaus", pluggyClientIdCiphertext: "encrypted-id", pluggyClientSecretCiphertext: "encrypted-secret" });
  queries.goals.mockResolvedValue([]);
  queries.accounts.mockResolvedValue([account]);
  queries.transactions.mockResolvedValue([transaction]);
  queries.tags.mockResolvedValue([transaction.tags[0].tag]);
  queries.rules.mockResolvedValue([]);
  queries.items.mockResolvedValue([
    { syncPending: true, lastSyncAt: new Date("2026-09-19T12:00:00Z") },
    { syncPending: false, lastSyncAt: new Date("2026-09-20T12:00:00Z") },
  ]);
  queries.count.mockResolvedValue(3);
  queries.aggregate.mockResolvedValue({ _sum: { reportingAmountBrl: decimal("102.5") } });
  queries.groupBy.mockResolvedValue([]);
});

describe("carregadores financeiros por tela", () => {
  it("perfil lê somente usuário, campos de perfil e fuso, sem inicializar dados", async () => {
    const result = await getFinanceProfilePageData("user-a");
    expect(result).toEqual({
      user: { name: "Pessoa", email: "pessoa@example.com", image: null },
      profile: { monthlyIncome: "1234.56", financialMonthStart: 5, objectives: "Reserva", timeZone: "America/Manaus" },
    });
    expect(queries.profile).toHaveBeenCalledWith({ where: { userId: "user-a" }, select: FINANCE_PROFILE_SELECT });
    expect(queries.preference).toHaveBeenCalledWith({ where: { userId: "user-a" }, select: { timeZone: true } });
    for (const query of [queries.accounts, queries.transactions, queries.goals, queries.tags,
      queries.rules, queries.items, queries.count, queries.transaction, queries.profileUpsert]) {
      expect(query).not.toHaveBeenCalled();
    }
  });

  it("metas lê somente renda e percentuais, preservando metas personalizadas", async () => {
    queries.goals.mockResolvedValue([{ category: "GOALS", percentage: decimal("22.5") }]);
    const result = await getFinanceGoalsPageData("user-a");
    expect(result.profile).toEqual({ monthlyIncome: "1234.56" });
    expect(result.goals.GOALS).toBe(22.5);
    expect(result.goals.FIXED_COSTS).toBe(30);
    expect(queries.profile).toHaveBeenCalledWith({ where: { userId: "user-a" }, select: { monthlyIncome: true } });
    for (const query of [queries.user, queries.preference, queries.accounts, queries.transactions,
      queries.tags, queries.rules, queries.items, queries.count]) expect(query).not.toHaveBeenCalled();
  });

  it("tags carrega apenas tags/regras, com contagens e tags aplicadas preservadas", async () => {
    queries.rules.mockResolvedValue([{
      id: "rule", matchType: "DESCRIPTION_PREFIX", matchValue: "mercado", matchLabel: "Mercado",
      kind: "EXPENSE", assignsBudgetCategory: true, budgetCategory: "FIXED_COSTS", assignsTags: true,
      assignsInternalTransfer: false, internalTransfer: false, enabled: true,
      tags: transaction.tags, _count: { appliedTransactions: 12 },
    }]);
    const result = await getFinanceTagsPageData("user-a");
    expect(result.tags).toEqual([transaction.tags[0].tag]);
    expect(result.classificationRules[0]).toMatchObject({ appliedCount: 12, tags: [transaction.tags[0].tag] });
    expect(queries.rules).toHaveBeenCalledWith({
      where: { userId: "user-a" }, orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
      select: FINANCE_CLASSIFICATION_RULE_SELECT,
    });
    for (const query of [queries.user, queries.profile, queries.preference, queries.accounts,
      queries.transactions, queries.items, queries.count, queries.goals]) expect(query).not.toHaveBeenCalled();
  });

  it("contas preserva moeda, câmbio congelado e contagem sem carregar transações/regras/metas", async () => {
    const result = await getFinanceAccountsPageData("user-a");
    expect(result.accounts[0]).toMatchObject({
      balance: "150.2", balanceBrl: "751", balanceFxRateToBrl: "5",
      balanceFxRateDate: "2026-09-20T00:00:00.000Z", balanceFxSource: "MANUAL",
      currencyCode: "USD", transactionCount: 12,
    });
    expect(result.pluggy).toEqual({ configured: true, itemCount: 2, pendingCount: 1, lastSyncAt: "2026-09-20T12:00:00.000Z" });
    expect(JSON.stringify(result)).not.toContain("encrypted-");
    expect(queries.accounts).toHaveBeenCalledWith({
      where: { userId: "user-a", active: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }], select: FINANCE_ACCOUNT_SELECT,
    });
    for (const query of [queries.user, queries.profile, queries.goals, queries.transactions,
      queries.tags, queries.rules, queries.count]) expect(query).not.toHaveBeenCalled();
  });

  it("faturas restringe no banco os 12 períodos a cartões ativos do usuário", async () => {
    await getFinanceInvoicesPageData("user-a", 2026, 1, "America/Sao_Paulo");
    expect(queries.transactions).toHaveBeenCalledWith({
      where: {
        userId: "user-a", deleted: false, account: { userId: "user-a", active: true, type: "CREDIT_CARD" },
        OR: expect.arrayContaining([
          { referenceYear: 2026, referenceMonth: 1 },
          { referenceYear: 2025, referenceMonth: 2 },
        ]),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: FINANCE_TRANSACTION_SELECT,
    });
    expect(queries.transactions.mock.calls[0][0].where.OR).toHaveLength(12);
    expect(queries.accounts).toHaveBeenNthCalledWith(1, {
      where: { userId: "user-a", active: true, type: "CREDIT_CARD" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: FINANCE_ACCOUNT_SELECT,
    });
    expect(queries.accounts).toHaveBeenNthCalledWith(2, {
      where: { userId: "user-a", active: true, providerItemId: { not: null } },
      select: { providerItemId: true, bankCode: true },
    });
    for (const query of [queries.user, queries.profile, queries.preference, queries.goals,
      queries.tags, queries.rules, queries.items, queries.count]) expect(query).not.toHaveBeenCalled();
  });

  it("mantém os resultados de faturas, parcelas, ignoradas e moedas do carregador anterior", async () => {
    const ignored = { ...transaction, id: "ignored", ignored: true, amount: decimal("-30"), reportingAmountBrl: decimal("-150") };
    const removed = { ...transaction, id: "removed", providerLifecycle: "REMOVED", amount: decimal("-40"), reportingAmountBrl: decimal("-200") };
    const bank = { ...account, id: "bank", type: "BANK_ACCOUNT", name: "Conta" };
    const bankTransaction = { ...transaction, id: "bank-transaction", accountId: bank.id,
      account: { ...transaction.account, type: "BANK_ACCOUNT" } };
    queries.transactions.mockImplementation(async ({ where }) => where.account?.type === "CREDIT_CARD"
      ? [transaction, ignored, removed] : [transaction, ignored, removed, bankTransaction]);
    queries.accounts.mockImplementation(async ({ where }) => where.type === "CREDIT_CARD" ? [account] : [account, bank]);
    const previous = await getFinanceData("user-a", 2026, 9, { transactionScope: "INVOICE_HISTORY" });
    const current = await getFinanceInvoicesPageData("user-a", 2026, 9, "America/Manaus");
    const now = new Date("2026-09-20T12:00:00Z");
    const oldInvoices = calculateInvoices(previous.accounts[0], previous.historyTransactions, now, previous.profile.timeZone);
    const newInvoices = calculateInvoices(current.accounts[0], current.historyTransactions, now, current.profile.timeZone);
    expect(newInvoices).toEqual(oldInvoices);
    expect(current.historyTransactions).toHaveLength(3);
    expect(current.historyTransactions[0]).toMatchObject({
      amount: "-20.5", reportingAmountBrl: "-102.5", fxRateToBrl: "5", fxSource: "YAHOO",
      installmentNumber: 2, installmentTotal: 3, currencyCode: "USD", providerLifecycle: "KEPT_MANUAL",
    });
    expect(newInvoices.find((invoice) => invoice.transactions.length)?.total).toBe(20.5);
  });

  it("contexto de transações não carrega histórico, regras nem agregados sem consumidor", async () => {
    const result = await getFinanceTransactionsPageData("user-a", 2026, 9);
    expect(result).toMatchObject({ year: 2026, month: 9, unclassifiedTransactionCount: 3, pendingDeletionCount: 3 });
    expect(queries.count).toHaveBeenCalledTimes(2);
    expect(queries.count).toHaveBeenNthCalledWith(1, {
      where: { userId: "user-a", deleted: false, account: { active: true }, kind: "EXPENSE",
        budgetCategorySource: "UNASSIGNED", ignored: false, internalTransfer: false },
    });
    for (const query of [queries.transactions, queries.aggregate, queries.groupBy, queries.rules,
      queries.user, queries.profile, queries.goals]) expect(query).not.toHaveBeenCalled();
  });

  it("NONE não consulta registros de transações nem faz upserts de provisionamento", async () => {
    const result = await getFinanceData("user-a", 2026, 9, { transactionScope: "NONE" });
    expect(result.transactions).toEqual([]);
    expect(result.recentTransactions).toEqual([]);
    expect(result.historyTransactions).toEqual([]);
    for (const query of [queries.transactions, queries.groupBy, queries.transaction,
      queries.profileUpsert, queries.goalUpsert, queries.tagUpsert]) expect(query).not.toHaveBeenCalled();
  });

  it("consulta paginada compartilha a seleção sem perder metadados ou câmbio histórico", async () => {
    const result = await getFinanceTransactionsPage("user-a", initialFinanceTransactionQuery(2026, 9));
    expect(queries.transactions).toHaveBeenCalledWith(expect.objectContaining({
      skip: 0, take: 25, select: FINANCE_TRANSACTION_SELECT,
      where: expect.objectContaining({ userId: "user-a", deleted: false, account: { active: true } }),
    }));
    expect(result.transactions[0]).toMatchObject({
      reportingAmountBrl: "-102.5", fxRateDate: "2026-08-25T00:00:00.000Z",
      ignored: false, providerLifecycle: "KEPT_MANUAL", tags: [transaction.tags[0].tag],
    });
  });
});
