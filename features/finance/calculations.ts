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

export function needsFinanceClassification(
  transaction: Pick<
    FinanceTransactionDto,
    "budgetCategorySource" | "ignored" | "internalTransfer" | "kind"
  >,
) {
  return transaction.kind === "EXPENSE"
    && transaction.budgetCategorySource === "UNASSIGNED"
    && !transaction.internalTransfer
    && !transaction.ignored;
}

export function resolveFinancialReference(
  date: Date,
  startDay: number,
  timeZone = "America/Sao_Paulo",
) {
  return financialReferenceForTimeZone(date, startDay, timeZone);
}

export type FinancePeriodAmount = {
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

export function calculateTagTotals(transactions: FinanceTransactionDto[], tags: FinanceTagDto[]) {
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
  const buckets = calculateOffsetBuckets(amounts);
  const totals = new Map(tags.map((tag) => [tag.id, {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    valueCents: 0,
  }]));
  const remainingByBucket = new Map(
    [...buckets.entries()].map(([key, bucket]) => {
      const grossCents = toCents(bucket.expenses);
      return [key, {
        grossCents,
        netCents: Math.max(0, grossCents - Math.min(toCents(bucket.income), grossCents)),
      }];
    }),
  );
  let untaggedCents = 0;

  for (const transaction of reportable) {
    const value = reportingValue(transaction);
    if (value === null || value >= 0) continue;
    const grossCents = toCents(Math.abs(value));
    const bucketKey = transaction.budgetCategory === null
      ? null
      : offsetBucketKey(transaction);
    const bucket = bucketKey ? buckets.get(bucketKey) : null;
    const remaining = bucketKey ? remainingByBucket.get(bucketKey) : null;
    let netCents = grossCents;
    if (bucket && remaining && bucket.expenses > 0) {
      netCents = grossCents >= remaining.grossCents
        ? remaining.netCents
        : Math.min(
            remaining.netCents,
            Math.round(grossCents * Math.max(0, bucket.expenses - Math.min(bucket.income, bucket.expenses)) / bucket.expenses),
          );
      remaining.grossCents -= grossCents;
      remaining.netCents -= netCents;
    }
    const tagIds = [...new Set(transaction.tags.map((tag) => tag.id))]
      .filter((tagId) => totals.has(tagId));
    if (!tagIds.length) {
      untaggedCents += netCents;
      continue;
    }
    const share = Math.floor(netCents / tagIds.length);
    const remainder = netCents % tagIds.length;
    tagIds.forEach((tagId, index) => {
      const total = totals.get(tagId);
      if (total) total.valueCents += share + (index < remainder ? 1 : 0);
    });
  }

  const result = [...totals.values()]
    .filter((item) => item.valueCents > 0)
    .map(({ valueCents, ...item }) => ({ ...item, value: fromCents(valueCents) }));
  if (untaggedCents > 0) {
    result.push({ id: "untagged", name: "Sem Tags", color: "#64748b", value: fromCents(untaggedCents) });
  }
  return result.sort((left, right) => right.value - left.value);
}

export function calculateHistory(
  transactions: FinanceTransactionDto[],
  endYear: number,
  endMonth: number,
  months = 6,
) {
  const endIndex = endYear * 12 + endMonth - 1;
  return Array.from({ length: months }, (_, index) => {
    const monthIndex = endIndex + index - months + 1;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const period = calculatePeriod(
      transactions.filter(
        (transaction) => transaction.referenceYear === year && transaction.referenceMonth === month,
      ),
    );
    return {
      key: `${year}-${String(month).padStart(2, "0")}`,
      month: new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
        .format(new Date(Date.UTC(year, month - 1, 1)))
        .replace(".", ""),
      income: period.income,
      spent: period.spent,
      balance: period.balance,
    };
  });
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
    const purchaseDate = new Date(transaction.date);
    const purchase = calendarParts(purchaseDate, timeZone);
    const dueDay = account.dueDay ?? 10;
    const inferredClosing = dueDay > 7 ? dueDay - 7 : Math.min(28, dueDay + 23);
    const closingDay = account.closingDay ?? inferredClosing;
    const closesBeforeDue = closingDay < dueDay;
    const monthOffset = closesBeforeDue
      ? purchase.day <= closingDay ? 0 : 1
      : purchase.day <= closingDay ? 1 : 2;
    const invoiceMonthIndex = purchase.year * 12 + purchase.month - 1 + monthOffset;
    const invoiceYear = Math.floor(invoiceMonthIndex / 12);
    const invoiceMonth = (invoiceMonthIndex % 12) + 1;
    const key = `${invoiceYear}-${String(invoiceMonth).padStart(2, "0")}`;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }
  const current = calendarParts(now, timeZone);
  const openMonthIndex = current.year * 12 + current.month;
  const openYear = Math.floor(openMonthIndex / 12);
  const openMonth = (openMonthIndex % 12) + 1;
  const openKey = `${openYear}-${String(openMonth).padStart(2, "0")}`;
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
        total: items
          .filter((transaction) => isReportable(transaction) && Number(transaction.amount) < 0)
          .reduce((total, transaction) => total + Math.abs(Number(transaction.amount)), 0),
        totalBrl: items
          .filter((transaction) => (reportingValue(transaction) ?? 0) < 0)
          .reduce((total, transaction) => total + Math.abs(reportingValue(transaction) ?? 0), 0),
        transactions: items.sort((left, right) => right.date.localeCompare(left.date)),
      };
    })
    .sort((left, right) => right.key.localeCompare(left.key));
}

export function categoryLabel(category: BudgetCategoryKey | null, kind?: "INCOME" | "EXPENSE") {
  if (!category) return kind === "INCOME" ? "Entrada" : "Sem meta";
  return BUDGET_CATEGORY_META[category].label;
}
