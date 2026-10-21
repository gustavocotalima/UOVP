import type { Prisma } from "@prisma/client";
import { BUDGET_CATEGORIES, type BudgetCategoryKey } from "@/features/budget/constants";
import { DEFAULT_TIME_ZONE, validTimeZone } from "@/lib/calendar";
import {
  resolvePluggyInstitutionLogo,
  resolvePluggyInstitutionName,
} from "@/features/open-finance/institution-logo";
import { AUVP_FINANCE_GOALS } from "./setup";
import type {
  FinanceClassificationRuleDto, FinanceGoalRecord, FinancePluggyDto,
  FinanceProfileDto, FinanceTransactionDto, FinancialAccountDto,
} from "./types";

export const FINANCE_USER_SELECT = { name: true, email: true, image: true } as const satisfies Prisma.UserSelect;

export const FINANCE_PROFILE_SELECT = {
  monthlyIncome: true, financialMonthStart: true, objectives: true,
} as const satisfies Prisma.FinanceProfileSelect;

export const FINANCE_GOAL_SELECT = { category: true, percentage: true } as const satisfies Prisma.FinanceGoalSelect;

export const FINANCE_TAG_SELECT = {
  id: true, systemKey: true, name: true, color: true,
} as const satisfies Prisma.FinanceTagSelect;

export const FINANCE_CONNECTION_PREFERENCE_SELECT = {
  timeZone: true, pluggyClientIdCiphertext: true, pluggyClientSecretCiphertext: true,
} as const satisfies Prisma.UserPreferenceSelect;

export const FINANCE_PLUGGY_ITEM_SELECT = {
  syncPending: true, lastSyncAt: true,
} as const satisfies Prisma.PluggyItemSelect;

export const FINANCE_ACCOUNT_SELECT = {
  id: true, source: true, providerItemId: true, type: true, subtype: true,
  name: true, institutionName: true, institutionImageUrl: true,
  accountNumber: true, agency: true, numberLastFour: true, bankCode: true,
  brand: true, balance: true, balanceBrl: true, balanceFxRateToBrl: true,
  balanceFxRateDate: true, balanceFxSource: true, balanceSnapshotAt: true,
  creditLimit: true, availableCredit: true, dueDay: true, closingDay: true,
  currencyCode: true, sortOrder: true, providerUpdatedAt: true,
  investmentLink: { select: { id: true, enabled: true, status: true, assetHoldingId: true } },
  _count: { select: { transactions: true } },
} as const satisfies Prisma.FinancialAccountSelect;

export const FINANCE_TRANSACTION_SELECT = {
  id: true, accountId: true, source: true, kind: true, description: true,
  descriptionRaw: true, merchantName: true, merchantBusinessName: true,
  merchantCnpj: true, merchantCategory: true, counterpartyName: true,
  paymentMethod: true, amount: true, currencyCode: true, reportingAmountBrl: true,
  fxRateToBrl: true, fxRateDate: true, fxSource: true, originalAmount: true,
  originalCurrencyCode: true, date: true, referenceYear: true, referenceMonth: true,
  budgetCategory: true, budgetCategorySource: true, tagAssignmentSource: true,
  providerCategory: true, providerCategoryId: true, status: true, note: true,
  ignored: true, balanceApplied: true, providerLifecycle: true, providerDeletedAt: true,
  internalTransfer: true, internalTransferSource: true, installmentNumber: true,
  installmentTotal: true, classifiedAt: true,
  account: { select: {
    name: true, type: true, institutionName: true, institutionImageUrl: true,
    bankCode: true, providerItemId: true,
  } },
  tags: { select: { tag: { select: FINANCE_TAG_SELECT } } },
  classificationRule: { select: { id: true, matchLabel: true } },
} as const satisfies Prisma.FinanceTransactionSelect;

export const FINANCE_CLASSIFICATION_RULE_SELECT = {
  id: true, matchType: true, matchValue: true, matchLabel: true, kind: true,
  assignsBudgetCategory: true, budgetCategory: true, assignsTags: true,
  assignsInternalTransfer: true, internalTransfer: true, enabled: true,
  tags: { select: { tag: { select: FINANCE_TAG_SELECT } } },
  _count: { select: { appliedTransactions: true } },
} as const satisfies Prisma.FinanceClassificationRuleSelect;

export function financeReferencePeriods(year: number, month: number) {
  return Array.from({ length: 12 }, (_, offset) => {
    const monthIndex = year * 12 + month - 1 - offset;
    return { referenceYear: Math.floor(monthIndex / 12), referenceMonth: (monthIndex % 12) + 1 };
  });
}

export function financeBankCodesByProviderItem(accounts: ReadonlyArray<{
  providerItemId: string | null; bankCode: string | null;
}>) {
  const result = new Map<string, Array<string | null>>();
  for (const account of accounts) {
    if (!account.providerItemId) continue;
    const codes = result.get(account.providerItemId) ?? [];
    codes.push(account.bankCode);
    result.set(account.providerItemId, codes);
  }
  return result;
}

