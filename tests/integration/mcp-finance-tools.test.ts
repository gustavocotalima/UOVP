import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { financeTools } from "@/features/mcp/finance-tools";
import { readAnalysis } from "@/features/mcp/query";
import type { McpContext } from "@/features/mcp/types";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("MCP financial queries and database read-only enforcement", () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  let userId = "";
  let otherUserId = "";
  let accountId = "";
  let otherTransactionId = "";
  let context: McpContext;
  const period = { year: 2098, month: 8 };
  const range = { fromYear: 2098, fromMonth: 8, toYear: 2098, toMonth: 8 };

  function execute(name: string, input: Record<string, unknown>) {
    return financeTools.find((definition) => definition.name === name)!.execute(context, input);
  }

  beforeAll(async () => {
    const [user, other] = await Promise.all([
      prisma.user.create({ data: { email: `mcp-finance-${suffix}@example.com` } }),
      prisma.user.create({ data: { email: `mcp-finance-other-${suffix}@example.com` } }),
    ]);
    userId = user.id;
    otherUserId = other.id;
    context = { userId, clientId: "test", grantId: "test", timeZone: "America/Sao_Paulo", scopes: ["finance:read", "accounts:read", "transactions:read", "balance-sheet:read"] };
    const account = await prisma.financialAccount.create({
      data: { userId, source: "MANUAL", type: "BANK_ACCOUNT", name: "Integration USD", currencyCode: "USD", balance: "548.15", balanceBrl: "2850.38", balanceFxRateToBrl: "5.2", balanceFxSource: "YAHOO", balanceFxRateDate: new Date("2098-08-01") },
    });
    accountId = account.id;
    await prisma.financeTransaction.createMany({
      data: ([
        { amount: "20.46", reportingAmountBrl: "20.46", kind: "INCOME", budgetCategory: null },
        { amount: "540.60", reportingAmountBrl: "540.60", kind: "INCOME", budgetCategory: "FINANCIAL_FREEDOM" },
        { amount: "-540.60", reportingAmountBrl: "-540.60", kind: "EXPENSE", budgetCategory: "FINANCIAL_FREEDOM" },
        { amount: "-635.15", reportingAmountBrl: "-635.15", kind: "EXPENSE", budgetCategory: null },
        { amount: "-100", reportingAmountBrl: "-100", kind: "EXPENSE", budgetCategory: null, ignored: true },
        { amount: "-100", reportingAmountBrl: "-100", kind: "EXPENSE", budgetCategory: null, internalTransfer: true },
        { amount: "-100", reportingAmountBrl: "-100", kind: "EXPENSE", budgetCategory: null, providerLifecycle: "REMOVED" },
        { amount: "-100", reportingAmountBrl: null, kind: "EXPENSE", budgetCategory: null },
      ] as const).map((row, index) => ({
        ...row, userId, accountId, source: "MANUAL" as const, currencyCode: "USD",
        description: `MCP fixture ${index}`, date: new Date("2098-08-08T12:00:00Z"), referenceYear: 2098, referenceMonth: 8,
      })),
    });
    const otherAccount = await prisma.financialAccount.create({
      data: { userId: otherUserId, source: "MANUAL", type: "BANK_ACCOUNT", name: "Other private account", balance: 99999, balanceBrl: 99999 },
    });
    const otherTransaction = await prisma.financeTransaction.create({
      data: { userId: otherUserId, accountId: otherAccount.id, source: "MANUAL", kind: "INCOME", description: "Other private income", amount: 99999, reportingAmountBrl: 99999, date: new Date("2098-08-08T12:00:00Z"), referenceYear: 2098, referenceMonth: 8 },
    });
    otherTransactionId = otherTransaction.id;
  });

  afterAll(async () => {
    if (userId || otherUserId) await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("matches net report rules and ignores hidden/internal/removed/unconverted values", async () => {
    const output = await execute("get_financial_summary", period);
    expect(output.data).toMatchObject({
      totals: { grossIncome: "561.06", netIncome: "20.46", grossExpenses: "1175.75", compensationApplied: "540.60", netExpenses: "635.15", netResult: "-614.69" },
      currentAccountTotals: { bankBalance: "2850.38" }, missingFxCount: 1, complete: false,
    });
    expect(JSON.stringify(output)).not.toContain("Other private");
  });

  it("rejects by-ID access to another user's transaction", async () => {
    await expect(execute("get_transaction", { transactionId: otherTransactionId })).rejects.toThrow("Transaction not found.");
    const output = await execute("list_transactions", { ...range, pageSize: 100 });
    const data = output.data as { transactions: { id: string }[] };
    expect(data.transactions.some((row) => row.id === otherTransactionId)).toBe(false);
    expect(data.transactions).toHaveLength(8);
  });

  it("never provisions profiles, goals, tags, portfolios or changes account balances", async () => {
    const before = await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId }, select: { balance: true, balanceBrl: true, updatedAt: true } });
    await execute("get_budget_progress", period);
    await execute("get_tag_cashflow", period);
    await execute("get_daily_expenses", period);
    await execute("get_financial_history", range);
    await execute("get_balance_sheet", {});
    const after = await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId }, select: { balance: true, balanceBrl: true, updatedAt: true } });
    expect(after).toEqual(before);
    const counts = await Promise.all([
      prisma.financeProfile.count({ where: { userId } }), prisma.financeGoal.count({ where: { userId } }),
      prisma.financeTag.count({ where: { userId } }), prisma.portfolio.count({ where: { userId } }),
      prisma.contributionSimulation.count({ where: { userId } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0]);
  });

  it("PostgreSQL itself refuses accidental domain writes in readAnalysis", async () => {
    await expect(readAnalysis(context, (tx) => tx.financialAccount.update({ where: { id: accountId }, data: { balance: 1 } }))).rejects.toThrow();
    const account = await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId }, select: { balance: true } });
    expect(account.balance.toString()).toBe("548.15");
  });
});
