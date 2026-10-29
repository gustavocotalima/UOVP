import { describe, expect, it } from "vitest";
import { allocateContribution } from "@/features/portfolio/allocation";
import { DEFAULT_TARGETS } from "@/features/portfolio/constants";
import { Money, sum, type AllocationInput, type AllocationMethod, type AllocationResult } from "@/features/portfolio/calculation/types";

const zeros = Object.fromEntries(Object.keys(DEFAULT_TARGETS).map((key) => [key, 0])) as typeof DEFAULT_TARGETS;
const methods: AllocationMethod[] = ["IMPROVED", "CERRADO"];
const spent = (result: AllocationResult) => sum(result.suggestions.map((s) => s.value));

function portfolio(currency: "BRL" | "USD", contribution = 5000): AllocationInput {
  const stocks = currency === "USD" ? "INTERNATIONAL_STOCKS" : "BRAZILIAN_STOCKS";
  const reserve = currency === "USD" ? "STORE_OF_VALUE" : "REAL_ESTATE_FUNDS";
  return { contribution, capEligibleClassesAtTarget: true,
    targets: { ...zeros, [stocks]: 15, [reserve]: 2, FIXED_INCOME: 83 },
    assets: [
      ...[2, 3, 5].map<AllocationInput["assets"][number]>((score, i) => ({ id: `stock-${i}`, ticker: `STOCK${i}`, name: "Stock",
        investmentClass: stocks, currentValue: i ? 0 : 100, quantity: i ? 0 : 2,
        unitPrice: 50, score, fractional: true, eligibleToReceive: true })),
      { id: "reserve", ticker: "RESERVE", name: "Reserve", investmentClass: reserve,
        currentValue: 0, quantity: 0, unitPrice: 25, score: 10, fractional: true, eligibleToReceive: true },
      { id: "excluded", ticker: "EXCLUDED", name: "Other currency", investmentClass: "FIXED_INCOME",
        currentValue: 900, quantity: 900, unitPrice: 1, score: 10, fractional: true, eligibleToReceive: false },
    ],
  };
}

function assertPreserved(input: AllocationInput, capped: AllocationResult, full: AllocationResult) {
  for (const first of capped.suggestions) {
    const combined = full.suggestions.find((s) => s.assetId === first.assetId);
    expect(combined, first.assetId).toBeDefined();
    expect(combined!.quantity.gte(first.quantity), first.assetId).toBe(true);
    expect(combined!.value.gte(first.value), first.assetId).toBe(true);
  }
  expect(spent(full).lte(input.contribution)).toBe(true);
  expect(spent(full).plus(full.unallocatedAmount).eq(input.contribution)).toBe(true);
  expect(full.suggestions.some((s) => s.assetId === "excluded")).toBe(false);
  expect(full.suggestions.every((s) => s.quantity.decimalPlaces() <= 10)).toBe(true);
  if (full.calculation.budgetStages) {
    expect(full.calculation.budgetStages.cappedAmount).toBe(spent(capped).toString());
    expect(full.calculation.budgetStages.remainderBudget).toBe(capped.unallocatedAmount.toString());
    expect(new Money(full.calculation.budgetStages.additionalAmount).plus(spent(capped)).eq(spent(full))).toBe(true);
  }
}

