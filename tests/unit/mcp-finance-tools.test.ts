import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  readAnalysis: vi.fn(),
  db: {
    financeTransaction: { findMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    financialAccount: { findMany: vi.fn(), findFirst: vi.fn() },
    financeGoal: { findMany: vi.fn() },
    financeTag: { findMany: vi.fn() },
    balanceSheetEntry: { findMany: vi.fn() },
  },
}));

vi.mock("@/features/mcp/query", () => ({ readAnalysis: mocks.readAnalysis }));

import { financeTools } from "@/features/mcp/finance-tools";
import { McpError, type McpContext, type McpScope } from "@/features/mcp/types";

const context: McpContext = {
  userId: "user-a", clientId: "client", grantId: "grant", timeZone: "America/Sao_Paulo",
  scopes: ["finance:read", "accounts:read", "transactions:read", "balance-sheet:read"],
};
const period = { year: 2026, month: 8 };
const range = { fromYear: 2026, fromMonth: 8, toYear: 2026, toMonth: 8 };
const decimal = (value: string) => new Prisma.Decimal(value);

function execute(name: string, input: Record<string, unknown>, ctx = context) {
  const definition = financeTools.find((tool) => tool.name === name)!;
  return definition.execute(ctx, input);
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "account", source: "MANUAL", type: "BANK_ACCOUNT", subtype: null,
    name: "Nomad", institutionName: "Nomad", bankCode: null,
    balance: decimal("548.15"), balanceBrl: decimal("2850.38"),
    currencyCode: "USD", balanceFxRateToBrl: decimal("5.2"),
    balanceFxRateDate: new Date("2026-08-10T00:00:00Z"), balanceFxSource: "YAHOO",
    creditLimit: null, availableCredit: null, dueDay: null, closingDay: null,
    providerUpdatedAt: null, updatedAt: new Date("2026-08-10T12:00:00Z"), ...overrides,
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "txn", accountId: "account", source: "MANUAL", kind: "EXPENSE",
    description: "BOLT", amount: decimal("-1.74"), currencyCode: "USD",
    reportingAmountBrl: decimal("-9.03"), fxRateToBrl: decimal("5.189655"),
    fxRateDate: new Date("2026-08-07T00:00:00Z"), fxSource: "MANUAL",
    originalAmount: null, originalCurrencyCode: null, date: new Date("2026-08-08T12:00:00Z"),
    referenceYear: 2026, referenceMonth: 8, budgetCategory: "FIXED_COSTS",
    budgetCategorySource: "MANUAL", status: null, ignored: false,
    internalTransfer: false, providerLifecycle: null, installmentNumber: null, installmentTotal: null,
    createdAt: new Date("2026-08-08T12:01:00Z"), updatedAt: new Date("2026-08-08T12:01:00Z"),
    account: { name: "Nomad", type: "BANK_ACCOUNT" }, tags: [], ...overrides,
  };
}

function group(value: string, budgetCategory: "FINANCIAL_FREEDOM" | "FIXED_COSTS" | null, month = 8) {
  return {
    referenceYear: 2026, referenceMonth: month,
    kind: value.startsWith("-") ? "EXPENSE" : "INCOME", budgetCategory,
    _sum: { reportingAmountBrl: decimal(value) }, _count: { _all: 1 },
  };
}

