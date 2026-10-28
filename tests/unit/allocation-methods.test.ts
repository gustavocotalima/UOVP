import { allocateCerradoCore } from "@/features/portfolio/calculation/cerrado";
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { allocateContribution } from "@/features/portfolio/allocation";
import { DEFAULT_TARGETS } from "@/features/portfolio/constants";
import { Money, type AllocationInput } from "@/features/portfolio/calculation/types";
import { balancePurchases } from "@/features/portfolio/calculation/balanced-search";

const base = Object.fromEntries(Object.keys(DEFAULT_TARGETS).map((k) => [k, 0])) as typeof DEFAULT_TARGETS;
function fixture(prices = [99, 100], target = 50, current = [0, 0]): AllocationInput {
  return { contribution: 5000, targets: { ...base, BRAZILIAN_STOCKS: target, REAL_ESTATE_FUNDS: 100 - target },
    assets: prices.map((price, i) => ({ id: String(i), ticker: `ASSET${i}`, name: `Synthetic ${i}`,
      investmentClass: i === 0 ? "BRAZILIAN_STOCKS" : "REAL_ESTATE_FUNDS", currentValue: current[i],
      quantity: 0, unitPrice: price, score: 1, fractional: false })) };
}
const sumSuggestions = (r: ReturnType<typeof allocateContribution>) => r.suggestions.reduce((s, a) => s.plus(a.value), new Money(0));
function exhaustiveBalance(input: AllocationInput, allowances: Record<string, string | undefined>) {
  const [a, b] = input.assets, budget = Number(input.contribution);
  const pa = new Money(a.unitPrice), pb = new Money(b.unitPrice), total = new Money(a.currentValue).plus(b.currentValue);
  const ta = new Money(input.targets[a.investmentClass]).div(100), tb = new Money(1).minus(ta);
  const ca = new Money(allowances[a.investmentClass]!), cb = new Money(allowances[b.investmentClass]!);
  let best = new Money(1);
  for (let i = 0; i <= Math.floor(budget / pa.toNumber()); i++) for (let j = 0; j <= Math.floor(budget / pb.toNumber()); j++) {
    const av = pa.mul(i), bv = pb.mul(j), spent = av.plus(bv), final = total.plus(spent);
    if (spent.gt(budget)) continue;
    if (i && new Money(a.currentValue).plus(av).gt(final.mul(ta).plus(ca))) continue;
    if (j && new Money(b.currentValue).plus(bv).gt(final.mul(tb).plus(cb))) continue;
    const error = final.gt(0) ? Money.max(0, new Money(a.currentValue).plus(av).minus(final.mul(ta)).abs().minus(ca)).div(final).pow(2)
      .plus(Money.max(0, new Money(b.currentValue).plus(bv).minus(final.mul(tb)).abs().minus(cb)).div(final).pow(2)) : new Money(1);
    best = Money.min(best, error);
  }
  return best;
}

