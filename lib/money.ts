import Decimal from "decimal.js";

export const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

export function formatMoney(value: Decimal.Value) {
  return BRL.format(new Decimal(value).toNumber());
}

export function formatCurrency(value: Decimal.Value, currencyCode: string) {
  const normalizedCurrency = currencyCode.trim().toUpperCase();
  const amount = new Decimal(value).toNumber();
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: normalizedCurrency,
      currencyDisplay: normalizedCurrency === "BRL" || normalizedCurrency === "USD" ? "symbol" : "code",
    }).format(amount);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${normalizedCurrency} ${new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(amount)}`;
  }
}

export function formatPercent(value: Decimal.Value, digits = 2) {
  return `${new Decimal(value).toDecimalPlaces(digits).toString().replace(".", ",")}%`;
}
