import { describe, expect, it } from "vitest";
import { allocateContribution } from "@/features/portfolio/allocation";
import { DEFAULT_TARGETS } from "@/features/portfolio/constants";
import { Money, type AllocationInput } from "@/features/portfolio/calculation/types";
import { improvedCalculation } from "@/features/portfolio/calculation/improved";
import { balancePurchases } from "@/features/portfolio/calculation/balanced-search";
import { calculateContribution } from "@/features/portfolio/calculation/server";

const zeros = Object.fromEntries(Object.keys(DEFAULT_TARGETS).map((key) => [key, 0])) as typeof DEFAULT_TARGETS;
function fixture(scores: number[], contribution: number, current = scores.map(() => 0), prices = scores.map(() => 1)): AllocationInput {
  return { contribution, targets: { ...zeros, BRAZILIAN_STOCKS: 100 }, assets: scores.map((score, i) => ({
    id: String(i), ticker: `SYNTH${i}`, name: "Synthetic", investmentClass: "BRAZILIAN_STOCKS", score,
    currentValue: current[i], quantity: 0, unitPrice: prices[i], fractional: false,
  })) };
}
const spent = (r: ReturnType<typeof allocateContribution>) => r.suggestions.reduce((s, a) => s.plus(a.value), new Money(0));

