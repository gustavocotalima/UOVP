import { prisma } from "@/lib/prisma";
import { BUDGET_CATEGORIES, type BudgetCategoryKey } from "@/features/budget/constants";
import { getPluggyCredentialStatus } from "@/features/open-finance/pluggy-credentials";
import { resolvePluggyInstitutionLogo } from "@/features/open-finance/institution-logo";
import { DEFAULT_FINANCE_TAGS } from "./classification";
import { needsFinanceClassification } from "./calculations";
import type { FinanceData, FinanceGoalRecord, FinanceTransactionDto } from "./types";

export const AUVP_FINANCE_GOALS: FinanceGoalRecord = {
  FIXED_COSTS: 30,
  COMFORT: 15,
  GOALS: 15,
  PLEASURES: 10,
  FINANCIAL_FREEDOM: 25,
  KNOWLEDGE: 5,
};

export const AUVP_FINANCE_TAGS = Object.entries(DEFAULT_FINANCE_TAGS).map(
  ([systemKey, tag]) => ({ systemKey, ...tag }),
);

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
        where: { userId_systemKey: { userId, systemKey: tag.systemKey } },
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
    descriptionRaw: string | null;
    merchantName: string | null;
    merchantBusinessName: string | null;
    merchantCnpj: string | null;
    merchantCategory: string | null;
    counterpartyName: string | null;
    paymentMethod: string | null;
    amount: { toString(): string };
    currencyCode: string;
    originalAmount: { toString(): string } | null;
    originalCurrencyCode: string | null;
    date: Date;
    referenceYear: number;
    referenceMonth: number;
    budgetCategory: BudgetCategoryKey | null;
    budgetCategorySource: "UNASSIGNED" | "PROVIDER_DEFAULT" | "USER_RULE" | "MANUAL";
    tagAssignmentSource: "UNASSIGNED" | "PROVIDER_DEFAULT" | "USER_RULE" | "MANUAL";
    providerCategory: string | null;
    providerCategoryId: string | null;
    status: string | null;
    note: string | null;
    ignored: boolean;
    internalTransfer: boolean;
    internalTransferSource: "UNASSIGNED" | "PROVIDER_DEFAULT" | "USER_RULE" | "MANUAL";
    installmentNumber: number | null;
    installmentTotal: number | null;
    classifiedAt: Date | null;
    account: {
      name: string;
      type: "BANK_ACCOUNT" | "CREDIT_CARD";
      institutionName: string | null;
      institutionImageUrl: string | null;
      bankCode: string | null;
      providerItemId: string | null;
    };
    tags: Array<{ tag: { id: string; systemKey: string | null; name: string; color: string } }>;
    classificationRule: { id: string; matchLabel: string } | null;
  },
  bankCodesByProviderItem: ReadonlyMap<string, Array<string | null>>,
): FinanceTransactionDto {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    accountName: transaction.account.name,
    accountType: transaction.account.type,
    accountImageUrl: transaction.source === "PLUGGY"
      ? resolvePluggyInstitutionLogo(
          transaction.account.institutionImageUrl,
          [
            transaction.account.bankCode,
            ...(transaction.account.providerItemId
              ? bankCodesByProviderItem.get(transaction.account.providerItemId) ?? []
              : []),
          ],
        )
      : transaction.account.institutionImageUrl,
    institutionName: transaction.account.institutionName,
    source: transaction.source,
    kind: transaction.kind,
    description: transaction.description,
    descriptionRaw: transaction.descriptionRaw,
    merchantName: transaction.merchantName,
    merchantBusinessName: transaction.merchantBusinessName,
    merchantCnpj: transaction.merchantCnpj,
    merchantCategory: transaction.merchantCategory,
    counterpartyName: transaction.counterpartyName,
    paymentMethod: transaction.paymentMethod,
    amount: transaction.amount.toString(),
    currencyCode: transaction.currencyCode,
    originalAmount: transaction.originalAmount?.toString() ?? null,
    originalCurrencyCode: transaction.originalCurrencyCode,
    date: transaction.date.toISOString(),
    referenceYear: transaction.referenceYear,
    referenceMonth: transaction.referenceMonth,
    budgetCategory: transaction.budgetCategory,
    budgetCategorySource: transaction.budgetCategorySource,
    tagAssignmentSource: transaction.tagAssignmentSource,
    providerCategory: transaction.providerCategory,
    providerCategoryId: transaction.providerCategoryId,
    status: transaction.status,
    note: transaction.note,
    ignored: transaction.ignored,
    internalTransfer: transaction.internalTransfer,
    internalTransferSource: transaction.internalTransferSource,
    installmentNumber: transaction.installmentNumber,
    installmentTotal: transaction.installmentTotal,
    classificationRule: transaction.classificationRule,
    classifiedAt: transaction.classifiedAt?.toISOString() ?? null,
    tags: transaction.tags.map((item) => item.tag),
  };
}

export async function getFinanceData(userId: string, year: number, month: number): Promise<FinanceData> {
  await ensureFinanceSetup(userId);
  const [user, profile, goals, accounts, transactions, tags, classificationRules, pluggyItems, pluggyCredential] = await Promise.all([
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
            bankCode: true,
            providerItemId: true,
          },
        },
        tags: { include: { tag: true } },
        classificationRule: { select: { id: true, matchLabel: true } },
      },
    }),
    prisma.financeTag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.financeClassificationRule.findMany({
      where: { userId },
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
      include: {
        tags: { include: { tag: true } },
        _count: { select: { appliedTransactions: true } },
      },
    }),
    prisma.pluggyItem.findMany({
      where: { userId, status: { not: "DELETED" } },
      select: { syncPending: true, lastSyncAt: true },
    }),
    getPluggyCredentialStatus(userId),
  ]);

  const bankCodesByProviderItem = new Map<string, Array<string | null>>();
  for (const account of accounts) {
    if (!account.providerItemId) continue;
    const bankCodes = bankCodesByProviderItem.get(account.providerItemId) ?? [];
    bankCodes.push(account.bankCode);
    bankCodesByProviderItem.set(account.providerItemId, bankCodes);
  }
  const mappedTransactions = transactions.map((transaction) =>
    mapTransaction(transaction, bankCodesByProviderItem),
  );
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
      institutionImageUrl: account.source === "PLUGGY"
        ? resolvePluggyInstitutionLogo(
            account.institutionImageUrl,
            [
              account.bankCode,
              ...(account.providerItemId
                ? bankCodesByProviderItem.get(account.providerItemId) ?? []
                : []),
            ],
          )
        : account.institutionImageUrl,
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
    classificationRules: classificationRules.map((rule) => ({
      id: rule.id,
      matchType: rule.matchType,
      matchValue: rule.matchValue,
      matchLabel: rule.matchLabel,
      kind: rule.kind,
      assignsBudgetCategory: rule.assignsBudgetCategory,
      budgetCategory: rule.budgetCategory,
      assignsTags: rule.assignsTags,
      assignsInternalTransfer: rule.assignsInternalTransfer,
      internalTransfer: rule.internalTransfer,
      enabled: rule.enabled,
      tags: rule.tags.map((item) => item.tag),
      appliedCount: rule._count.appliedTransactions,
    })),
    unclassifiedTransactionCount: mappedTransactions.filter(needsFinanceClassification).length,
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
