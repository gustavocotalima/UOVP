import Decimal from "decimal.js";

type CurrencyAmount = { amount: string | number; currencyCode: string | null | undefined };

export function normalizedCurrency(currency: string | null | undefined) {
  return currency?.trim().toUpperCase() || "BRL";
}

export function sumAmountsByCurrency(values: CurrencyAmount[]): Record<string, number> {
  const totals = new Map<string, Decimal>();
  for (const value of values) {
    let amount: Decimal;
    try { amount = new Decimal(value.amount); } catch { continue; }
    if (!amount.isFinite()) continue;
    const currency = normalizedCurrency(value.currencyCode);
    totals.set(currency, (totals.get(currency) ?? new Decimal(0)).add(amount));
  }
  return Object.fromEntries([...totals].map(([currency, total]) => [currency, total.toNumber()]));
}

/** Percentages only compare a native amount with a total in the same unit. */
export function currencyShare(amount: string, currency: string, totals: Record<string, number>) {
  const total = totals[normalizedCurrency(currency)];
  if (!Number.isFinite(total) || total <= 0) return null;
  try {
    const value = new Decimal(amount);
    return value.isFinite() ? value.div(total).mul(100).toNumber() : null;
  } catch { return null; }
}
