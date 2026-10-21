import type { BudgetCategoryKey } from "@/features/budget/constants";
import type { FinanceTransactionDto } from "./types";

export type FinanceTransactionFilters = {
  min: string;
  max: string;
  kind: "" | "INCOME" | "EXPENSE";
  category: "" | "NONE" | BudgetCategoryKey;
  tagId: string;
  assignmentSource: "" | FinanceTransactionDto["budgetCategorySource"];
  accountId: string;
  ignored: "" | "yes" | "no";
  internal: "" | "yes" | "no";
};

export const EMPTY_TRANSACTION_FILTERS: FinanceTransactionFilters = {
  min: "", max: "", kind: "", category: "", tagId: "", assignmentSource: "",
  accountId: "", ignored: "", internal: "no",
};

export type FinanceTransactionQuery = {
  year: number;
  month: number;
  page: number;
  pageSize: number;
  mode: "MONTH" | "UNCLASSIFIED" | "DELETIONS";
  sortKey: "description" | "amount" | "date" | "account";
  sortDirection: "asc" | "desc";
  search?: string;
} & Partial<{
  [Key in keyof Omit<FinanceTransactionFilters, "min" | "max">]: Exclude<FinanceTransactionFilters[Key], "">;
}> & {
  min?: number;
  max?: number;
};

export function initialFinanceTransactionQuery(year: number, month: number): FinanceTransactionQuery {
  return {
    year, month, page: 1, pageSize: 25, mode: "MONTH", internal: "no",
    sortKey: "date", sortDirection: "desc",
  };
}

/** The same canonical key is used by SSR and client requests, including defaults. */
export function financeTransactionQueryKey(query: FinanceTransactionQuery): string {
  const params = new URLSearchParams();
  const normalized = { ...query, search: query.search?.trim() };
  for (const key of Object.keys(normalized).sort() as Array<keyof typeof normalized>) {
    const value = normalized[key];
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export function validFinanceTransactionPage(page: number, total: number, pageSize: number): number {
  return Math.max(1, Math.min(page, Math.max(1, Math.ceil(total / pageSize))));
}