describe("replacement allocation engines", () => {
  it("uses Improved by default and resolves the whole-unit deadlock", () => {
    const input = fixture();
    const r = allocateContribution(input);
    expect(r.calculation.algorithm).toBe("IMPROVED");
    expect(r.suggestions.map((s) => s.quantity.toNumber())).toEqual([25, 25]);
    expect(r.unallocatedAmount.toNumber()).toBe(25);
    expect(r.calculation.warnings).toEqual([]);
    expect(r.calculation.heuristic?.priorities).toEqual(["class_balance", "score_balance", "budget_use"]);
  });
  it("keeps large whole-unit allocations close to budget", () => {
    const input = fixture(); input.contribution = 200000;
    expect(allocateContribution(input).unallocatedAmount.toNumber()).toBe(10);
  });
  it("resolves three whole classes without a fractional receiver", () => {
    const input = fixture([97, 101]); input.contribution = 200000;
    input.targets = { ...base, BRAZILIAN_STOCKS: 50, REAL_ESTATE_FUNDS: 30, REITS: 20 };
    input.assets.push({ ...input.assets[0], id: "2", ticker: "THIRD", investmentClass: "REITS", unitPrice: 103 });
    expect(allocateContribution(input).unallocatedAmount.toNumber()).toBe(35);
  });
  it("keeps an unavoidable single-lot remainder", () => {
    const input = fixture([300]); input.targets = { ...base, BRAZILIAN_STOCKS: 100 }; input.contribution = 1000;
    expect(allocateContribution(input).unallocatedAmount.toNumber()).toBe(100);
  });
  it.each(Array.from({ length: 80 }, (_, i) => i))("matches independently enumerated class balance in small case %i", (seed) => {
    const input = fixture([(5 + seed % 17) / 100, (7 + seed * 7 % 23) / 100], 10 + seed % 81, [seed % 9 / 100, seed * 3 % 11 / 100]);
    input.contribution = (30 + seed % 70) / 100;
    const r = allocateContribution(input);
    const spent = sumSuggestions(r), final = spent.plus(input.assets.reduce((s, a) => s.plus(a.currentValue), new Money(0)));
    let error = new Money(final.gt(0) ? 0 : 1);
    for (const a of input.assets) {
      const added = r.suggestions.find((s) => s.assetId === a.id)?.value ?? new Money(0);
      const tolerance = new Money(r.calculation.classTolerancesBrl[a.investmentClass]!);
      const difference = new Money(a.currentValue).plus(added).minus(final.mul(input.targets[a.investmentClass]).div(100));
      if (added.gt(0)) expect(difference.lte(tolerance)).toBe(true);
      if (final.gt(0)) error = error.plus(Money.max(0, difference.abs().minus(tolerance)).div(final).pow(2));
    }
    expect(spent.lte(input.contribution)).toBe(true);
    expect(error.toNumber()).toBeLessThanOrEqual(exhaustiveBalance(input, r.calculation.classTolerancesBrl).toNumber() + 1e-8);
  });
  it("preserves zero targets, nonpositive scores and currency gates", () => {
    const input = fixture([1, 1]); input.targets = { ...base, BRAZILIAN_STOCKS: 100 };
    input.assets.push({ ...input.assets[0], id: "zero", score: 0 }, { ...input.assets[0], id: "foreign", eligibleToReceive: false });
    const r = allocateContribution(input);
    expect(r.suggestions.map((s) => s.assetId)).toEqual(["0"]);
  });
  it("does not mutate inputs, depend on display order or change Decimal precision", () => {
    const input = fixture(), before = JSON.stringify(input), precision = Decimal.precision;
    const first = allocateContribution(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(allocateContribution({ ...input, assets: [...input.assets].reverse() }).suggestions.map((s) => [s.assetId, s.value.toString()]).sort())
      .toEqual(first.suggestions.map((s) => [s.assetId, s.value.toString()]).sort());
    expect(Decimal.precision).toBe(precision);
  });
  it("conserves exact cash when rounding fractional units down", () => {
    const input = fixture([437988.67256]); input.targets = { ...base, BRAZILIAN_STOCKS: 100 }; input.contribution = "0.01";
    input.assets[0].fractional = true;
    const r = allocateContribution(input);
    expect(r.suggestions[0].quantity.mod("0.0000000001").eq(0)).toBe(true);
    expect(r.suggestions[0].value.plus(r.unallocatedAmount).eq("0.01")).toBe(true);
  });
  it("keeps a balanced incumbent without claiming a proof when refinement time expires", () => {
    const r = balancePurchases({ budget: 100, classes: [{ current: 0, target: 1, tolerance: 1 }],
      assets: [0, 1].map(() => ({ group: 0, current: 0, share: 0.5, tolerance: 1, cost: 1, upper: 100, initial: 50 })), timeLimitMs: 0 });
    expect(r.values).toEqual([50, 50]);
    expect(r.stopReason).toBe("time_limit");
    expect(r).not.toHaveProperty("optimal");
  });
  it("rejects invalid valuations and targets", () => {
    const input = fixture(); input.assets[0].unitPrice = "NaN";
    expect(() => allocateContribution(input)).toThrow("avaliação");
    expect(() => allocateContribution({ ...fixture(), targets: { ...base } })).toThrow("100%");
  });
  it("bounds model memory before starting large calculations", () => {
    const input = fixture(); input.assets = Array.from({ length: 257 }, (_, i) => ({ ...input.assets[0], id: String(i) }));
    expect(() => allocateContribution(input)).toThrow("256");
  });
  it("Cerrado preserves its observed two-pass policy and is separate from Improved", () => {
    const input = fixture([99, 100]); input.contribution = 5000;
    const r = allocateCerradoCore(input);
    expect(r.calculation.algorithm).toBe("CERRADO");
    expect(r.suggestions.every((s) => s.quantity.isInteger())).toBe(true);
    expect(r.suggestions.reduce((s, a) => s.plus(a.value), new Money(0)).plus(r.unallocatedAmount).eq(5000)).toBe(true);
  });
  it("Cerrado applies source-order reservation and removes omitted wealth only from its second pass", () => {
    const input = fixture([50]); input.contribution = 100;
    input.targets = { ...base, BRAZILIAN_STOCKS: 100 };
    input.assets[0].currentValue = 30;
    input.assets.push({ ...input.assets[0], id: "1", ticker: "ASSET1", unitPrice: 70, currentValue: 0 },
      { ...input.assets[0], id: "2", ticker: "ASSET2", unitPrice: 1, currentValue: 0, fractional: true });
    const before = JSON.stringify(input);
    const first = allocateCerradoCore(input);
    const reversed = allocateCerradoCore({ ...input, assets: [input.assets[1], input.assets[0], input.assets[2]] });
    expect(first.suggestions.map((s) => s.assetId)).toEqual(["2"]);
    expect(first.suggestions[0].value.toNumber()).toBeCloseTo(65, 10);
    expect(reversed.suggestions[0].value.toNumber()).toBeCloseTo(100, 8);
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(Array.from({ length: 30 }, (_, i) => i + 1))("conserves the Cerrado budget with %i fractional receivers", (count) => {
    const input = fixture([1]); input.contribution = 100; input.targets = { ...base, CRYPTO: 100 };
    input.assets = Array.from({ length: count }, (_, i) => ({ ...input.assets[0], id: String(i), ticker: String(i),
      investmentClass: "CRYPTO", fractional: true, score: 1 + i % 3 }));
    const r = allocateCerradoCore(input);
    const spent = r.suggestions.reduce((s, a) => s.plus(a.value), new Money(0));
    expect(spent.lte(100)).toBe(true);
    expect(spent.plus(r.unallocatedAmount).eq(100)).toBe(true);
    expect(r.suggestions.every((a) => a.quantity.mod("0.0000000001").eq(0))).toBe(true);
  });
  it("retains excluded holdings in the Improved target denominator", () => {
    const input = fixture([1, 1], 15, [1000, 8000]); input.contribution = 1000;
    input.assets[0].fractional = true; input.assets[1].eligibleToReceive = false;
    const r = allocateContribution(input);
    expect(r.suggestions[0].value.toNumber()).toBe(411.77);
  });
  it.each(["scope", "score", "target"])("does not validate the purchase grid of a holding excluded by %s", (reason) => {
    const input = fixture([1, 10.001], 15, [1000, 8000]); input.contribution = 1000;
    input.assets[0].fractional = true;
    if (reason === "scope") input.assets[1].eligibleToReceive = false;
    if (reason === "score") input.assets[1].score = 0;
    if (reason === "target") input.targets = { ...base, BRAZILIAN_STOCKS: 100 };
    const r = allocateContribution(input);
    expect(r.suggestions.map((s) => s.assetId)).toEqual(["0"]);
    const spent = r.suggestions[0].value;
    expect(spent.plus(r.unallocatedAmount).eq(1000)).toBe(true);
    expect(r.suggestions[0].totalAfterSuggestionPercentage.eq(new Money(1000).plus(spent).div(new Money(9000).plus(spent)).mul(100))).toBe(true);
  });
  it("ignores an excluded fractional settlement grid while still validating eligible purchases", () => {
    const input = fixture([1, 10.001], 100); input.contribution = 100;
    input.assets[1].fractional = true; input.assets[1].quantityStep = "0.1";
    expect(allocateContribution(input).unallocatedAmount.toString()).toBe("0");
    input.targets = { ...base, REAL_ESTATE_FUNDS: 100 };
    expect(() => allocateContribution(input)).toThrow("grade de liquidação explícita");
    input.assets[1].fractional = false; input.assets[1].quantityStep = 1;
    expect(() => allocateContribution(input)).toThrow("grade de liquidação em centavos");
  });
  it.each([true, false])("caps scoped Cerrado purchases against actual investment (fractional=%s)", (fractional) => {
    const input = fixture([fractional ? 1 : 100, 1], 15, [1000, 8000]); input.contribution = 1000;
    input.assets[0].fractional = fractional; input.assets[1].eligibleToReceive = false;
    expect(allocateCerradoCore(input).suggestions[0].value.toString()).toBe("1000");
    input.capEligibleClassesAtTarget = true;
    const r = allocateCerradoCore(input);
    expect(r.suggestions.map((s) => s.assetId)).toEqual(["0"]);
    expect(r.suggestions[0].value.toString()).toBe(fractional ? "411.7647058823" : "400");
    expect(r.suggestions[0].totalAfterSuggestionPercentage.lte(15)).toBe(true);
    expect(r.suggestions[0].value.plus(r.unallocatedAmount).eq(1000)).toBe(true);
  });
  it.each(Array.from({ length: 12 }, (_, i) => i))("rechecks scoped class caps after other purchases round down (%i)", (seed) => {
    const input = fixture([97 + seed, 101 + seed], 33); input.contribution = 20000;
    input.targets = { ...base, BRAZILIAN_STOCKS: 33, REAL_ESTATE_FUNDS: 33, INTERNATIONAL_STOCKS: 34 };
    input.capEligibleClassesAtTarget = true;
    input.assets.push({ ...input.assets[0], id: "excluded", investmentClass: "INTERNATIONAL_STOCKS", currentValue: 10000, eligibleToReceive: false });
    const r = allocateCerradoCore(input);
    const spent = r.suggestions.reduce((s, a) => s.plus(a.value), new Money(0));
    expect(spent.gt(18000)).toBe(true);
    expect(spent.plus(r.unallocatedAmount).eq(20000)).toBe(true);
    for (const cls of ["BRAZILIAN_STOCKS", "REAL_ESTATE_FUNDS"] as const) {
      const added = r.suggestions.filter((s) => s.investmentClass === cls).reduce((s, a) => s.plus(a.value), new Money(0));
      expect(added.lte(new Money(10000).plus(spent).mul(input.targets[cls]).div(100))).toBe(true);
    }
  });
  it("terminates conservatively when a scoped empty portfolio cannot reach missing target classes", () => {
    const input = fixture([1, 1], 49.999); input.contribution = 1000;
    input.targets = { ...base, BRAZILIAN_STOCKS: 49.999, REAL_ESTATE_FUNDS: 49.999, INTERNATIONAL_STOCKS: 0.002 };
    input.capEligibleClassesAtTarget = true; input.assets.forEach((a) => { a.fractional = true; });
    const r = allocateCerradoCore(input);
    expect(r.suggestions).toEqual([]);
    expect(r.unallocatedAmount.toString()).toBe("1000");
  });
});
