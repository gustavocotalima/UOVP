import { prisma } from "@/lib/prisma";
import { DEFAULT_TIME_ZONE, validTimeZone } from "@/lib/calendar";
import {
  FINANCE_ACCOUNT_SELECT, FINANCE_CLASSIFICATION_RULE_SELECT,
  FINANCE_CONNECTION_PREFERENCE_SELECT, FINANCE_GOAL_SELECT, FINANCE_PLUGGY_ITEM_SELECT,
  FINANCE_PROFILE_SELECT, FINANCE_TAG_SELECT, FINANCE_TRANSACTION_SELECT, FINANCE_USER_SELECT,
  financeBankCodesByProviderItem, financeReferencePeriods, mapFinanceClassificationRule,
  mapFinanceGoals, mapFinancePluggy, mapFinanceProfile, mapFinanceTransaction, mapFinancialAccount,
} from "./read-models";
import type {
  FinanceAccountsPageData, FinanceGoalsPageData, FinanceInvoicesPageData,
  FinanceProfilePageData, FinanceTagsPageData, FinanceTransactionsPageData,
} from "./types";

export async function getFinanceProfilePageData(userId: string): Promise<FinanceProfilePageData> {
  const [user, profile, preference] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: FINANCE_USER_SELECT }),
    prisma.financeProfile.findUniqueOrThrow({ where: { userId }, select: FINANCE_PROFILE_SELECT }),
    prisma.userPreference.findUnique({ where: { userId }, select: { timeZone: true } }),
  ]);
  return { user, profile: mapFinanceProfile(profile, preference?.timeZone) };
}

export async function getFinanceGoalsPageData(userId: string): Promise<FinanceGoalsPageData> {
  const [profile, goals] = await Promise.all([
    prisma.financeProfile.findUniqueOrThrow({ where: { userId }, select: { monthlyIncome: true } }),
    prisma.financeGoal.findMany({ where: { userId }, select: FINANCE_GOAL_SELECT }),
  ]);
  return { profile: { monthlyIncome: profile.monthlyIncome.toString() }, goals: mapFinanceGoals(goals) };
}

export async function getFinanceTagsPageData(userId: string): Promise<FinanceTagsPageData> {
  const [tags, rules] = await Promise.all([
    prisma.financeTag.findMany({ where: { userId }, orderBy: { name: "asc" }, select: FINANCE_TAG_SELECT }),
    prisma.financeClassificationRule.findMany({
      where: { userId },
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
      select: FINANCE_CLASSIFICATION_RULE_SELECT,
    }),
  ]);
  return { tags, classificationRules: rules.map(mapFinanceClassificationRule) };
}

export async function getFinanceAccountsPageData(userId: string): Promise<FinanceAccountsPageData> {
  const [accounts, preference, items] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId, active: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: FINANCE_ACCOUNT_SELECT,
    }),
    prisma.userPreference.findUnique({ where: { userId }, select: FINANCE_CONNECTION_PREFERENCE_SELECT }),
    prisma.pluggyItem.findMany({
      where: { userId, status: { not: "DELETED" } },
      select: FINANCE_PLUGGY_ITEM_SELECT,
    }),
  ]);
  const bankCodes = financeBankCodesByProviderItem(accounts);
  return {
    accounts: accounts.map((account) => mapFinancialAccount(account, bankCodes)),
    profile: { timeZone: validTimeZone(preference?.timeZone ?? DEFAULT_TIME_ZONE) },
    pluggy: mapFinancePluggy(preference, items),
  };
}

export async function getFinanceInvoicesPageData(
  userId: string,
  year: number,
  month: number,
  timeZone: string,
): Promise<FinanceInvoicesPageData> {
  const [cards, transactions, accountCodes] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId, active: true, type: "CREDIT_CARD" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: FINANCE_ACCOUNT_SELECT,
    }),
    prisma.financeTransaction.findMany({
      where: {
        userId, deleted: false,
        account: { userId, active: true, type: "CREDIT_CARD" },
        OR: financeReferencePeriods(year, month),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: FINANCE_TRANSACTION_SELECT,
    }),
    // A card can inherit its institution code from a bank account in the same
    // provider item. Fetch only the two logo fields, never bank balances/history.
    prisma.financialAccount.findMany({
      where: { userId, active: true, providerItemId: { not: null } },
      select: { providerItemId: true, bankCode: true },
    }),
  ]);
  const bankCodes = financeBankCodesByProviderItem(accountCodes);
  return {
    accounts: cards.map((account) => mapFinancialAccount(account, bankCodes)),
    historyTransactions: transactions.map((transaction) => mapFinanceTransaction(transaction, bankCodes)),
    profile: { timeZone: validTimeZone(timeZone) },
  };
}

export async function getFinanceTransactionsPageData(
  userId: string,
  year: number,
  month: number,
): Promise<FinanceTransactionsPageData> {
  const transactionWhere = { userId, deleted: false, account: { active: true } } as const;
  const [accounts, tags, unclassifiedTransactionCount, pendingDeletionCount] = await Promise.all([
    getFinanceAccountsPageData(userId),
    prisma.financeTag.findMany({ where: { userId }, orderBy: { name: "asc" }, select: FINANCE_TAG_SELECT }),
    prisma.financeTransaction.count({
      where: {
        ...transactionWhere, kind: "EXPENSE", budgetCategorySource: "UNASSIGNED",
        ignored: false, internalTransfer: false,
      },
    }),
    prisma.financeTransaction.count({ where: { ...transactionWhere, providerLifecycle: "DELETION_PENDING" } }),
  ]);
  return { ...accounts, year, month, tags, unclassifiedTransactionCount, pendingDeletionCount };
}
