import Decimal from "decimal.js";

export function budgetCategorySummary(
  income: Decimal.Value,
  targetPercentage: Decimal.Value,
  spent: Decimal.Value,
) {
  const targetAmount = new Decimal(income).times(targetPercentage).div(100);
  const spentAmount = new Decimal(spent);
  return {
    targetAmount,
    spentAmount,
    remainingAmount: targetAmount.minus(spentAmount),
    utilizedPercentage: targetAmount.eq(0)
      ? new Decimal(0)
      : spentAmount.div(targetAmount).times(100),
  };
}
