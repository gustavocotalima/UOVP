import { Prisma } from "@prisma/client";

type ValuationState = {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  fxRateToBrl: Prisma.Decimal | null;
  currentValue: Prisma.Decimal | null;
  providerCurrentValue: Prisma.Decimal | null;
  currency: string;
  pricingSource: string;
  marketQuoteType: string | null;
  includedInTotals: boolean;
};

function sameDecimal(left: Prisma.Decimal | null, right: Prisma.Decimal | null) {
  return left === null || right === null ? left === right : left.equals(right);
}

/** Quote timestamps and presentation metadata do not invalidate an allocation. */
export function binanceHoldingValuationChanged(previous: ValuationState, next: ValuationState) {
  if (previous.includedInTotals !== next.includedInTotals) return true;
  if (!previous.includedInTotals && !next.includedInTotals) return false;
  return !previous.quantity.equals(next.quantity)
    || !previous.unitPrice.equals(next.unitPrice)
    || !sameDecimal(previous.fxRateToBrl, next.fxRateToBrl)
    || !sameDecimal(previous.currentValue, next.currentValue)
    || !sameDecimal(previous.providerCurrentValue, next.providerCurrentValue)
    || previous.currency !== next.currency
    || previous.pricingSource !== next.pricingSource
    || previous.marketQuoteType !== next.marketQuoteType;
}
