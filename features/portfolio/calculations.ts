import Decimal from "decimal.js";

export const CONTRIBUTION_ROWS = [
  50, 100, 200, 300, 400, 500, 1000, 2000, 3000, 5000, 10000, 15000, 20000, 30000,
  50000,
] as const;

export const PROJECTION_YEARS = [10, 15, 20, 25, 30, 35, 40] as const;

export function effectiveMonthlyRate(annualPercent: Decimal.Value) {
  const annual = new Decimal(annualPercent).div(100);
  return new Decimal(Math.pow(annual.plus(1).toNumber(), 1 / 12) - 1);
}

export function futureValue(
  initialValue: Decimal.Value,
  monthlyContribution: Decimal.Value,
  annualPercent: Decimal.Value,
  years: number,
) {
  const principal = new Decimal(initialValue);
  const contribution = new Decimal(monthlyContribution);
  const monthlyRate = effectiveMonthlyRate(annualPercent);
  const months = years * 12;
  if (monthlyRate.eq(0)) return principal.plus(contribution.times(months));
  const growth = monthlyRate.plus(1).pow(months);
  return principal.times(growth).plus(contribution.times(growth.minus(1).div(monthlyRate)));
}

export function firstMillionMatrix(
  initialValue: Decimal.Value,
  annualPercent: Decimal.Value,
) {
  return CONTRIBUTION_ROWS.map((monthlyContribution) => ({
    monthlyContribution,
    values: PROJECTION_YEARS.map((years) => ({
      years,
      value: futureValue(initialValue, monthlyContribution, annualPercent, years),
    })),
  }));
}
