import Decimal from "decimal.js";

export type HoldingAmount = {
  currentValue?: Decimal.Value | null;
  providerCurrentValue?: Decimal.Value | null;
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  fxRateToBrl?: Decimal.Value | null;
  pricingSource?: "MANUAL" | "BRAPI" | "YAHOO" | "BINANCE" | "PLUGGY";
  currency?: string | null;
};

export function holdingUnitPriceBrl(holding: HoldingAmount) {
  const unitPrice = new Decimal(holding.unitPrice);
  if (!["YAHOO", "BINANCE"].includes(holding.pricingSource ?? "") || holding.currency === "BRL") {
    return unitPrice;
  }
  const fxRate = new Decimal(holding.fxRateToBrl ?? 0);
  return fxRate.gt(0) ? unitPrice.mul(fxRate) : new Decimal(0);
}

export function holdingCurrentValue(holding: HoldingAmount) {
  if (holding.pricingSource === "BRAPI" || holding.pricingSource === "YAHOO" || holding.pricingSource === "BINANCE") {
    const marketValue = new Decimal(holding.quantity).mul(
      holding.pricingSource === "BRAPI" ? holding.unitPrice : holdingUnitPriceBrl(holding),
    );
    if (marketValue.gt(0)) return marketValue;
    if (holding.providerCurrentValue != null) return new Decimal(holding.providerCurrentValue);
    if (holding.currentValue != null) return new Decimal(holding.currentValue);
  }
  if (holding.currentValue != null) return new Decimal(holding.currentValue);
  if (holding.providerCurrentValue != null) return new Decimal(holding.providerCurrentValue);
  return new Decimal(holding.quantity).mul(holding.unitPrice);
}

export function aggregateHoldingValue(holdings: HoldingAmount[]) {
  return holdings.reduce((total, holding) => total.add(holdingCurrentValue(holding)), new Decimal(0));
}

export function parentPortfolioPercentage(parentValue: Decimal.Value, portfolioValue: Decimal.Value) {
  const total = new Decimal(portfolioValue);
  return total.lte(0) ? new Decimal(0) : new Decimal(parentValue).div(total).mul(100);
}

export function applyManualFixedIncomeContribution({
  investedValue,
  currentValue,
  amount,
}: {
  investedValue?: Decimal.Value | null;
  currentValue?: Decimal.Value | null;
  amount: Decimal.Value;
}) {
  const contribution = new Decimal(amount);
  if (!contribution.isFinite() || contribution.lte(0)) throw new Error("O aporte deve ser positivo.");
  return {
    investedValue: new Decimal(investedValue ?? 0).add(contribution),
    currentValue: new Decimal(currentValue ?? 0).add(contribution),
  };
}
