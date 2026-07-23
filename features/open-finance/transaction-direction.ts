export type FinanceTransactionDirection = "INCOME" | "EXPENSE";

export function resolvePluggyTransactionDirection(
  providerType: string | null | undefined,
  amount: number,
): FinanceTransactionDirection {
  const normalizedType = providerType?.trim().toUpperCase();

  if (normalizedType === "DEBIT") return "EXPENSE";
  if (normalizedType === "CREDIT") return "INCOME";

  return amount < 0 ? "EXPENSE" : "INCOME";
}