describe("class balance, then score balance, then budget", () => {
  it("uses 20/30/50 proportions for scores 2/3/5", () => {
    const r = allocateContribution(fixture([2, 3, 5], 450));
    expect(r.suggestions.map((s) => s.value.toString())).toEqual(["90", "135", "225"]);
    expect(r.unallocatedAmount.toString()).toBe("0");
    expect(r.calculation.warnings).toEqual([]);
  });
  it("rebalances existing holdings after adding another score-5 asset", () => {
    const r = allocateContribution(fixture([2, 3, 5, 5], 50, [20, 30, 50, 0]));
    expect(r.suggestions.map((s) => [s.assetId, s.value.toString()])).toEqual([["3", "50"]]);
    const final = [20, 30, 50, 50].map((value) => value / 150 * 100);
    expect(final[0]).toBeCloseTo(13.333333, 5);
    expect(final[1]).toBe(20);
    expect(final[2]).toBeCloseTo(33.333333, 5);
    expect(final[3]).toBeCloseTo(33.333333, 5);
  });
  it("does not buy an already overweight asset simply because it has the highest score", () => {
    const input = fixture([2, 3, 5], 100, [20, 80, 900]);
    const r = allocateContribution(input);
    expect(r.suggestions.some((s) => s.assetId === "2")).toBe(false);
    expect(spent(r).gt(0)).toBe(true);
  });
  it("does not concentrate a contribution in the cheapest unit", () => {
    const input = fixture([3, 10, 10], 15000, [1250, 10000, 10000], [6.5, 30, 40]);
    const r = allocateContribution(input), total = spent(r).plus("21250");
    expect(r.suggestions).toHaveLength(3);
    const cheap = r.suggestions.find((s) => s.assetId === "0")!.value;
    expect(new Money("1250").plus(cheap).lte(total.mul(3).div(23).plus("6.5"))).toBe(true);
    expect(cheap.lt(3500)).toBe(true);
  });
  it("accepts a remainder instead of degrading score balance to spend the full budget", () => {
    const input = fixture([2, 3, 5], 500, [0, 0, 0], [1, 3, 100]);
    const r = allocateContribution(input), total = spent(r);
    expect(total.gte(400)).toBe(true);
    expect(total.lt(450)).toBe(true);
    for (const s of r.suggestions) {
      const a = input.assets.find((a) => a.id === s.assetId)!;
      expect(s.value.minus(total.mul(a.score).div(10)).abs().lte(a.unitPrice)).toBe(true);
    }
    expect(total.plus(r.unallocatedAmount).eq(500)).toBe(true);
  });
  it("refines the fallback incumbent and purchases balanced pairs instead of returning nothing", async () => {
    const input = fixture([9, 6], 673, [244, 211], [26, 145]);
    const r = allocateContribution(input), invested = spent(r), final = invested.plus(455);
    expect(invested.toString()).toBe("483");
    expect(invested.plus(r.unallocatedAmount).eq(673)).toBe(true);
    for (const a of input.assets) {
      const value = r.suggestions.find((s) => s.assetId === a.id)?.value ?? new Money(0);
      expect(new Money(a.currentValue).plus(value).minus(final.mul(a.score).div(15)).abs().lte(a.unitPrice)).toBe(true);
    }
    expect(r.calculation.warnings).toEqual([]);
    const server = await calculateContribution(input, "IMPROVED", "synthetic-fallback-regression");
    expect(server.suggestions.map((s) => [s.assetId, s.value.toString()])).toEqual(r.suggestions.map((s) => [s.assetId, s.value.toString()]));
  });
  it("checks simple fallback purchases before an expired refinement deadline", () => {
    const step = improvedCalculation(fixture([9, 6], 673, [244, 211], [26, 145])).next();
    if (step.done) throw new Error("Expected a balance model");
    const result = balancePurchases({ ...step.value, timeLimitMs: 0 });
    expect(result.values.some((quantity) => quantity > 0)).toBe(true);
    expect(result.stopReason).toBe("time_limit");
  });
  it("prioritizes the underweight class before improving scores in an overweight class", () => {
    const input = fixture([2, 3, 5], 1000, [0, 0, 10000]);
    input.targets = { ...zeros, BRAZILIAN_STOCKS: 50, REAL_ESTATE_FUNDS: 50 };
    input.assets.push({ ...input.assets[0], id: "fund", ticker: "FUND", investmentClass: "REAL_ESTATE_FUNDS", currentValue: 0, score: 5 });
    const r = allocateContribution(input);
    expect(r.suggestions.map((s) => s.assetId)).toEqual(["fund"]);
    expect(spent(r).toString()).toBe("1000");
  });
  it.each(Array.from({ length: 60 }, (_, seed) => seed))("preserves budget and score upper bands in varied whole-unit case %i", (seed) => {
    const input = fixture([2, 3, 5, 7], 100 + seed * 19, [seed, seed * 2, seed * 3, seed * 4], [1.01, 4.37, 9.71, 23.89]);
    const before = JSON.stringify(input), r = allocateContribution(input);
    const total = spent(r).plus(seed * 10);
    expect(spent(r).lte(input.contribution)).toBe(true);
    expect(spent(r).plus(r.unallocatedAmount).eq(input.contribution)).toBe(true);
    for (const suggestion of r.suggestions) {
      const a = input.assets.find((a) => a.id === suggestion.assetId)!;
      expect(new Money(a.currentValue).plus(suggestion.value).lte(total.mul(a.score).div(17).plus(a.unitPrice))).toBe(true);
      expect(suggestion.quantity.isInteger()).toBe(true);
    }
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(Array.from({ length: 240 }, (_, seed) => seed))("preserves both balance limits with mixed classes, fractions and scopes (%i)", (seed) => {
    const classes = ["BRAZILIAN_STOCKS", "REAL_ESTATE_FUNDS", "CRYPTO"] as const;
    const input: AllocationInput = { contribution: (1 + seed % 20) * 500,
      targets: { ...zeros, BRAZILIAN_STOCKS: 30, REAL_ESTATE_FUNDS: 30, CRYPTO: 40 },
      assets: Array.from({ length: 4 + seed % 61 }, (_, i) => ({ id: String(i), ticker: `S${i}`, name: "Synthetic",
        investmentClass: classes[i % 3], score: i % 13 === 0 ? 0 : 1 + (seed + i) % 10,
        currentValue: ((seed * 31 + i * 907) % 10000) / 100, quantity: 0, unitPrice: (100 + (seed * 11 + i * 541) % 100000) / 100,
        fractional: i % 7 === 0, eligibleToReceive: seed % 4 !== 0 || i % 3 !== 2,
      })) };
    const r = allocateContribution(input), invested = spent(r);
    const total = input.assets.reduce((s, a) => s.plus(a.currentValue), invested);
    expect(invested.plus(r.unallocatedAmount).eq(input.contribution)).toBe(true);
    expect(invested.lte(input.contribution)).toBe(true);
    for (const cls of classes) {
      const group = input.assets.filter((a) => a.investmentClass === cls);
      const final = group.reduce((s, a) => s.plus(a.currentValue).plus(r.suggestions.find((x) => x.assetId === a.id)?.value ?? 0), new Money(0));
      const suggestions = r.suggestions.filter((s) => s.investmentClass === cls);
      if (suggestions.length) expect(final.lte(total.mul(input.targets[cls]).div(100).plus(r.calculation.classTolerancesBrl[cls]!))).toBe(true);
      const scores = group.reduce((s, a) => s + Math.max(0, a.score), 0);
      for (const suggestion of suggestions) {
        const a = group.find((a) => a.id === suggestion.assetId)!;
        const rounding = new Money(a.fractional ? "0.01" : a.unitPrice).plus("0.0001");
        expect(new Money(a.currentValue).plus(suggestion.value).lte(final.mul(a.score).div(scores).plus(rounding))).toBe(true);
        expect(a.eligibleToReceive).not.toBe(false);
        expect(a.score).toBeGreaterThan(0);
      }
    }
  });
  it.each([64, 128, 256])("handles %i whole-unit assets without dropping their score proportions", (n) => {
    const input = fixture(Array.from({ length: n }, (_, i) => 1 + i % 10), 200000, Array(n).fill(0),
      Array.from({ length: n }, (_, i) => (100 + i * 317) / 100));
    const r = allocateContribution(input), invested = spent(r), totalScores = input.assets.reduce((s, a) => s + a.score, 0);
    expect(invested.gt(190000)).toBe(true);
    expect(invested.lte(200000)).toBe(true);
    for (const s of r.suggestions) {
      const a = input.assets.find((a) => a.id === s.assetId)!;
      expect(s.value.lte(invested.mul(a.score).div(totalScores).plus(a.unitPrice))).toBe(true);
    }
    expect(r.calculation.heuristic?.iterations).toBeLessThanOrEqual(256);
  });
});
