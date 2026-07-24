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

export function calculatePeriod(transactions: FinanceTransactionDto[]) {
  const reportable = transactions.filter(isReportable);
  const grossIncome = reportable
    .map(reportingValue)
    .filter((value): value is number => value !== null && value > 0)
    .reduce((total, value) => total + value, 0);
  const budgetBaseIncome = reportable
    .filter((transaction) => transaction.budgetCategory === null)
    .map(reportingValue)
    .filter((value): value is number => value !== null && value > 0)
    .reduce((total, value) => total + value, 0);
  const spent = reportable
    .map(reportingValue)
    .filter((value): value is number => value !== null && value < 0)
    .reduce((total, value) => total + Math.abs(value), 0);
  const missingFxCount = reportable.filter(
    (transaction) => transaction.reportingAmountBrl === null,
  ).length;
  return {
    income: grossIncome,
    grossIncome,
    budgetBaseIncome,
    spent,
    balance: grossIncome - spent,
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
    const expenses = categoryTransactions
      .map(reportingValue)
      .filter((value): value is number => value !== null && value < 0)
      .reduce((total, value) => total + Math.abs(value), 0);
    const incomeOffsets = categoryTransactions
      .map(reportingValue)
      .filter((value): value is number => value !== null && value > 0)
      .reduce((total, value) => total + value, 0);
    const spent = expenses - incomeOffsets;
    const target = income * (goals[category] / 100);
    return {
      category,
      label: BUDGET_CATEGORY_META[category].label,
      color: BUDGET_CATEGORY_META[category].color,
      percentage: goals[category],
      spent,
      expenses,
      incomeOffsets,
      target,
      remaining: Math.max(0, target - spent),
      usage: target > 0 ? Math.max(0, (spent / target) * 100) : 0,
      exceeded: spent > target,
      transactions: categoryTransactions,
    };
  });
}

export function calculateTagTotals(transactions: FinanceTransactionDto[], tags: FinanceTagDto[]) {
  const reportableExpenses = transactions.filter(
    (transaction) => (reportingValue(transaction) ?? 0) < 0,
  );
  const totals = tags
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      value: reportableExpenses
        .filter((transaction) => transaction.tags.some((item) => item.id === tag.id))
        .reduce((total, transaction) => total + Math.abs(reportingValue(transaction) ?? 0), 0),
    }))
    .filter((item) => item.value > 0);
  const untagged = reportableExpenses
    .filter((transaction) => !transaction.tags.length)
    .reduce((total, transaction) => total + Math.abs(reportingValue(transaction) ?? 0), 0);
  if (untagged > 0) totals.unshift({ id: "untagged", name: "Sem Tags", color: "#64748b", value: untagged });
  return totals.sort((left, right) => right.value - left.value);
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
