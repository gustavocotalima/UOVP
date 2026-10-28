import Decimal from "decimal.js";
import { ALLOCATION_VERSIONS, finish, validateInput, type AllocationInput } from "./types";
import { capScopedTargets } from "./scoped-targets";
import { describeBudgetRemainder, prepareBudgetPolicy } from "./budget-policy";

const Cash = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const sum = (values: Decimal[]) => values.reduce((a, b) => a.plus(b), new Cash(0));

/** Reconstructed two-pass policy. Source order governs reservations; ticker
 * order governs allocation. No globals, ticker tables or special budgets. */
export function allocateCerradoCore(input: AllocationInput) {
  validateInput(input);
  const budget = new Cash(input.contribution);
  const source = [...input.assets].sort((a, b) => a.sourceOrder && b.sourceOrder
    ? a.sourceOrder < b.sourceOrder ? -1 : a.sourceOrder > b.sourceOrder ? 1 : 0 : 0);
  const assets = source.map((a) => ({ ...a, current: new Cash(a.currentValue), original: new Cash(a.currentValue),
    price: new Cash(a.unitPrice), suggested: new Cash(0), firstRaw: new Cash(0), firstSpent: new Cash(0) }))
    .sort((a, b) => a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const total = sum(assets.map((a) => a.current));
  let remaining = budget;
  const omitted = new Set<string>();
  for (let pass = 0; pass < 2 && remaining.gt(0); pass++) {
    const final = total.plus(budget).minus(sum(assets.filter((a) => omitted.has(a.id)).map((a) => a.original)));
    const gaps = Object.entries(input.targets).map(([cls, target]) => {
      const group = assets.filter((a) => a.investmentClass === cls && !omitted.has(a.id));
      const eligible = group.filter((a) => a.eligibleToReceive !== false && a.score > 0 && a.price.gt(0));
      return [cls, new Cash(target).gt(0) && eligible.length
        ? Cash.max(0, final.mul(target).div(100).minus(sum(group.map((a) => a.current)))) : new Cash(0)] as const;
    });
    const gapTotal = sum(gaps.map(([, gap]) => gap));
    if (gapTotal.lte(0)) break;
    const available = remaining;
    for (const [cls, gap] of gaps) {
      if (gap.lte(0)) continue;
      const classBudget = available.mul(gap).div(gapTotal);
      const group = assets.filter((a) => a.investmentClass === cls && !omitted.has(a.id)
        && a.eligibleToReceive !== false && a.score > 0 && a.price.gt(0));
      const scores = group.reduce((s, a) => s + a.score, 0);
      const pool = sum(group.map((a) => a.current)).plus(classBudget);
      const deficits = group.map((a) => Cash.max(0, pool.mul(a.score).div(scores).minus(a.current)));
      const deficitTotal = sum(deficits);
      if (deficitTotal.lte(0)) continue;
      let spentInClass = new Cash(0);
      group.forEach((a, index) => {
        const raw = classBudget.mul(deficits[index]).div(deficitTotal);
        const rounded = a.fractional ? raw : raw.div(a.price).floor().mul(a.price);
        const spent = Cash.min(classBudget.minus(spentInClass), rounded);
        if (!pass) { a.firstRaw = raw; a.firstSpent = spent; }
        a.current = a.current.plus(spent); a.suggested = a.suggested.plus(spent);
        spentInClass = spentInClass.plus(spent);
      });
    }
    remaining = Cash.max(0, budget.minus(sum(assets.map((a) => a.suggested))));
    if (!pass) {
      let reservation = remaining;
      for (const original of source) {
        const a = byId.get(original.id)!;
        if (a.fractional || a.firstRaw.lte(0) || !a.firstSpent.eq(0)) continue;
        if (reservation.lt(a.price)) omitted.add(a.id);
        reservation = reservation.minus(a.price);
      }
    }
  }
  const result = finish(input, new Map(assets.filter((a) => a.suggested.gt(0))
    .map((a) => [a.id, { quantity: a.suggested.div(a.price), value: a.suggested }])), {
    algorithm: "CERRADO", version: "1", stages: [], warnings: [],
    classTolerancesBrl: {}, reservedAmount: budget.minus(remaining).toString(),
  });
  return input.capEligibleClassesAtTarget ? capScopedTargets(input, result) : result;
}

/** UOVP's budget policy adapter; the reconstructed core above stays intact. */
export function allocateCerrado(input: AllocationInput) {
  const plan = prepareBudgetPolicy(input, "CERRADO");
  const raw = allocateCerradoCore({ ...input, contribution: plan.plannedAmount, targets: plan.targets,
    capEligibleClassesAtTarget: false,
    assets: input.assets.map((asset, i) => ({ ...asset, eligibleToReceive: plan.eligible[i] })),
  });
  const result = finish(input, new Map(raw.suggestions.map((s) => [s.assetId, { quantity: s.quantity, value: s.value }])), {
    ...raw.calculation, version: ALLOCATION_VERSIONS.CERRADO,
  });
  return describeBudgetRemainder(plan.policy === "TARGET_CAPPED" ? capScopedTargets(input, result) : result, plan);
}
