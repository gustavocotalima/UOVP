import { describe, expect, it } from "vitest";
import { allocateContribution } from "@/features/portfolio/allocation";
import { DEFAULT_TARGETS } from "@/features/portfolio/constants";
import { ALLOCATION_VERSIONS, Money, type AllocationInput, type AllocationMethod, type BudgetPolicy } from "@/features/portfolio/calculation/types";
import { waterFill } from "@/features/portfolio/calculation/budget-policy";
import { calculateContribution } from "@/features/portfolio/calculation/server";

const zeros = Object.fromEntries(Object.keys(DEFAULT_TARGETS).map((key) => [key, 0])) as typeof DEFAULT_TARGETS;
const methods: AllocationMethod[] = ["IMPROVED", "CERRADO"];
const policies: BudgetPolicy[] = ["TARGET_CAPPED", "FULL_BUDGET"];
const spent = (r: ReturnType<typeof allocateContribution>) => r.suggestions.reduce((s, a) => s.plus(a.value), new Money(0));
function screenshot(): AllocationInput {
  return { contribution: 538230, budgetPolicy: "TARGET_CAPPED",
    targets: { ...zeros, INTERNATIONAL_STOCKS: 15, BRAZILIAN_STOCKS: 25, REAL_ESTATE_FUNDS: 8, CRYPTO: 5, FIXED_INCOME: 45, STORE_OF_VALUE: 2 },
    assets: [
      ...[["SPHQ", 5838.44, 453.14, 10], ["VEA", 2965.42, 377.49, 5], ["VWO", 1127.20, 306.06, 2], ["XLP", 1831.23, 468.02, 3]].map(([ticker, current, price, score]) => ({
        id: String(ticker), ticker: String(ticker), name: String(ticker), investmentClass: "INTERNATIONAL_STOCKS" as const,
        currentValue: Number(current), unitPrice: Number(price), score: Number(score), quantity: 0, fractional: true, eligibleToReceive: true,
      })),
      { id: "IAUM", ticker: "IAUM", name: "IAUM", investmentClass: "STORE_OF_VALUE", currentValue: 2720.89, unitPrice: 216.66, score: 10, quantity: 0, fractional: true, eligibleToReceive: true },
      // Frozen wealth outside the selected currency. Its distribution among
      // excluded classes does not alter the independently derived cap below.
      { id: "excluded", ticker: "EXCLUDED", name: "Frozen BRL wealth", investmentClass: "FIXED_INCOME", currentValue: 207445.91, unitPrice: 1, score: 10, quantity: 0, fractional: true, eligibleToReceive: false },
    ],
  };
}
function assertCash(input: AllocationInput, r: ReturnType<typeof allocateContribution>) {
  expect(spent(r).lte(input.contribution)).toBe(true);
  expect(spent(r).plus(r.unallocatedAmount).eq(input.contribution)).toBe(true);
  expect(r.suggestions.every((s) => s.quantity.gt(0) && s.quantity.decimalPlaces() <= 10)).toBe(true);
  expect(r.suggestions.some((s) => s.assetId === "excluded")).toBe(false);
}

