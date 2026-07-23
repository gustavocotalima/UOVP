import Decimal from "decimal.js";

type TransactionAmountInput = {
  amount: Decimal.Value | null | undefined;
  amountInAccountCurrency?: Decimal.Value | null;
  kind: "INCOME" | "EXPENSE";
};

function signedAmount(value: Decimal, kind: TransactionAmountInput["kind"]) {
  const absolute = value.abs();
  return kind === "EXPENSE" ? absolute.negated() : absolute;
}

export function resolvePluggyTransactionAmounts(input: TransactionAmountInput) {
  const original = new Decimal(input.amount ?? 0);
  const account = input.amountInAccountCurrency == null
    ? original
    : new Decimal(input.amountInAccountCurrency);

  return {
    amount: signedAmount(account, input.kind).toString(),
    originalAmount: signedAmount(original, input.kind).toString(),
  };
}
