import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { BudgetCategoryKey } from "@/features/budget/constants";
import { calculatePeriodAmounts } from "./calculations";
import type { FinanceData, FinanceTransactionDto } from "./types";
import {
  FINANCE_ACCOUNT_SELECT, FINANCE_CLASSIFICATION_RULE_SELECT,
  FINANCE_CONNECTION_PREFERENCE_SELECT, FINANCE_GOAL_SELECT, FINANCE_PLUGGY_ITEM_SELECT,
  FINANCE_PROFILE_SELECT, FINANCE_TAG_SELECT, FINANCE_TRANSACTION_SELECT, FINANCE_USER_SELECT,
  financeBankCodesByProviderItem, financeReferencePeriods, mapFinanceClassificationRule,
  mapFinanceGoals, mapFinancePluggy, mapFinanceProfile, mapFinanceTransaction, mapFinancialAccount,
} from "./read-models";

export { mapFinanceTransaction } from "./read-models";

export type FinanceTransactionPageMode = "MONTH" | "UNCLASSIFIED" | "DELETIONS";

export type FinanceTransactionPageInput = {
  year: number;
  month: number;
  page: number;
  pageSize: number;
  mode: FinanceTransactionPageMode;
  search?: string;
  min?: number;
  max?: number;
  kind?: "INCOME" | "EXPENSE";
  category?: "NONE" | BudgetCategoryKey;
  tagId?: "NONE" | string;
  assignmentSource?: FinanceTransactionDto["budgetCategorySource"];
  accountId?: string;
  ignored?: "yes" | "no";
  internal?: "yes" | "no";
  sortKey?: "description" | "amount" | "date" | "account";
  sortDirection?: "asc" | "desc";
};

