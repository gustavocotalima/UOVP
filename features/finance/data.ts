import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUDGET_CATEGORIES, type BudgetCategoryKey } from "@/features/budget/constants";
import { getPluggyCredentialStatus } from "@/features/open-finance/pluggy-credentials";
import {
  resolvePluggyInstitutionLogo,
  resolvePluggyInstitutionName,
} from "@/features/open-finance/institution-logo";
import { DEFAULT_FINANCE_TAGS } from "./classification";
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

export function mapFinanceTransaction(
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
    reportingAmountBrl: { toString(): string } | null;
    fxRateToBrl: { toString(): string } | null;
    fxRateDate: Date | null;
    fxSource: "NATIVE" | "PLUGGY" | "YAHOO" | "MANUAL" | null;
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
    providerLifecycle: "ACTIVE" | "DELETION_PENDING" | "KEPT_MANUAL" | "REMOVED" | null;
    providerDeletedAt: Date | null;
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
    institutionName: transaction.source === "PLUGGY"
      ? resolvePluggyInstitutionName(
          transaction.account.institutionName,
          null,
          [
            transaction.account.bankCode,
            ...(transaction.account.providerItemId
              ? bankCodesByProviderItem.get(transaction.account.providerItemId) ?? []
              : []),
          ],
        )
      : transaction.account.institutionName,
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
    reportingAmountBrl: transaction.reportingAmountBrl?.toString() ?? null,
    fxRateToBrl: transaction.fxRateToBrl?.toString() ?? null,
    fxRateDate: transaction.fxRateDate?.toISOString() ?? null,
    fxSource: transaction.fxSource,
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
    providerLifecycle: transaction.providerLifecycle,
    providerDeletedAt: transaction.providerDeletedAt?.toISOString() ?? null,
    internalTransfer: transaction.internalTransfer,
    internalTransferSource: transaction.internalTransferSource,
    installmentNumber: transaction.installmentNumber,
    installmentTotal: transaction.installmentTotal,
    classificationRule: transaction.classificationRule,
    classifiedAt: transaction.classifiedAt?.toISOString() ?? null,
    tags: transaction.tags.map((item) => item.tag),
  };
}

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
        providerLifecycle: { not: "REMOVED" },
      },
    ],
  };
  const [rows, total, income, expenses, missingFx, accountCodes] = await Promise.all([
    prisma.financeTransaction.findMany({
      where,
      orderBy,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
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
  const bankCodesByProviderItem = new Map<string, Array<string | null>>();
  for (const account of accountCodes) {
    if (!account.providerItemId) continue;
    const codes = bankCodesByProviderItem.get(account.providerItemId) ?? [];
    codes.push(account.bankCode);
    bankCodesByProviderItem.set(account.providerItemId, codes);
  }
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
  await ensureFinanceSetup(userId);
  const transactionScope = options.transactionScope ?? "MONTH";
  const historyPeriods = Array.from({ length: 12 }, (_, offset) => {
    const monthIndex = year * 12 + month - 1 - offset;
    return {
      referenceYear: Math.floor(monthIndex / 12),
      referenceMonth: (monthIndex % 12) + 1,
    };
  });
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
    pluggyCredential,
    unclassifiedTransactionCount,
    pendingFxTransactionCount,
    pendingDeletionCount,
    historyGroups,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, image: true },
    }),
    prisma.financeProfile.findUniqueOrThrow({ where: { userId } }),
    prisma.userPreference.findUnique({ where: { userId }, select: { timeZone: true } }),
    prisma.financeGoal.findMany({ where: { userId } }),
    prisma.financialAccount.findMany({
      where: { userId, active: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.financeTransaction.findMany({
      where: transactionScope === "NONE"
        ? { ...transactionBaseWhere, id: "__none__" }
        : transactionWhere,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      ...(transactionScope === "PAGINATED" ? { take: 25 } : {}),
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
    prisma.financeTransaction.count({ where: unclassifiedWhere }),
    prisma.financeTransaction.count({
      where: {
        ...transactionBaseWhere,
        reportingAmountBrl: null,
        ignored: false,
        internalTransfer: false,
        providerLifecycle: { not: "REMOVED" as const },
      },
    }),
    prisma.financeTransaction.count({
      where: { ...transactionBaseWhere, providerLifecycle: "DELETION_PENDING" as const },
    }),
    options.includeHistory
      ? prisma.financeTransaction.groupBy({
          by: ["referenceYear", "referenceMonth", "kind"],
          where: {
            ...transactionBaseWhere,
            OR: historyPeriods,
            ignored: false,
            internalTransfer: false,
            providerLifecycle: { not: "REMOVED" },
            reportingAmountBrl: { not: null },
          },
          _sum: { reportingAmountBrl: true },
        })
      : Promise.resolve([]),
  ]);

  const bankCodesByProviderItem = new Map<string, Array<string | null>>();
  for (const account of accounts) {
    if (!account.providerItemId) continue;
    const bankCodes = bankCodesByProviderItem.get(account.providerItemId) ?? [];
    bankCodes.push(account.bankCode);
    bankCodesByProviderItem.set(account.providerItemId, bankCodes);
  }
  const mappedTransactions = transactions.map((transaction) =>
    mapFinanceTransaction(transaction, bankCodesByProviderItem),
  );
  const history = historyPeriods
    .slice()
    .reverse()
    .map((period) => {
      const income = historyGroups.find(
        (group) =>
          group.referenceYear === period.referenceYear
          && group.referenceMonth === period.referenceMonth
          && group.kind === "INCOME",
      );
      const expenses = historyGroups.find(
        (group) =>
          group.referenceYear === period.referenceYear
          && group.referenceMonth === period.referenceMonth
          && group.kind === "EXPENSE",
      );
      const grossIncome = Number(income?._sum.reportingAmountBrl ?? 0);
      const spent = Math.abs(Number(expenses?._sum.reportingAmountBrl ?? 0));
      return {
        year: period.referenceYear,
        month: period.referenceMonth,
        grossIncome,
        spent,
        balance: grossIncome - spent,
      };
    });
  return {
    year,
    month,
    user,
    profile: {
      monthlyIncome: profile.monthlyIncome.toString(),
      financialMonthStart: profile.financialMonthStart,
      timeZone: preference?.timeZone ?? "America/Sao_Paulo",
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
      institutionName: account.source === "PLUGGY"
        ? resolvePluggyInstitutionName(
            account.institutionName,
            null,
            [
              account.bankCode,
              ...(account.providerItemId
                ? bankCodesByProviderItem.get(account.providerItemId) ?? []
                : []),
            ],
          )
        : account.institutionName,
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
      balanceBrl: account.balanceBrl?.toString() ?? null,
      balanceFxRateToBrl: account.balanceFxRateToBrl?.toString() ?? null,
      balanceFxRateDate: account.balanceFxRateDate?.toISOString() ?? null,
      balanceFxSource: account.balanceFxSource,
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
    recentTransactions: mappedTransactions
      .filter(
        (transaction) => transaction.referenceYear === year && transaction.referenceMonth === month,
      )
      .slice(0, 8),
    historyTransactions: transactionScope === "INVOICE_HISTORY" ? mappedTransactions : [],
    history,
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
    unclassifiedTransactionCount,
    pendingFxTransactionCount,
    pendingDeletionCount,
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
