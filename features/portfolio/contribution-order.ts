import { INVESTMENT_CLASSES, type InvestmentClassKey } from "./constants";

const investmentClassOrder = new Map(
  INVESTMENT_CLASSES.map((investmentClass, index) => [investmentClass, index]),
);

export function sortContributionSuggestions<
  T extends { investmentClass: InvestmentClassKey; ticker: string },
>(suggestions: readonly T[]): T[] {
  return [...suggestions].sort((left, right) => {
    const classComparison = (investmentClassOrder.get(left.investmentClass) ?? Number.MAX_SAFE_INTEGER)
      - (investmentClassOrder.get(right.investmentClass) ?? Number.MAX_SAFE_INTEGER);

    return classComparison || left.ticker.localeCompare(right.ticker, "pt-BR", {
      numeric: true,
      sensitivity: "base",
    });
  });
}