describe("read-only MCP finance tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAnalysis.mockImplementation((_context, callback) => callback(mocks.db));
    mocks.db.financeTransaction.findMany.mockResolvedValue([]);
    mocks.db.financeTransaction.findFirst.mockResolvedValue(null);
    mocks.db.financeTransaction.groupBy.mockResolvedValue([]);
    mocks.db.financeTransaction.count.mockResolvedValue(0);
    mocks.db.financialAccount.findMany.mockResolvedValue([]);
    mocks.db.financialAccount.findFirst.mockResolvedValue(null);
    mocks.db.financeGoal.findMany.mockResolvedValue([]);
    mocks.db.financeTag.findMany.mockResolvedValue([]);
    mocks.db.balanceSheetEntry.findMany.mockResolvedValue([]);
  });

  it("defines schemas and read scopes without write tools", () => {
    expect(financeTools).toHaveLength(10);
    for (const definition of financeTools) {
      expect(definition.scope.endsWith(":read")).toBe(true);
      expect(definition.outputSchema).toBeDefined();
    }
  });

  it("rejects missing scope before reading the database", () => {
    expect(() => execute("list_accounts", {}, { ...context, scopes: ["finance:read"] })).toThrow(McpError);
    expect(mocks.readAnalysis).not.toHaveBeenCalled();
  });

  it.each<{
    scopes: McpScope[]; summaryAllowed: boolean; balancesAllowed: boolean;
  }>([
    { scopes: ["finance:read"], summaryAllowed: true, balancesAllowed: false },
    { scopes: ["accounts:read"], summaryAllowed: false, balancesAllowed: true },
    { scopes: ["finance:read", "accounts:read"], summaryAllowed: true, balancesAllowed: true },
    { scopes: [], summaryAllowed: false, balancesAllowed: false },
  ])("isolates summary/account permissions for $scopes", async ({ scopes, summaryAllowed, balancesAllowed }) => {
    const scopedContext = { ...context, scopes };
    mocks.db.financialAccount.findMany.mockResolvedValue([account()]);
    if (summaryAllowed) {
      const result = await execute("get_financial_summary", period, scopedContext);
      expect(result.data).toMatchObject({
        currentAccountTotals: balancesAllowed ? { bankBalance: "2850.38" } : null,
        complete: true,
      });
      expect(mocks.db.financialAccount.findMany).toHaveBeenCalledTimes(balancesAllowed ? 1 : 0);
      const definition = financeTools.find((candidate) => candidate.name === "get_financial_summary")!;
      expect(z.object(definition.outputSchema!).safeParse(result).success).toBe(true);
    } else {
      expect(() => execute("get_financial_summary", period, scopedContext)).toThrow(McpError);
      expect(mocks.readAnalysis).not.toHaveBeenCalled();
    }
    if (balancesAllowed) {
      const result = await execute("list_accounts", {}, scopedContext);
      expect(result.data).toMatchObject({ totals: { bankBalance: "2850.38" } });
    } else {
      expect(() => execute("list_accounts", {}, scopedContext)).toThrow(McpError);
    }
  });

  it("omits balance FX/overlap warnings and keeps permitted data complete without accounts:read", async () => {
    mocks.db.financeTransaction.groupBy.mockResolvedValue([group("100", null)]);
    mocks.db.financialAccount.findMany.mockResolvedValue([
      account({ balanceBrl: null, investmentLink: { enabled: true, assetHoldingId: "private-holding", status: "MAPPED" } }),
    ]);
    const output = await execute("get_financial_summary", period, { ...context, scopes: ["finance:read"] });
    expect(output.data).toMatchObject({
      totals: { grossIncome: "100.00" }, currentAccountTotals: null, missingFxCount: 0, complete: true,
    });
    expect(output.warnings).toEqual([]);
    expect(mocks.db.financialAccount.findMany).not.toHaveBeenCalled();

    mocks.db.financeTransaction.count.mockResolvedValue(1);
    const incomplete = await execute("get_financial_summary", period, { ...context, scopes: ["finance:read"] });
    expect(incomplete.data).toMatchObject({ currentAccountTotals: null, missingFxCount: 1, complete: false });
    expect(incomplete.warnings).toEqual([expect.stringContaining("eligible transaction")]);
  });

  it("rejects userId inputs, oversized pages and periods longer than twelve months", async () => {
    expect(() => execute("get_financial_summary", { ...period, userId: "other" })).toThrow();
    expect(() => execute("list_accounts", { pageSize: 101 })).toThrow();
    await expect(execute("list_transactions", { ...range, fromMonth: 1, toYear: 2027, toMonth: 1 })).rejects.toThrow(/twelve/);
    expect(mocks.db.financeTransaction.findMany).not.toHaveBeenCalled();
  });

  it("reproduces net reinvestment summaries without changing gross flows", async () => {
    mocks.db.financeTransaction.groupBy.mockResolvedValue([
      group("20.46", null), group("540.60", "FINANCIAL_FREEDOM"),
      group("-540.60", "FINANCIAL_FREEDOM"), group("-635.15", null),
    ]);
    mocks.db.financialAccount.findMany.mockResolvedValue([account({ currencyCode: "BRL", balance: decimal("1220.78"), balanceBrl: decimal("1220.78") })]);
    const result = await execute("get_financial_summary", period);
    expect(result.data).toMatchObject({
      totals: { grossIncome: "561.06", netIncome: "20.46", grossExpenses: "1175.75", compensationApplied: "540.60", netExpenses: "635.15", netResult: "-614.69" },
      currentAccountTotals: { bankBalance: "1220.78" }, complete: true,
    });
    expect(mocks.db.financeTransaction.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([
      expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ userId: "user-a", deleted: false, ignored: false, internalTransfer: false, account: { userId: "user-a", active: true } })]) }),
    ]) }) }));
  });

  it("never compensates across financial reference months", async () => {
    mocks.db.financeTransaction.groupBy.mockResolvedValue([group("100", "FIXED_COSTS", 7), group("-100", "FIXED_COSTS", 8)]);
    const result = await execute("get_financial_history", { ...range, fromMonth: 7 });
    expect(result.data).toMatchObject({ months: [
      { month: 7, netIncome: "0.00", netExpenses: "0.00" },
      { month: 8, compensationApplied: "0.00", netExpenses: "100.00", netResult: "-100.00" },
    ] });
  });

  it("returns unknown conversion and completeness warnings rather than counting it as zero", async () => {
    mocks.db.financeTransaction.count.mockResolvedValue(1);
    mocks.db.financialAccount.findMany.mockResolvedValue([account({ balanceBrl: null })]);
    const result = await execute("get_financial_summary", period);
    expect(result.data).toMatchObject({ missingFxCount: 1, complete: false, currentAccountTotals: { missingFxCount: 1 } });
    expect(result.warnings).toHaveLength(2);
  });

  it("exposes USD balances and current FX without private identifiers", async () => {
    mocks.db.financialAccount.findMany.mockResolvedValue([account()]);
    const result = await execute("list_accounts", {});
    expect(result.data).toMatchObject({ accounts: [{ currencyCode: "USD", balance: "548.15", balanceBrl: "2850.38", fx: { rateToBrl: "5.2", source: "YAHOO" } }] });
    const call = mocks.db.financialAccount.findMany.mock.calls[0][0];
    expect(call.where.userId).toBe(context.userId);
    for (const key of ["accountNumber", "agency", "numberLastFour", "externalId", "providerItemId"]) expect(call.select[key]).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("accountNumber");
  });

  it("keeps account aggregate totals outside page limits and in decimal precision", async () => {
    mocks.db.financialAccount.findMany.mockResolvedValue([
      account({ id: "a", balanceBrl: decimal("9007199254740993.15") }),
      account({ id: "b", balanceBrl: decimal("0.01") }),
    ]);
    const result = await execute("list_accounts", { pageSize: 1 });
    expect(result.data).toMatchObject({ totalCount: 2, nextCursor: "a", totals: { bankBalance: "9007199254740993.16" } });
    expect((result.data as { accounts: unknown[] }).accounts).toHaveLength(1);
  });

  it("uses plain decimal strings even for tiny FX rates", async () => {
    mocks.db.financialAccount.findMany.mockResolvedValue([account({ balanceFxRateToBrl: decimal("0.0000000001") })]);
    const definition = financeTools.find((tool) => tool.name === "list_accounts")!;
    const result = await execute(definition.name, {});
    expect(result.data).toMatchObject({ accounts: [{ fx: { rateToBrl: "0.0000000001" } }] });
    expect(z.object(definition.outputSchema!).safeParse(result).success).toBe(true);
  });

  it("refuses report calculations beyond safe cent precision instead of rounding silently", async () => {
    mocks.db.financeTransaction.groupBy.mockResolvedValue([group("9007199254740993.15", null)]);
    await expect(execute("get_financial_summary", period)).rejects.toThrow(/precision/);
  });

  it("owns detail lookup and redacts CPF from financial descriptions", async () => {
    mocks.db.financeTransaction.findFirst.mockResolvedValue(transaction({ description: "Compra 123.456.789-00", account: { name: "Conta 12345678900", type: "BANK_ACCOUNT" } }));
    const result = await execute("get_transaction", { transactionId: "txn" });
    expect(result.data).toMatchObject({ transaction: { amount: "-1.74", reportingAmountBrl: "-9.03", description: "Compra [CPF]", accountName: "Conta [identifier]", fx: { source: "MANUAL", date: "2026-08-07" } } });
    expect(mocks.db.financeTransaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "txn", userId: context.userId, account: { userId: context.userId, active: true } }) }));
    const select = mocks.db.financeTransaction.findFirst.mock.calls[0][0].select;
    for (const key of ["merchantCnpj", "descriptionRaw", "note", "providerCategoryId", "externalId"]) expect(select[key]).toBeUndefined();
  });

  it("does not disclose whether another user's transaction exists", async () => {
    await expect(execute("get_transaction", { transactionId: "other-user-txn" })).rejects.toThrow("Transaction not found.");
  });

  it("returns full transaction-page gross totals with stable tuple pagination", async () => {
    mocks.db.financeTransaction.findMany.mockResolvedValue([transaction({ id: "newer" }), transaction({ id: "older" })]);
    mocks.db.financeTransaction.count.mockResolvedValue(100);
    mocks.db.financeTransaction.groupBy.mockResolvedValue([group("-900", null)]);
    const result = await execute("list_transactions", { ...range, pageSize: 1 });
    const data = result.data as { nextCursor: string; transactions: unknown[] };
    expect(data.transactions).toHaveLength(1);
    expect(result.data).toMatchObject({ totalCount: 100, grossTotals: { expenses: "900.00", balance: "-900.00" } });
    await execute("list_transactions", { ...range, pageSize: 1, cursor: data.nextCursor });
    const query = mocks.db.financeTransaction.findMany.mock.calls[1][0];
    expect(query.take).toBe(2);
    expect(query.orderBy).toEqual([{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
    expect(query.where.AND[0]).toMatchObject({ userId: context.userId });
    expect(query.where.AND[1].OR).toHaveLength(3);
  });

  it("rejects malformed cursors without querying transaction rows", async () => {
    await expect(execute("list_transactions", { ...range, cursor: "!!invalid!!" })).rejects.toThrow("Invalid transaction cursor.");
    expect(mocks.db.financeTransaction.findMany).not.toHaveBeenCalled();
  });

  it("uses existing goal percentages without creating setup and reports missing configuration", async () => {
    mocks.db.financeTransaction.groupBy.mockResolvedValue([group("1000", null), group("100", "FIXED_COSTS"), group("-400", "FIXED_COSTS")]);
    mocks.db.financeGoal.findMany.mockResolvedValue([{ category: "FIXED_COSTS", percentage: decimal("30") }]);
    const result = await execute("get_budget_progress", period);
    expect(result.data).toMatchObject({ configured: false, netIncome: "1000.00", categories: expect.arrayContaining([
      expect.objectContaining({ category: "FIXED_COSTS", percentage: "30", target: "300.00", netExpenses: "300.00", compensationApplied: "100.00", usagePercent: "100.00" }),
      expect.objectContaining({ category: "COMFORT", target: null, percentage: null }),
    ]) });
  });

  it("tags reflect their actual incomes/outflows and split cents deterministically", async () => {
    const a = { id: "a", name: "Assinaturas", color: "#ff0000", systemKey: null };
    const b = { id: "b", name: "Contas da Casa", color: "#00ff00", systemKey: null };
    mocks.db.financeTag.findMany.mockResolvedValue([a, b]);
    mocks.db.financeTransaction.findMany.mockResolvedValue([
      transaction({ amount: decimal("-0.01"), reportingAmountBrl: decimal("-0.01"), tags: [{ tag: b }, { tag: a }] }),
      transaction({ id: "income", kind: "INCOME", amount: decimal("20"), reportingAmountBrl: decimal("20"), tags: [{ tag: b }] }),
    ]);
    const result = await execute("get_tag_cashflow", period);
    expect(result.data).toMatchObject({ grossIncome: "20.00", grossExpenses: "0.01", tags: [
      { id: "b", income: "20.00", expenses: "0.00" }, { id: "a", income: "0.00", expenses: "0.01" },
    ] });
  });

  it("calendar returns full BOLT amount even with same-goal income", async () => {
    mocks.db.financeTransaction.findMany.mockResolvedValue([
      transaction(), transaction({ id: "offset", kind: "INCOME", amount: decimal("1.6"), reportingAmountBrl: decimal("1.6") }),
    ]);
    const result = await execute("get_daily_expenses", period);
    const data = result.data as { days: { date: string; expenses: string }[] };
    expect(data.days.find((day) => day.date === "2026-08-08")?.expenses).toBe("9.03");
    expect(result.data).toMatchObject({ total: "9.03", inCalendarTotal: "9.03" });
    expect(JSON.stringify(result)).not.toContain("BOLT"); // finance summary scope exposes no individual descriptions.
  });

  it("separates actual dates outside a transaction's financial reference month", async () => {
    mocks.db.financeTransaction.findMany.mockResolvedValue([transaction({ date: new Date("2026-07-10T12:00:00Z") })]);
    const result = await execute("get_daily_expenses", period);
    expect(result.data).toMatchObject({ total: "9.03", inCalendarTotal: "0.00", outsideCalendarTotal: "9.03", outsideCalendarTransactionCount: 1 });
  });

  it("labels card invoices as estimates and retains native USD versus reporting BRL", async () => {
    mocks.db.financialAccount.findFirst.mockResolvedValue(account({ type: "CREDIT_CARD", dueDay: 14, closingDay: 7 }));
    mocks.db.financeTransaction.findMany.mockResolvedValue([transaction({ account: { name: "Nomad", type: "CREDIT_CARD" } })]);
    const result = await execute("get_card_invoices", { ...range, accountId: "account" });
    expect(result.data).toMatchObject({ estimated: true, invoices: expect.arrayContaining([{ key: "2026-09", year: 2026, month: 9, dueDate: "2026-09-14", open: expect.any(Boolean), currencyCode: "USD", total: "1.74", totalBrl: "9.03", transactionCount: 1, missingFxCount: 0 }]) });
    expect(mocks.db.financialAccount.findFirst.mock.calls[0][0].where).toMatchObject({ userId: context.userId, type: "CREDIT_CARD" });
    expect(JSON.stringify(result)).not.toContain("BOLT");
    expect(result.warnings).toHaveLength(1);
  });

  it("keeps separate balance-sheet totals precise and warns about overlap", async () => {
    mocks.db.balanceSheetEntry.findMany.mockResolvedValue([
      { id: "a", category: "CASH", name: "Caixa", value: decimal("1000.01"), updatedAt: new Date("2026-08-01") },
      { id: "b", category: "CURRENT_LIABILITY", name: "Dívida", value: decimal("500.00"), updatedAt: new Date("2026-08-01") },
    ]);
    const result = await execute("get_balance_sheet", { pageSize: 1 });
    expect(result.data).toMatchObject({ separateFromPortfolio: true, totals: { assets: "1000.01", liabilities: "500.00", netWorth: "500.01" }, totalCount: 2, nextCursor: "a" });
    expect(result.warnings).toHaveLength(1);
    expect(mocks.db.balanceSheetEntry.findMany.mock.calls[0][0].where.userId).toBe(context.userId);
  });

  it("its output schemas accept actual returned envelopes", async () => {
    const definition = financeTools.find((tool) => tool.name === "get_financial_summary")!;
    const output = await execute(definition.name, period);
    expect(z.object(definition.outputSchema!).safeParse(output).success).toBe(true);
  });
});
