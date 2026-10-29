import { calendarParts, financialReferenceForTimeZone } from "@/lib/calendar";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META, type BudgetCategoryKey } from "@/features/budget/constants";
import type {
  FinanceGoalRecord,
  FinanceTagDto,
  FinanceTransactionDto,
  FinancialAccountDto,
} from "./types";

export function isReportable(transaction: FinanceTransactionDto) {
  return !transaction.ignored
    && !transaction.internalTransfer
    && transaction.providerLifecycle !== "REMOVED";
}

export function reportingValue(transaction: FinanceTransactionDto) {
  if (!isReportable(transaction) || transaction.reportingAmountBrl === null) return null;
  return Number(transaction.reportingAmountBrl);
}

export function resolveFinancialReference(
  date: Date,
  startDay: number,
  timeZone = "America/Sao_Paulo",
) {
  return financialReferenceForTimeZone(date, startDay, timeZone);
}

type FinancePeriodAmount = {
  kind: "INCOME" | "EXPENSE";
  budgetCategory: BudgetCategoryKey | null;
  referenceYear: number;
  referenceMonth: number;
  value: number;
};

type OffsetBucket = {
  income: number;
  expenses: number;
};

function toCents(value: number) {
  return Math.round(value * 100);
}

function fromCents(value: number) {
  return value / 100;
}

function offsetBucketKey(
  item: Pick<FinancePeriodAmount, "budgetCategory" | "referenceYear" | "referenceMonth">,
) {
  return `${item.referenceYear}:${item.referenceMonth}:${item.budgetCategory ?? "UNASSIGNED"}`;
}

function calculateOffsetBuckets(amounts: FinancePeriodAmount[]) {
  const buckets = new Map<string, OffsetBucket>();
  for (const item of amounts) {
    if (item.budgetCategory === null || item.value === 0) continue;
    const key = offsetBucketKey(item);
    const bucket = buckets.get(key) ?? { income: 0, expenses: 0 };
    if (item.value > 0) bucket.income += item.value;
    if (item.value < 0) bucket.expenses += Math.abs(item.value);
    buckets.set(key, bucket);
  }
  return buckets;
}

export function calculatePeriodAmounts(amounts: FinancePeriodAmount[]) {
  const grossIncomeCents = amounts
    .filter((item) => item.value > 0)
    .reduce((total, item) => total + toCents(item.value), 0);
  const budgetBaseIncomeCents = amounts
    .filter((item) => item.value > 0 && item.budgetCategory === null)
    .reduce((total, item) => total + toCents(item.value), 0);
  const grossExpensesCents = amounts
    .filter((item) => item.value < 0)
    .reduce((total, item) => total + toCents(Math.abs(item.value)), 0);
  const compensatedExpensesCents = [...calculateOffsetBuckets(amounts).values()]
    .reduce(
      (total, bucket) => total + Math.min(toCents(bucket.income), toCents(bucket.expenses)),
      0,
    );
  const spentCents = Math.max(0, grossExpensesCents - compensatedExpensesCents);
  const grossIncome = fromCents(grossIncomeCents);
  const budgetBaseIncome = fromCents(budgetBaseIncomeCents);
  const grossExpenses = fromCents(grossExpensesCents);
  const compensatedExpenses = fromCents(compensatedExpensesCents);
  const spent = fromCents(spentCents);
  return {
    income: grossIncome,
    grossIncome,
    budgetBaseIncome,
    grossExpenses,
    compensatedExpenses,
    spent,
    balance: fromCents(budgetBaseIncomeCents - spentCents),
  };
}

export function calculatePeriod(transactions: FinanceTransactionDto[]) {
  const reportable = transactions.filter(isReportable);
  const amounts = reportable.flatMap((transaction) => {
    const value = reportingValue(transaction);
    return value === null ? [] : [{
      kind: transaction.kind,
      budgetCategory: transaction.budgetCategory,
      referenceYear: transaction.referenceYear,
      referenceMonth: transaction.referenceMonth,
      value,
    }];
  });
  const missingFxCount = reportable.filter(
    (transaction) => transaction.reportingAmountBrl === null,
  ).length;
  return {
    ...calculatePeriodAmounts(amounts),
    missingFxCount,
  };
}