describe("coordinated contribution baskets and budget policies", () => {
  for (const method of methods) for (const scope of ["USD", "BRL"] as const) {
    it.each([100, 400, 5000])(`${method}/${scope} keeps identical purchases below the global ceiling for budget %i`, (contribution) => {
      const input = screenshot(); input.contribution = contribution;
      if (scope === "BRL") {
        input.assets = input.assets.map((a) => ({ ...a, investmentClass: a.investmentClass === "INTERNATIONAL_STOCKS" ? "BRAZILIAN_STOCKS" : a.investmentClass === "STORE_OF_VALUE" ? "REAL_ESTATE_FUNDS" : "FIXED_INCOME" }));
        input.targets = { ...zeros, BRAZILIAN_STOCKS: 15, REAL_ESTATE_FUNDS: 2, FIXED_INCOME: 83 };
      }
      const capped = allocateContribution(input, method);
      const full = allocateContribution({ ...input, budgetPolicy: "FULL_BUDGET" }, method);
      const purchases = (r: typeof capped) => r.suggestions.map((s) => [s.assetId, s.quantity.toString(), s.value.toString()]);
      expect(purchases(full)).toEqual(purchases(capped));
      expect(full.unallocatedAmount.toString()).toBe(capped.unallocatedAmount.toString());
      expect(full.calculation.budgetPolicy).toBe("FULL_BUDGET");
    });
  }
  it("full mode cannot relax scores when only an overweight asset can receive purchases", () => {
    const input: AllocationInput = { contribution: 1000, targets: { ...zeros, BRAZILIAN_STOCKS: 100 }, assets: [
      { id: "high", ticker: "HIGH", name: "Overweight eligible", investmentClass: "BRAZILIAN_STOCKS", currentValue: 9000, unitPrice: 1, quantity: 0, score: 5, fractional: true },
      { id: "low", ticker: "LOW", name: "Excluded underweight", investmentClass: "BRAZILIAN_STOCKS", currentValue: 0, unitPrice: 1, quantity: 0, score: 5, fractional: true, eligibleToReceive: false },
    ] };
    expect(allocateContribution(input).suggestions).toEqual([]);
    expect(allocateContribution({ ...input, budgetPolicy: "FULL_BUDGET" }).suggestions).toEqual([]);
  });
  it("water-fills lower/upper bounds without selling overweight holdings", () => {
    const values = waterFill([new Money(80), new Money(20), new Money(0)], [new Money(1), new Money(1), new Money(1)], new Money(60), [new Money(200), new Money(200), new Money(30)]);
    expect(values.map(String)).toEqual(["0", "30", "30"]);
  });
  it.each([1, 100, 5000])("Cerrado retains a balanced basket after ten-decimal settlement for budget %i BRL", (contribution) => {
    const input: AllocationInput = { contribution, targets: { ...zeros, BRAZILIAN_STOCKS: 50, INTERNATIONAL_STOCKS: 50 },
      assets: [99.97, 123.47].map((price, i) => ({ id: String(i), ticker: `S${i}`, name: "Synthetic",
        investmentClass: i ? "INTERNATIONAL_STOCKS" : "BRAZILIAN_STOCKS", currentValue: 0,
        quantity: 0, unitPrice: price, score: 10, fractional: true })),
    };
    const result = allocateContribution(input, "CERRADO");
    expect(result.suggestions).toHaveLength(2);
    expect(result.unallocatedAmount.lt("0.000001")).toBe(true);
    for (const row of result.suggestions) expect(row.value.minus(new Money(contribution).div(2)).abs().lt("0.000001")).toBe(true);
    assertCash(input, result);
  });
  it.each(methods)("%s reaches the independent USD-only target ceiling instead of stopping at R$2,211", (method) => {
    const input = screenshot(), before = JSON.stringify(input), r = allocateContribution(input, method);
    const ideal = new Money(207445.91).div("0.83").minus("221929.09");
    expect(spent(r).minus(ideal).abs().lt(1)).toBe(true);
    expect(r.suggestions.filter((s) => s.investmentClass === "INTERNATIONAL_STOCKS")).toHaveLength(4);
    const total = new Money(221929.09).plus(spent(r));
    for (const cls of ["INTERNATIONAL_STOCKS", "STORE_OF_VALUE"] as const) {
      const value = input.assets.filter((a) => a.investmentClass === cls).reduce((s, a) => s.plus(a.currentValue), new Money(0))
        .plus(r.suggestions.filter((s) => s.investmentClass === cls).reduce((s, a) => s.plus(a.value), new Money(0)));
      expect(value.lte(total.mul(input.targets[cls]).div(100).plus("0.03"))).toBe(true);
    }
    expect(r.calculation.budgetPolicy).toBe("TARGET_CAPPED");
    expect(r.calculation.unallocatedReasons).toContain("TARGET_LIMIT");
    expect(r.calculation.version).toBe(ALLOCATION_VERSIONS[method]);
    expect(JSON.stringify(input)).toBe(before); assertCash(input, r);
  });
  it.each(methods)("%s uses the full USD amount and preserves the 15:2 ratio of final eligible holdings", (method) => {
    const input = screenshot(); input.budgetPolicy = "FULL_BUDGET";
    const r = allocateContribution(input, method);
    expect(r.unallocatedAmount.lt("0.01")).toBe(true);
    const international = input.assets.filter((a) => a.investmentClass === "INTERNATIONAL_STOCKS").reduce((s, a) => s.plus(a.currentValue), new Money(0))
      .plus(r.suggestions.filter((s) => s.investmentClass === "INTERNATIONAL_STOCKS").reduce((s, a) => s.plus(a.value), new Money(0)));
    const reserve = new Money(2720.89).plus(r.suggestions.find((s) => s.assetId === "IAUM")!.value);
    expect(international.div(reserve).toNumber()).toBeCloseTo(7.5, 5);
    for (const a of input.assets.filter((a) => a.investmentClass === "INTERNATIONAL_STOCKS")) {
      const final = new Money(a.currentValue).plus(r.suggestions.find((s) => s.assetId === a.id)?.value ?? 0);
      expect(final.div(international).toNumber()).toBeCloseTo(a.score / 20, 5);
    }
    expect(international.div(new Money(221929.09).plus(spent(r))).gt("0.15")).toBe(true);
    assertCash(input, r);
  });
  it.each(methods.flatMap((method) => policies.map((policy) => [method, policy] as const)))("%s handles a BRL-only class basket in %s", (method, policy) => {
    const input = screenshot(); input.budgetPolicy = policy;
    input.assets = input.assets.map((a) => ({ ...a, investmentClass: a.investmentClass === "INTERNATIONAL_STOCKS" ? "BRAZILIAN_STOCKS" : a.investmentClass === "STORE_OF_VALUE" ? "REAL_ESTATE_FUNDS" : "FIXED_INCOME" }));
    input.targets = { ...zeros, BRAZILIAN_STOCKS: 15, REAL_ESTATE_FUNDS: 2, FIXED_INCOME: 83 };
    const r = allocateContribution(input, method);
    expect(spent(r).gt(policy === "FULL_BUDGET" ? 538229 : 28004)).toBe(true);
    assertCash(input, r);
  });
  it.each([3, 4, 8, 32, 128, 256])("grows %i fractional assets together rather than cent by cent", (count) => {
    const input: AllocationInput = { contribution: 100000, targets: { ...zeros, INTERNATIONAL_STOCKS: 100 },
      assets: Array.from({ length: count }, (_, i) => ({ id: String(i), ticker: `S${i}`, name: "Synthetic", investmentClass: "INTERNATIONAL_STOCKS", score: 1 + i % 10, currentValue: (1 + i % 10) * 10, quantity: 0, unitPrice: 99.97 + i, fractional: true })) };
    const r = allocateContribution(input);
    expect(r.unallocatedAmount.lt("0.02")).toBe(true);
    expect(r.suggestions).toHaveLength(count);
    assertCash(input, r);
  });
  it("grows an already balanced whole portfolio with coordinated class baskets", () => {
    const input: AllocationInput = { contribution: 10000, targets: { ...zeros, BRAZILIAN_STOCKS: 50, INTERNATIONAL_STOCKS: 50 }, assets: [] };
    for (const cls of ["BRAZILIAN_STOCKS", "INTERNATIONAL_STOCKS"] as const) for (let i = 0; i < 4; i++) input.assets.push({
      id: `${cls}-${i}`, ticker: `S${i}`, name: "Synthetic", investmentClass: cls, score: i + 1, currentValue: (i + 1) * 100, quantity: 0, unitPrice: 100, fractional: true,
    });
    const r = allocateContribution(input); expect(r.unallocatedAmount.lt("0.01")).toBe(true); expect(r.suggestions).toHaveLength(8); assertCash(input, r);
  });
  it.each(methods.flatMap((method) => policies.map((policy) => [method, policy] as const)))("%s retains excluded wealth and existing score imbalances in %s", (method, policy) => {
    const input: AllocationInput = { contribution: 1000, budgetPolicy: policy, targets: { ...zeros, BRAZILIAN_STOCKS: 100 }, assets: [
      { id: "high", ticker: "HIGH", name: "Overweight", investmentClass: "BRAZILIAN_STOCKS", currentValue: 9000, unitPrice: 1, quantity: 0, score: 5, fractional: true },
      { id: "low", ticker: "LOW", name: "Underweight", investmentClass: "BRAZILIAN_STOCKS", currentValue: 0, unitPrice: 1, quantity: 0, score: 5, fractional: true },
    ] };
    const r = allocateContribution(input, method); expect(r.suggestions.map((s) => s.assetId)).toEqual(["low"]); assertCash(input, r);
  });
  it.each(methods)("%s never revives zero targets, nonpositive scores or missing prices in full mode", (method) => {
    const input = screenshot(); input.budgetPolicy = "FULL_BUDGET";
    input.assets[0].score = 0; input.assets[1].unitPrice = 0;
    input.assets[2].eligibleToReceive = false; input.assets[3].eligibleToReceive = false;
    input.targets.STORE_OF_VALUE = 0; input.targets.FIXED_INCOME = 47;
    const r = allocateContribution(input, method); expect(r.suggestions).toEqual([]); expect(r.unallocatedAmount.eq(input.contribution)).toBe(true);
    expect(r.calculation.unallocatedReasons).toEqual(["NO_ELIGIBLE_ASSETS"]);
  });
  it.each(methods)("%s respects whole units and leaves a legitimate remainder in full mode", (method) => {
    const input: AllocationInput = { contribution: 5000, budgetPolicy: "FULL_BUDGET", targets: { ...zeros, BRAZILIAN_STOCKS: 100 },
      assets: [97, 101, 103, 167].map((price, i) => ({ id: String(i), ticker: `S${i}`, name: "Synthetic", investmentClass: "BRAZILIAN_STOCKS", score: 1, currentValue: 0, quantity: 0, unitPrice: price, fractional: false })) };
    const r = allocateContribution(input, method); expect(r.suggestions.every((s) => s.quantity.isInteger())).toBe(true);
    expect(r.unallocatedAmount.lt(468)).toBe(true); assertCash(input, r);
  });
  it.each(methods.flatMap((method) => policies.map((policy) => [method, policy] as const)))("%s native workers match pure calculations in %s", async (method, policy) => {
    const input = screenshot(); input.budgetPolicy = policy;
    const pure = allocateContribution(input, method);
    const worker = await calculateContribution(input, method, `budget-${method}-${policy}`);
    const values = (r: typeof pure) => r.suggestions.map((s) => [s.assetId, s.value.toString(), s.quantity.toString()]);
    expect(values(worker)).toEqual(values(pure));
    expect(worker.calculation.budgetPolicy).toBe(policy);
    assertCash(input, worker);
  });
  for (const method of methods) for (const policy of policies) {
    it.each(Array.from({ length: 20 }, (_, i) => i))(`${method}/${policy} conserves cash and eligibility with mixed lots, scores and current wealth #%i`, (seed) => {
      const input: AllocationInput = { contribution: 100 + seed * 997.13, budgetPolicy: policy,
        targets: { ...zeros, BRAZILIAN_STOCKS: 35, INTERNATIONAL_STOCKS: 45, STORE_OF_VALUE: 20 },
        assets: Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, ticker: `S${i}`, name: "Synthetic",
          investmentClass: (["BRAZILIAN_STOCKS", "INTERNATIONAL_STOCKS", "STORE_OF_VALUE"] as const)[i % 3],
          currentValue: ((seed + 7) * (i + 3) * 53) % 9000, score: (i + seed) % 11,
          unitPrice: 1.01 + ((i + 1) * (seed + 3)) % 237, quantity: 0,
          fractional: (i + seed) % 2 === 0, eligibleToReceive: i % 4 !== seed % 4,
        })),
      };
      const result = allocateContribution(input, method); assertCash(input, result);
      if (policy === "FULL_BUDGET") {
        const capped = allocateContribution({ ...input, budgetPolicy: "TARGET_CAPPED" }, method);
        for (const first of capped.suggestions) {
          const combined = result.suggestions.find((s) => s.assetId === first.assetId);
          expect(combined?.quantity.gte(first.quantity), first.assetId).toBe(true);
          expect(combined?.value.gte(first.value), first.assetId).toBe(true);
        }
      }
      for (const s of result.suggestions) {
        const a = input.assets.find((a) => a.id === s.assetId)!;
        expect(a.eligibleToReceive && a.score > 0).toBe(true);
        if (!a.fractional) expect(s.quantity.isInteger()).toBe(true);
      }
    });
  }
});