export function mapFinanceProfile(
  profile: Prisma.FinanceProfileGetPayload<{ select: typeof FINANCE_PROFILE_SELECT }>,
  timeZone?: string | null,
): FinanceProfileDto {
  return {
    monthlyIncome: profile.monthlyIncome.toString(),
    financialMonthStart: profile.financialMonthStart,
    objectives: profile.objectives,
    timeZone: validTimeZone(timeZone ?? DEFAULT_TIME_ZONE),
  };
}

export function mapFinanceGoals(
  goals: ReadonlyArray<Prisma.FinanceGoalGetPayload<{ select: typeof FINANCE_GOAL_SELECT }>>,
): FinanceGoalRecord {
  return Object.fromEntries(BUDGET_CATEGORIES.map((category) => [
    category,
    Number(goals.find((goal) => goal.category === category)?.percentage ?? AUVP_FINANCE_GOALS[category]),
  ])) as FinanceGoalRecord;
}

export function mapFinancePluggy(
  preference: Pick<Prisma.UserPreferenceGetPayload<{ select: typeof FINANCE_CONNECTION_PREFERENCE_SELECT }>,
    "pluggyClientIdCiphertext" | "pluggyClientSecretCiphertext"> | null,
  items: ReadonlyArray<Prisma.PluggyItemGetPayload<{ select: typeof FINANCE_PLUGGY_ITEM_SELECT }>>,
): FinancePluggyDto {
  return {
    configured: Boolean(preference?.pluggyClientIdCiphertext && preference.pluggyClientSecretCiphertext),
    itemCount: items.length,
    pendingCount: items.filter((item) => item.syncPending).length,
    lastSyncAt: items.map((item) => item.lastSyncAt)
      .filter((date): date is Date => date !== null)
      .sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() ?? null,
  };
}

export function mapFinanceClassificationRule(
  rule: Prisma.FinanceClassificationRuleGetPayload<{ select: typeof FINANCE_CLASSIFICATION_RULE_SELECT }>,
): FinanceClassificationRuleDto {
  return {
    id: rule.id, matchType: rule.matchType, matchValue: rule.matchValue,
    matchLabel: rule.matchLabel, kind: rule.kind,
    assignsBudgetCategory: rule.assignsBudgetCategory, budgetCategory: rule.budgetCategory,
    assignsTags: rule.assignsTags, assignsInternalTransfer: rule.assignsInternalTransfer,
    internalTransfer: rule.internalTransfer, enabled: rule.enabled,
    tags: rule.tags.map((item) => item.tag), appliedCount: rule._count.appliedTransactions,
  };
}

export function mapFinancialAccount(
  account: Prisma.FinancialAccountGetPayload<{ select: typeof FINANCE_ACCOUNT_SELECT }>,
  bankCodesByProviderItem: ReadonlyMap<string, Array<string | null>>,
): FinancialAccountDto {
  const bankCodes = [account.bankCode, ...(account.providerItemId
    ? bankCodesByProviderItem.get(account.providerItemId) ?? [] : [])];
  return {
    id: account.id, source: account.source, type: account.type, subtype: account.subtype,
    name: account.name,
    institutionName: account.source === "PLUGGY"
      ? resolvePluggyInstitutionName(account.institutionName, null, bankCodes) : account.institutionName,
    institutionImageUrl: account.source === "PLUGGY"
      ? resolvePluggyInstitutionLogo(account.institutionImageUrl, bankCodes) : account.institutionImageUrl,
    accountNumber: account.accountNumber, agency: account.agency, numberLastFour: account.numberLastFour,
    bankCode: account.bankCode, brand: account.brand, balance: account.balance.toString(),
    balanceBrl: account.balanceBrl?.toString() ?? null,
    balanceFxRateToBrl: account.balanceFxRateToBrl?.toString() ?? null,
    balanceFxRateDate: account.balanceFxRateDate?.toISOString() ?? null,
    balanceFxSource: account.balanceFxSource,
    balanceSnapshotAt: account.balanceSnapshotAt?.toISOString() ?? null,
    creditLimit: account.creditLimit?.toString() ?? null,
    availableCredit: account.availableCredit?.toString() ?? null,
    dueDay: account.dueDay, closingDay: account.closingDay, currencyCode: account.currencyCode,
    sortOrder: account.sortOrder, providerUpdatedAt: account.providerUpdatedAt?.toISOString() ?? null,
    transactionCount: account._count.transactions,
    accountInvestment: account.investmentLink ? {
      linkId: account.investmentLink.id, enabled: account.investmentLink.enabled,
      status: account.investmentLink.status, holdingId: account.investmentLink.assetHoldingId,
      alsoIncludedInAccountBalance: true,
    } : null,
  };
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
    balanceApplied: boolean;
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
    updateAccountBalance: transaction.balanceApplied,
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