export function calculateAccountTotals(accounts: FinancialAccountDto[]) {
  const bankBalance = accounts
    .filter((account) => account.type === "BANK_ACCOUNT")
    .reduce((total, account) => total + Number(account.balanceBrl ?? 0), 0);
  const cardDebt = accounts
    .filter((account) => account.type === "CREDIT_CARD")
    .reduce((total, account) => total + Math.abs(Number(account.balanceBrl ?? 0)), 0);
  const missingFxCount = accounts.filter((account) => account.balanceBrl === null).length;
  return { bankBalance, cardDebt, result: bankBalance - cardDebt, missingFxCount };
}

export function calculateBudgetCategories(
  transactions: FinanceTransactionDto[],
  goals: FinanceGoalRecord,
  income: number,
) {
  return BUDGET_CATEGORIES.map((category) => {
    const categoryTransactions = transactions.filter(
      (transaction) => transaction.budgetCategory === category && isReportable(transaction),
    );
    const expensesCents = categoryTransactions
      .map(reportingValue)
      .filter((value): value is number => value !== null && value < 0)
      .reduce((total, value) => total + toCents(Math.abs(value)), 0);
    const incomeOffsetsCents = categoryTransactions
      .map(reportingValue)
      .filter((value): value is number => value !== null && value > 0)
      .reduce((total, value) => total + toCents(value), 0);
    const categoryAmounts = categoryTransactions.flatMap((transaction) => {
      const value = reportingValue(transaction);
      return value === null ? [] : [{
        kind: transaction.kind,
        budgetCategory: transaction.budgetCategory,
        referenceYear: transaction.referenceYear,
        referenceMonth: transaction.referenceMonth,
        value,
      }];
    });
    const appliedIncomeOffsetsCents = [...calculateOffsetBuckets(categoryAmounts).values()]
      .reduce(
        (total, bucket) => total + Math.min(toCents(bucket.income), toCents(bucket.expenses)),
        0,
      );
    const spentCents = Math.max(0, expensesCents - appliedIncomeOffsetsCents);
    const expenses = fromCents(expensesCents);
    const incomeOffsets = fromCents(incomeOffsetsCents);
    const appliedIncomeOffsets = fromCents(appliedIncomeOffsetsCents);
    const spent = fromCents(spentCents);
    const target = income * (goals[category] / 100);
    return {
      category,
      label: BUDGET_CATEGORY_META[category].label,
      color: BUDGET_CATEGORY_META[category].color,
      percentage: goals[category],
      spent,
      expenses,
      incomeOffsets,
      appliedIncomeOffsets,
      target,
      remaining: Math.max(0, target - spent),
      usage: target > 0 ? Math.max(0, (spent / target) * 100) : 0,
      exceeded: spent > target,
      transactions: categoryTransactions,
    };
  });
}

type TagAmountCents = {
  id: string;
  name: string;
  color: string;
  expenseCents: number;
  incomeCents: number;
};

export function calculateTagTotals(transactions: FinanceTransactionDto[], tags: FinanceTagDto[]) {
  const totals = new Map<string, TagAmountCents>(tags.map((tag) => [tag.id, {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    expenseCents: 0,
    incomeCents: 0,
  }]));
  const untaggedId = "untagged";
  totals.set(untaggedId, {
    id: untaggedId,
    name: "Sem Tags",
    color: "#64748b",
    expenseCents: 0,
    incomeCents: 0,
  });

  for (const transaction of transactions) {
    const value = reportingValue(transaction);
    if (value === null || value === 0) continue;
    const amountCents = toCents(Math.abs(value));
    const tagIds = [...new Set(transaction.tags.map((tag) => tag.id))]
      .filter((tagId) => totals.has(tagId) && tagId !== untaggedId)
      .sort();
    if (!tagIds.length) tagIds.push(untaggedId);
    const share = Math.floor(amountCents / tagIds.length);
    const remainder = amountCents % tagIds.length;
    tagIds.forEach((tagId, index) => {
      const cents = share + (index < remainder ? 1 : 0);
      const total = totals.get(tagId)!;
      if (value > 0) total.incomeCents += cents;
      else total.expenseCents += cents;
    });
  }

  return [...totals.values()]
    .filter((item) => item.expenseCents > 0 || item.incomeCents > 0)
    .map(({ expenseCents, incomeCents, ...item }) => ({
      ...item,
      value: fromCents(expenseCents),
      income: fromCents(incomeCents),
    }))
    .sort((left, right) => (right.value + right.income) - (left.value + left.income));
}

