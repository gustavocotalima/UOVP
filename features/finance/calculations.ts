import { addMonths, format, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META, type BudgetCategoryKey } from "@/features/budget/constants";
import type {
  FinanceGoalRecord,
  FinanceTagDto,
  FinanceTransactionDto,
  FinancialAccountDto,
} from "./types";

export function isReportable(transaction: FinanceTransactionDto) {
  return !transaction.ignored && !transaction.internalTransfer;
}

export function resolveFinancialReference(date: Date, startDay: number) {
  const normalizedStart = Math.max(1, Math.min(28, Math.trunc(startDay)));
  const reference = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (date.getUTCDate() < normalizedStart) reference.setUTCMonth(reference.getUTCMonth() - 1);
  return { year: reference.getUTCFullYear(), month: reference.getUTCMonth() + 1 };
}

export function calculatePeriod(transactions: FinanceTransactionDto[]) {
  const reportable = transactions.filter(isReportable);
  const income = reportable
    .filter((transaction) => Number(transaction.amount) > 0)
    .reduce((total, transaction) => total + Number(transaction.amount), 0);
  const spent = reportable
    .filter((transaction) => Number(transaction.amount) < 0)
    .reduce((total, transaction) => total + Math.abs(Number(transaction.amount)), 0);
  return { income, spent, balance: income - spent };
}

export function calculateAccountTotals(accounts: FinancialAccountDto[]) {
  const bankBalance = accounts
    .filter((account) => account.type === "BANK_ACCOUNT")
    .reduce((total, account) => total + Number(account.balance), 0);
  const cardDebt = accounts
    .filter((account) => account.type === "CREDIT_CARD")
    .reduce((total, account) => total + Math.abs(Number(account.balance)), 0);
  return { bankBalance, cardDebt, result: bankBalance - cardDebt };
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
    const spent = categoryTransactions
      .filter((transaction) => Number(transaction.amount) < 0)
      .reduce((total, transaction) => total + Math.abs(Number(transaction.amount)), 0);
    const target = income * (goals[category] / 100);
    return {
      category,
      label: BUDGET_CATEGORY_META[category].label,
      color: BUDGET_CATEGORY_META[category].color,
      percentage: goals[category],
      spent,
      target,
      remaining: Math.max(0, target - spent),
      usage: target > 0 ? (spent / target) * 100 : 0,
      exceeded: spent > target,
      transactions: categoryTransactions,
    };
  });
}

export function calculateTagTotals(transactions: FinanceTransactionDto[], tags: FinanceTagDto[]) {
  const reportableExpenses = transactions.filter(
    (transaction) => isReportable(transaction) && Number(transaction.amount) < 0,
  );
  const totals = tags
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      value: reportableExpenses
        .filter((transaction) => transaction.tags.some((item) => item.id === tag.id))
        .reduce((total, transaction) => total + Math.abs(Number(transaction.amount)), 0),
    }))
    .filter((item) => item.value > 0);
  const untagged = reportableExpenses
    .filter((transaction) => !transaction.tags.length)
    .reduce((total, transaction) => total + Math.abs(Number(transaction.amount)), 0);
  if (untagged > 0) totals.unshift({ id: "untagged", name: "Sem Tags", color: "#64748b", value: untagged });
  return totals.sort((left, right) => right.value - left.value);
}

export function calculateHistory(
  transactions: FinanceTransactionDto[],
  endYear: number,
  endMonth: number,
  months = 6,
) {
  const end = new Date(endYear, endMonth - 1, 1);
  return Array.from({ length: months }, (_, index) => addMonths(end, index - months + 1)).map((date) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const period = calculatePeriod(
      transactions.filter(
        (transaction) => transaction.referenceYear === year && transaction.referenceMonth === month,
      ),
    );
    return {
      key: `${year}-${String(month).padStart(2, "0")}`,
      month: format(date, "MMM", { locale: ptBR }).replace(".", ""),
      income: period.income,
      spent: period.spent,
      balance: period.balance,
    };
  });
}

export type InvoiceGroup = {
  key: string;
  year: number;
  month: number;
  dueDate: string;
  open: boolean;
  total: number;
  transactions: FinanceTransactionDto[];
};

export function calculateInvoices(
  account: FinancialAccountDto,
  transactions: FinanceTransactionDto[],
  now = new Date(),
) {
  const cardTransactions = transactions.filter(
    (transaction) => transaction.accountId === account.id && transaction.accountType === "CREDIT_CARD",
  );
  const groups = new Map<string, FinanceTransactionDto[]>();
  for (const transaction of cardTransactions) {
    const purchaseDate = new Date(transaction.date);
    const dueDay = account.dueDay ?? 10;
    const inferredClosing = dueDay > 7 ? dueDay - 7 : Math.min(28, dueDay + 23);
    const closingDay = account.closingDay ?? inferredClosing;
    const closesBeforeDue = closingDay < dueDay;
    const monthOffset = closesBeforeDue
      ? purchaseDate.getUTCDate() <= closingDay ? 0 : 1
      : purchaseDate.getUTCDate() <= closingDay ? 1 : 2;
    const invoiceDate = addMonths(startOfMonth(purchaseDate), monthOffset);
    const key = `${invoiceDate.getFullYear()}-${String(invoiceDate.getMonth() + 1).padStart(2, "0")}`;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }
  const openInvoiceDate = addMonths(startOfMonth(now), 1);
  const openKey = `${openInvoiceDate.getFullYear()}-${String(openInvoiceDate.getMonth() + 1).padStart(2, "0")}`;
  if (!groups.has(openKey)) groups.set(openKey, []);
  return [...groups.entries()]
    .map(([key, items]) => {
      const [year, month] = key.split("-").map(Number);
      const dueDay = Math.min(account.dueDay ?? 10, new Date(year, month, 0).getDate());
      const dueDate = new Date(year, month - 1, dueDay);
      return {
        key,
        year,
        month,
        dueDate: dueDate.toISOString(),
        open: key === openKey,
        total: items
          .filter((transaction) => Number(transaction.amount) < 0)
          .reduce((total, transaction) => total + Math.abs(Number(transaction.amount)), 0),
        transactions: items.sort((left, right) => right.date.localeCompare(left.date)),
      };
    })
    .sort((left, right) => right.key.localeCompare(left.key));
}

export function categoryLabel(category: BudgetCategoryKey | null, kind?: "INCOME" | "EXPENSE") {
  if (!category) return kind === "INCOME" ? "Entrada" : "Sem meta";
  return BUDGET_CATEGORY_META[category].label;
}
