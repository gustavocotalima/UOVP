import Decimal from "decimal.js";

export type TransactionFxResolution = {
  reportingAmountBrl: Decimal | null;
  fxRateToBrl: Decimal | null;
  fxRateDate: Date | null;
  fxSource: "NATIVE" | "PLUGGY" | "YAHOO" | "MANUAL" | null;
};

export function resolveTransactionFx({
  amountInAccountCurrency,
  accountCurrencyCode,
  originalCurrencyCode,
  rate,
}: {
  amountInAccountCurrency: Decimal;
  accountCurrencyCode: string;
  originalCurrencyCode: string;
  rate?: { rateDate: Date; rateToBrl: Decimal } | null;
}): TransactionFxResolution {
  const accountCurrency = accountCurrencyCode.trim().toUpperCase() || "BRL";
  const originalCurrency = originalCurrencyCode.trim().toUpperCase() || accountCurrency;
  if (accountCurrency === "BRL") {
    return {
      reportingAmountBrl: amountInAccountCurrency,
      fxRateToBrl: new Decimal(1),
      fxRateDate: null,
      fxSource: originalCurrency === "BRL" ? "NATIVE" : "PLUGGY",
    };
  }
  if (!rate) {
    return {
      reportingAmountBrl: null,
      fxRateToBrl: null,
      fxRateDate: null,
      fxSource: null,
    };
  }
  return {
    reportingAmountBrl: amountInAccountCurrency.mul(rate.rateToBrl).toDecimalPlaces(2),
    fxRateToBrl: rate.rateToBrl,
    fxRateDate: rate.rateDate,
    fxSource: "YAHOO",
  };
}
