export type TransactionPageQuery = {
  page: number;
  snapshotRevision: string;
  attempt: number;
};

export type TransactionPageResult<T> = {
  query: TransactionPageQuery;
  status: "ready" | "error" | "correcting";
  total: number | null;
  transactions: T[];
  error: string | null;
};

export function transactionLastPage(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Never present one page's rows or error as the result of another request. */
export function getTransactionPageView<T>(
  result: TransactionPageResult<T> | null,
  query: TransactionPageQuery,
) {
  if (!result) return { total: null, transactions: [] as T[], loading: true, error: null };
  const sameSnapshot = result.query.snapshotRevision === query.snapshotRevision;
  const current = sameSnapshot
    && result.query.page === query.page
    && result.query.attempt === query.attempt;
  return {
    // A known total remains useful while navigating within the same snapshot.
    total: sameSnapshot ? result.total : null,
    transactions: current && result.status === "ready" ? result.transactions : [],
    loading: !current || result.status === "correcting",
    error: current && result.status === "error" ? result.error : null,
  };
}
