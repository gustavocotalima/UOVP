import { prisma } from "@/lib/prisma";
import { BUDGET_CATEGORIES, type BudgetCategoryKey } from "@/features/budget/constants";
import { getPluggyCredentialStatus } from "@/features/open-finance/pluggy-credentials";
import type { FinanceData, FinanceGoalRecord, FinanceTransactionDto } from "./types";

export const AUVP_FINANCE_GOALS: FinanceGoalRecord = {
  FIXED_COSTS: 30,
  COMFORT: 15,
  GOALS: 15,
  PLEASURES: 10,
  FINANCIAL_FREEDOM: 25,
  KNOWLEDGE: 5,
};

export const AUVP_FINANCE_TAGS = [
  { name: "Alimentação", color: "#ef4444" },
  { name: "Contas de Casa", color: "#f59e0b" },
  { name: "Educação", color: "#3b82f6" },
  { name: "Lazer", color: "#a855f7" },
  { name: "Transporte", color: "#14b8a6" },
  { name: "Vestuário", color: "#ec4899" },
] as const;

export async function ensureFinanceSetup(userId: string) {
  await prisma.$transaction([
    prisma.financeProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    }),
    ...BUDGET_CATEGORIES.map((category) =>
      prisma.financeGoal.upsert({
        where: { userId_category: { userId, category } },
        update: {},
        create: { userId, category, percentage: AUVP_FINANCE_GOALS[category] },
      }),
    ),
    ...AUVP_FINANCE_TAGS.map((tag) =>
      prisma.financeTag.upsert({
        where: { userId_name: { userId, name: tag.name } },
        update: {},
        create: { userId, ...tag },
      }),
    ),
  ]);
}

function mapTransaction(
  transaction: {
    id: string;
    accountId: string;
    source: "PLUGGY" | "MANUAL";
    kind: "INCOME" | "EXPENSE";
    description: string;
    merchantName: string | null;
    amount: { toString(): string };
    currencyCode: string;
    date: Date;
    referenceYear: number;
    referenceMonth: number;
    budgetCategory: BudgetCategoryKey | null;
    providerCategory: string | null;
    status: string | null;
    note: string | null;
    ignored: boolean;
    internalTransfer: boolean;
    installmentNumber: number | null;
    installmentTotal: number | null;
    account: {
      name: string;
      type: "BANK_ACCOUNT" | "CREDIT_CARD";
      institutionName: string | null;
      institutionImageUrl: string | null;
    };
    tags: Array<{ tag: { id: string; name: string; color: string } }>;
  },
): FinanceTransactionDto {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    accountName: transaction.account.name,
    accountType: transaction.account.type,
    accountImageUrl: transaction.account.institutionImageUrl,
    institutionName: transaction.account.institutionName,
    source: transaction.source,
    kind: transaction.kind,
    description: transaction.description,
    merchantName: transaction.merchantName,
    amount: transaction.amount.toString(),
    currencyCode: transaction.currencyCode,
    date: transaction.date.toISOString(),
    referenceYear: transaction.referenceYear,
    referenceMonth: transaction.referenceMonth,
    budgetCategory: transaction.budgetCategory,
    providerCategory: transaction.providerCategory,
    status: transaction.status,
    note: transaction.note,
    ignored: transaction.ignored,
    internalTransfer: transaction.internalTransfer,
    installmentNumber: transaction.installmentNumber,
    installmentTotal: transaction.installmentTotal,
    tags: transaction.tags.map((item) => item.tag),
  };
}

export async function getFinanceData(userId: string, year: number, month: number): Promise<FinanceData> {
  await ensureFinanceSetup(userId);
  const [user, profile, goals, accounts, transactions, tags, pluggyItems, pluggyCredential] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, image: true },
    }),
    prisma.financeProfile.findUniqueOrThrow({ where: { userId } }),
    prisma.financeGoal.findMany({ where: { userId } }),
    prisma.financialAccount.findMany({
      where: { userId, active: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.financeTransaction.findMany({
      where: { userId, deleted: false, account: { active: true } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        account: {
          select: {
            name: true,
            type: true,
            institutionName: true,
            institutionImageUrl: true,
          },
        },
        tags: { include: { tag: true } },
      },
    }),
    prisma.financeTag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.pluggyItem.findMany({
      where: { userId },
      select: { syncPending: true, lastSyncAt: true },
    }),
    getPluggyCredentialStatus(userId),
  ]);

  const mappedTransactions = transactions.map(mapTransaction);
  return {
    year,
    month,
    user,
    profile: {
      monthlyIncome: profile.monthlyIncome.toString(),
      financialMonthStart: profile.financialMonthStart,
      objectives: profile.objectives,
    },
    goals: Object.fromEntries(
      BUDGET_CATEGORIES.map((category) => [
        category,
        Number(goals.find((goal) => goal.category === category)?.percentage ?? AUVP_FINANCE_GOALS[category]),
      ]),
    ) as FinanceGoalRecord,
    accounts: accounts.map((account) => ({
      id: account.id,
      source: account.source,
      type: account.type,
      subtype: account.subtype,
      name: account.name,
      institutionName: account.institutionName,
      institutionImageUrl: account.institutionImageUrl,
      accountNumber: account.accountNumber,
      agency: account.agency,
      numberLastFour: account.numberLastFour,
      bankCode: account.bankCode,
      brand: account.brand,
      balance: account.balance.toString(),
      creditLimit: account.creditLimit?.toString() ?? null,
      availableCredit: account.availableCredit?.toString() ?? null,
      dueDay: account.dueDay,
      closingDay: account.closingDay,
      currencyCode: account.currencyCode,
      sortOrder: account.sortOrder,
      providerUpdatedAt: account.providerUpdatedAt?.toISOString() ?? null,
    })),
    transactions: mappedTransactions.filter(
      (transaction) => transaction.referenceYear === year && transaction.referenceMonth === month,
    ),
    recentTransactions: mappedTransactions.slice(0, 8),
    historyTransactions: mappedTransactions,
    tags,
    pluggy: {
      configured: pluggyCredential.configured,
      itemCount: pluggyItems.length,
      pendingCount: pluggyItems.filter((item) => item.syncPending).length,
      lastSyncAt:
        pluggyItems
          .map((item) => item.lastSyncAt)
          .filter((value): value is Date => Boolean(value))
          .sort((left, right) => right.getTime() - left.getTime())[0]
          ?.toISOString() ?? null,
    },
  };
}