function invoicePeriodForDate(
  account: Pick<FinancialAccountDto, "closingDay" | "dueDay">,
  date: Date,
  timeZone: string,
) {
  const purchase = calendarParts(date, timeZone);
  const dueDay = account.dueDay ?? 10;
  const inferredClosing = dueDay > 7 ? dueDay - 7 : Math.min(28, dueDay + 23);
  const closingDay = account.closingDay ?? inferredClosing;
  const lastDay = new Date(Date.UTC(purchase.year, purchase.month, 0)).getUTCDate();
  const effectiveClosingDay = Math.min(closingDay, lastDay);
  // A purchase on the closing day belongs to that closing, including short
  // months. The configured order of closing/due days determines whether its
  // due month is the same month or the following one.
  const closingMonthIndex = purchase.year * 12 + purchase.month - 1
    + (purchase.day <= effectiveClosingDay ? 0 : 1);
  const invoiceMonthIndex = closingMonthIndex + (closingDay < dueDay ? 0 : 1);
  const year = Math.floor(invoiceMonthIndex / 12);
  const month = (invoiceMonthIndex % 12) + 1;
  return { year, month, key: `${year}-${String(month).padStart(2, "0")}` };
}

export function calculateInvoices(
  account: FinancialAccountDto,
  transactions: FinanceTransactionDto[],
  now = new Date(),
  timeZone = "America/Sao_Paulo",
) {
  const cardTransactions = transactions.filter(
    (transaction) => transaction.accountId === account.id && transaction.accountType === "CREDIT_CARD",
  );
  const groups = new Map<string, FinanceTransactionDto[]>();
  for (const transaction of cardTransactions) {
    const { key } = invoicePeriodForDate(account, new Date(transaction.date), timeZone);
    const entries = groups.get(key);
    if (entries) entries.push(transaction);
    else groups.set(key, [transaction]);
  }
  const { key: openKey } = invoicePeriodForDate(account, now, timeZone);
  if (!groups.has(openKey)) groups.set(openKey, []);
  return [...groups.entries()]
    .map(([key, items]) => {
      const [year, month] = key.split("-").map(Number);
      const dueDay = Math.min(account.dueDay ?? 10, new Date(Date.UTC(year, month, 0)).getUTCDate());
      const dueDate = new Date(Date.UTC(year, month - 1, dueDay, 12));
      return {
        key,
        year,
        month,
        dueDate: dueDate.toISOString(),
        open: key === openKey,
        // Debits increase the invoice; reportable credits/refunds reduce it.
        // Keep a negative net total when the customer has a credit balance.
        total: fromCents(items.filter(isReportable)
          .reduce((total, transaction) => total - toCents(Number(transaction.amount)), 0)),
        totalBrl: fromCents(items
          .reduce((total, transaction) => total - toCents(reportingValue(transaction) ?? 0), 0)),
        transactions: items.sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id)),
      };
    })
    .sort((left, right) => right.key.localeCompare(left.key));
}

export function categoryLabel(category: BudgetCategoryKey | null, kind?: "INCOME" | "EXPENSE") {
  if (!category) return kind === "INCOME" ? "Entrada" : "Sem meta";
  return BUDGET_CATEGORY_META[category].label;
}
