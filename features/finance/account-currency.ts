import Decimal from "decimal.js";

export const SUPPORTED_FINANCIAL_ACCOUNT_CURRENCIES = ["BRL", "USD"] as const;
export type FinancialAccountCurrency = typeof SUPPORTED_FINANCIAL_ACCOUNT_CURRENCIES[number];

export const ACCOUNT_FX_FRESH_MS = 12 * 60 * 60_000;

export function financialAccountCurrencySymbol(currencyCode: string) {
  return currencyCode === "USD" ? "US$" : "R$";
}

export function isAccountFxFresh(updatedAt: Date | null, now = new Date()) {
  return Boolean(updatedAt && now.getTime() - updatedAt.getTime() < ACCOUNT_FX_FRESH_MS);
}

export function accountBalanceBrl(balance: Decimal.Value, rateToBrl: Decimal.Value) {
  return new Decimal(balance).mul(rateToBrl).toDecimalPlaces(2);
}

export function availableCreditForBalance(
  type: "BANK_ACCOUNT" | "CREDIT_CARD",
  creditLimit: Decimal.Value | null,
  balance: Decimal.Value,
) {
  if (type !== "CREDIT_CARD" || creditLimit === null) return null;
  return Decimal.max(0, new Decimal(creditLimit).minus(new Decimal(balance).abs())).toDecimalPlaces(2);
}

export function sameFinancialDate(left: Date | null, right: Date) {
  return Boolean(left && left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10));
}