describe("full budget supplements immutable capped purchases", () => {
  for (const method of methods) for (const currency of ["BRL", "USD"] as const) {
    it(`${method}/${currency} spends only the remainder after the normal calculation and balances final holdings`, () => {
      const input = portfolio(currency), before = JSON.stringify(input);
      const capped = allocateContribution(input, method);
      const full = allocateContribution({ ...input, budgetPolicy: "FULL_BUDGET" }, method);
      expect(capped.calculation.unallocatedReasons).toContain("TARGET_LIMIT");
      expect(spent(capped).gt(0)).toBe(true);
      expect(full.calculation.budgetStages).toBeDefined();
      assertPreserved(input, capped, full);
      expect(full.unallocatedAmount.lt("0.05")).toBe(true);

      const finalStocks = sum(input.assets.filter((a) => a.id.startsWith("stock-")).map((a) => a.currentValue))
        .plus(sum(full.suggestions.filter((s) => s.assetId.startsWith("stock-")).map((s) => s.value)));
      const finalReserve = full.suggestions.find((s) => s.assetId === "reserve")!.value;
      expect(finalStocks.div(finalReserve).toNumber()).toBeCloseTo(7.5, 3);
      for (const asset of input.assets.filter((a) => a.id.startsWith("stock-"))) {
        const final = new Money(asset.currentValue).plus(full.suggestions.find((s) => s.assetId === asset.id)?.value ?? 0);
        expect(final.div(finalStocks).toNumber()).toBeCloseTo(asset.score / 10, 4);
      }
      const total = new Money(1000).plus(spent(full));
      for (const suggestion of full.suggestions) {
        const asset = input.assets.find((a) => a.id === suggestion.assetId)!;
        expect(suggestion.totalAfterSuggestionPercentage.eq(new Money(asset.currentValue).plus(suggestion.value).div(total).mul(100))).toBe(true);
      }
      expect(JSON.stringify(input)).toBe(before);
    });

    it(`${method}/${currency} keeps below-limit results exactly unchanged`, () => {
      const input = portfolio(currency, 40);
      const capped = allocateContribution(input, method);
      const full = allocateContribution({ ...input, budgetPolicy: "FULL_BUDGET" }, method);
      expect(full.suggestions).toEqual(capped.suggestions);
      expect(full.unallocatedAmount).toEqual(capped.unallocatedAmount);
      expect(full.calculation.budgetStages).toBeUndefined();
    });

    it(`${method}/${currency} preserves whole purchases and never exceeds the combined budget`, () => {
      const input = portfolio(currency);
      input.assets = input.assets.map((a, i) => a.id === "excluded" ? a : { ...a, fractional: false, unitPrice: [37, 43, 71, 29][i] });
      const capped = allocateContribution(input, method);
      const full = allocateContribution({ ...input, budgetPolicy: "FULL_BUDGET" }, method);
      assertPreserved(input, capped, full);
      expect(full.suggestions.every((s) => s.quantity.isInteger())).toBe(true);
      expect(spent(full).gt(spent(capped).plus(4000))).toBe(true);
    });

    it(`${method}/${currency} can supplement a portfolio already at its global target`, () => {
      const input = portfolio(currency, 1000);
      input.targets = { ...zeros, [input.assets[0].investmentClass]: 15, FIXED_INCOME: 85 };
      input.assets = input.assets.filter((a) => a.id !== "reserve").map((a, i) => ({ ...a,
        currentValue: a.id === "excluded" ? 850 : [30, 45, 75][i] }));
      const capped = allocateContribution(input, method);
      const full = allocateContribution({ ...input, budgetPolicy: "FULL_BUDGET" }, method);
      expect(spent(capped).lt("0.02")).toBe(true);
      assertPreserved(input, capped, full);
      expect(full.unallocatedAmount.lt("0.05")).toBe(true);
      for (const suggestion of full.suggestions) {
        expect(suggestion.value.div(spent(full)).toNumber()).toBeCloseTo(input.assets.find((a) => a.id === suggestion.assetId)!.score / 10, 4);
      }
    });
  }

  it.each(methods)("%s does not activate the second stage for rounding alone", (method) => {
    const input: AllocationInput = { contribution: 100, targets: { ...zeros, BRAZILIAN_STOCKS: 100 }, assets: [
      { id: "whole", ticker: "WHOLE", name: "Whole lot", investmentClass: "BRAZILIAN_STOCKS", currentValue: 0,
        quantity: 0, unitPrice: 37, score: 10, fractional: false },
    ] };
    const capped = allocateContribution(input, method);
    const full = allocateContribution({ ...input, budgetPolicy: "FULL_BUDGET" }, method);
    expect(spent(capped).toString()).toBe("74");
    expect(full.suggestions).toEqual(capped.suggestions);
    expect(full.unallocatedAmount.toString()).toBe("26");
    expect(full.calculation.budgetStages).toBeUndefined();
  });
});
