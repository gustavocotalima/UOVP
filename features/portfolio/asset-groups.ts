import Decimal from "decimal.js";

export type HoldingAmount = {
  currentValue?: Decimal.Value | null;
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
};

export function holdingCurrentValue(holding: HoldingAmount) {
  return holding.currentValue == null
    ? new Decimal(holding.quantity).mul(holding.unitPrice)
    : new Decimal(holding.currentValue);
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
