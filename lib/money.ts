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
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: currencyCode === "BRL" ? "symbol" : "code",
  }).format(new Decimal(value).toNumber());
}

export function formatPercent(value: Decimal.Value, digits = 2) {
  return `${new Decimal(value).toDecimalPlaces(digits).toString().replace(".", ",")}%`;
}