export async function getFinanceTransactionsPage(
  userId: string,
  input: FinanceTransactionPageInput,
) {
  const and: Prisma.FinanceTransactionWhereInput[] = [];
  if (input.mode === "MONTH") {
    and.push({ referenceYear: input.year, referenceMonth: input.month });
  } else if (input.mode === "UNCLASSIFIED") {
    and.push({
      kind: "EXPENSE",
      budgetCategorySource: "UNASSIGNED",
      ignored: false,
      internalTransfer: false,
    });
  } else {
    and.push({ providerLifecycle: "DELETION_PENDING" });
  }
  const search = input.search?.trim();
  if (search) {
    and.push({
      OR: [
        { description: { contains: search, mode: "insensitive" } },
        { merchantName: { contains: search, mode: "insensitive" } },
        { note: { contains: search, mode: "insensitive" } },
        { account: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }
  if (input.min !== undefined) {
    and.push({
      OR: [
        { amount: { gte: input.min } },
        { amount: { lte: -input.min } },
      ],
    });
  }
  if (input.max !== undefined) {
    and.push({ amount: { gte: -input.max, lte: input.max } });
  }
  if (input.kind) and.push({ kind: input.kind });
  if (input.category === "NONE") and.push({ budgetCategory: null });
  else if (input.category) and.push({ budgetCategory: input.category });
  if (input.tagId === "NONE") and.push({ tags: { none: {} } });
  else if (input.tagId) and.push({ tags: { some: { tagId: input.tagId } } });
  if (input.assignmentSource) and.push({ budgetCategorySource: input.assignmentSource });
  if (input.accountId) and.push({ accountId: input.accountId });
  if (input.ignored === "yes") and.push({ ignored: true });
  else if (input.ignored === "no") and.push({ ignored: false });
  if (input.internal === "yes") and.push({ internalTransfer: true });
  else if (input.internal === "no") and.push({ internalTransfer: false });

  const where: Prisma.FinanceTransactionWhereInput = {
    userId,
    deleted: false,
    account: { active: true },
    AND: and,
  };
  const direction = input.sortDirection ?? "desc";
  const orderBy: Prisma.FinanceTransactionOrderByWithRelationInput[] =
    input.sortKey === "description"
      ? [{ description: direction }, { id: direction }]
      : input.sortKey === "amount"
        ? [{ amount: direction }, { id: direction }]
        : input.sortKey === "account"
          ? [{ account: { name: direction } }, { id: direction }]
          : [{ date: direction }, { createdAt: direction }, { id: direction }];
  const reportableWhere: Prisma.FinanceTransactionWhereInput = {
    AND: [
      where,
      {
        ignored: false,
        internalTransfer: false,
        OR: [
          { providerLifecycle: null },
          { providerLifecycle: { not: "REMOVED" } },
        ],
      },
    ],
  };
  const [rows, total, income, expenses, missingFx, accountCodes] = await Promise.all([
    prisma.financeTransaction.findMany({
      where,
      orderBy,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: FINANCE_TRANSACTION_SELECT,
    }),
    prisma.financeTransaction.count({ where }),
    prisma.financeTransaction.aggregate({
      where: { AND: [reportableWhere, { kind: "INCOME", reportingAmountBrl: { not: null } }] },
      _sum: { reportingAmountBrl: true },
    }),
    prisma.financeTransaction.aggregate({
      where: { AND: [reportableWhere, { kind: "EXPENSE", reportingAmountBrl: { not: null } }] },
      _sum: { reportingAmountBrl: true },
    }),
    prisma.financeTransaction.count({
      where: { AND: [reportableWhere, { reportingAmountBrl: null }] },
    }),
    prisma.financialAccount.findMany({
      where: { userId, active: true, providerItemId: { not: null } },
      select: { providerItemId: true, bankCode: true },
    }),
  ]);
  const bankCodesByProviderItem = financeBankCodesByProviderItem(accountCodes);
  const grossIncome = Number(income._sum.reportingAmountBrl ?? 0);
  const spent = Math.abs(Number(expenses._sum.reportingAmountBrl ?? 0));
  return {
    page: input.page,
    pageSize: input.pageSize,
    total,
    transactions: rows.map((transaction) =>
      mapFinanceTransaction(transaction, bankCodesByProviderItem),
    ),
    totals: {
      grossIncome,
      spent,
      balance: grossIncome - spent,
      missingFxCount: missingFx,
    },
  };
}

export async function getFinanceData(
  userId: string,
  year: number,
  month: number,
  options: {
    transactionScope?: "MONTH" | "PAGINATED" | "INVOICE_HISTORY" | "NONE";
    includeHistory?: boolean;
  } = {},
): Promise<FinanceData> {
  const transactionScope = options.transactionScope ?? "MONTH";
  const historyPeriods = financeReferencePeriods(year, month);
  const transactionBaseWhere = { userId, deleted: false, account: { active: true } } as const;
  const unclassifiedWhere = {
    ...transactionBaseWhere,
    kind: "EXPENSE" as const,
    budgetCategorySource: "UNASSIGNED" as const,
    ignored: false,
    internalTransfer: false,
  };
  const transactionWhere =
    transactionScope === "INVOICE_HISTORY"
      ? { ...transactionBaseWhere, OR: historyPeriods }
      : { ...transactionBaseWhere, referenceYear: year, referenceMonth: month };
  const [
    user,
    profile,
    preference,
    goals,
    accounts,
    transactions,
    tags,
    classificationRules,
    pluggyItems,
    unclassifiedTransactionCount,
    pendingFxTransactionCount,
    pendingDeletionCount,
    historyGroups,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: FINANCE_USER_SELECT,
    }),
    prisma.financeProfile.findUniqueOrThrow({ where: { userId }, select: FINANCE_PROFILE_SELECT }),
    prisma.userPreference.findUnique({ where: { userId }, select: FINANCE_CONNECTION_PREFERENCE_SELECT }),
    prisma.financeGoal.findMany({ where: { userId }, select: FINANCE_GOAL_SELECT }),
    prisma.financialAccount.findMany({
      where: { userId, active: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: FINANCE_ACCOUNT_SELECT,
    }),
    transactionScope === "NONE" ? Promise.resolve([]) : prisma.financeTransaction.findMany({
      where: transactionWhere,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      ...(transactionScope === "PAGINATED" ? { take: 25 } : {}),
      select: FINANCE_TRANSACTION_SELECT,
    }),
    prisma.financeTag.findMany({ where: { userId }, orderBy: { name: "asc" }, select: FINANCE_TAG_SELECT }),
    prisma.financeClassificationRule.findMany({
      where: { userId },
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
      select: FINANCE_CLASSIFICATION_RULE_SELECT,
    }),
    prisma.pluggyItem.findMany({
      where: { userId, status: { not: "DELETED" } },
      select: FINANCE_PLUGGY_ITEM_SELECT,
    }),
    prisma.financeTransaction.count({ where: unclassifiedWhere }),
    prisma.financeTransaction.count({
      where: {
        ...transactionBaseWhere,
        reportingAmountBrl: null,
        ignored: false,
        internalTransfer: false,
        OR: [
          { providerLifecycle: null },
          { providerLifecycle: { not: "REMOVED" as const } },
        ],
      },
    }),
    prisma.financeTransaction.count({
      where: { ...transactionBaseWhere, providerLifecycle: "DELETION_PENDING" as const },
    }),
    options.includeHistory
      ? prisma.financeTransaction.groupBy({
          by: ["referenceYear", "referenceMonth", "kind", "budgetCategory"],
          where: {
            ...transactionBaseWhere,
            OR: historyPeriods,
            AND: [{
              OR: [
                { providerLifecycle: null },
                { providerLifecycle: { not: "REMOVED" } },
              ],
            }],
            ignored: false,
            internalTransfer: false,
            reportingAmountBrl: { not: null },
          },
          _sum: { reportingAmountBrl: true },
        })
      : Promise.resolve([]),
  ]);

  const bankCodesByProviderItem = financeBankCodesByProviderItem(accounts);
  const mappedTransactions = transactions.map((transaction) =>
    mapFinanceTransaction(transaction, bankCodesByProviderItem),
  );
  const history = historyPeriods
    .slice()
    .reverse()
    .map((period) => {
      const totals = calculatePeriodAmounts(
        historyGroups
          .filter(
            (group) => group.referenceYear === period.referenceYear
              && group.referenceMonth === period.referenceMonth,
          )
          .map((group) => ({
            kind: group.kind,
            budgetCategory: group.budgetCategory,
            referenceYear: group.referenceYear,
            referenceMonth: group.referenceMonth,
            value: Number(group._sum.reportingAmountBrl ?? 0),
          })),
      );
      return {
        year: period.referenceYear,
        month: period.referenceMonth,
        netIncome: totals.budgetBaseIncome,
        spent: totals.spent,
        balance: totals.balance,
      };
    });
  return {
    year,
    month,
    user,
    profile: mapFinanceProfile(profile, preference?.timeZone),
    goals: mapFinanceGoals(goals),
    accounts: accounts.map((account) => mapFinancialAccount(account, bankCodesByProviderItem)),
    transactions: mappedTransactions.filter(
      (transaction) => transaction.referenceYear === year && transaction.referenceMonth === month,
    ),
    recentTransactions: mappedTransactions
      .filter(
        (transaction) => transaction.referenceYear === year && transaction.referenceMonth === month,
      )
      .slice(0, 8),
    historyTransactions: transactionScope === "INVOICE_HISTORY" ? mappedTransactions : [],
    history,
    tags,
    classificationRules: classificationRules.map(mapFinanceClassificationRule),
    unclassifiedTransactionCount,
    pendingFxTransactionCount,
    pendingDeletionCount,
    pluggy: mapFinancePluggy(preference, pluggyItems),
  };
}
