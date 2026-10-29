import Decimal from "decimal.js";

type TransactionFxResolution = {
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

/** A frozen rate belongs to a currency and transaction day, not to an amount. */
export function resolveUpdatedTransactionFx(input: Parameters<typeof resolveTransactionFx>[0] & {
  transactionDate: Date;
  previous?: {
    currencyCode: string;
    date: Date;
    fxRateToBrl: Decimal | null;
    fxRateDate: Date | null;
    fxSource: TransactionFxResolution["fxSource"];
  } | null;
}): TransactionFxResolution {
  const { previous } = input;
  if (input.accountCurrencyCode.trim().toUpperCase() !== "BRL"
    && previous?.currencyCode.trim().toUpperCase() === input.accountCurrencyCode.trim().toUpperCase()
    && previous.date.toISOString().slice(0, 10) === input.transactionDate.toISOString().slice(0, 10)
    && previous.fxSource !== null
    && previous.fxRateToBrl?.isFinite() && previous.fxRateToBrl.gt(0)) {
    return {
      reportingAmountBrl: input.amountInAccountCurrency.mul(previous.fxRateToBrl).toDecimalPlaces(2),
      fxRateToBrl: previous.fxRateToBrl,
      fxRateDate: previous.fxRateDate,
      fxSource: previous.fxSource,
    };
  }
  return resolveTransactionFx(input);
}
