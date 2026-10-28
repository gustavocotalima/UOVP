import type Decimal from "decimal.js";
import { Money, sum, validateInput, type AllocationInput, type AllocationMethod, type BudgetPolicy, type CalculationDiagnostics, type AllocationResult } from "./types";

/** Weighted water filling with immutable lower bounds and optional upper
 * bounds. Breakpoints avoid both cent-by-cent growth and nested searches. */
export function waterFill(current: Decimal[], weights: Decimal[], amount: Decimal, limits = current.map((value) => value.plus(amount))): Decimal[] {
  const events: { at: Decimal; slope: Decimal }[] = [];
  let capacity = new Money(0);
  current.forEach((value, i) => {
    if (!weights[i].gt(0) || !limits[i].gt(value)) return;
    capacity = capacity.plus(limits[i].minus(value));
    events.push({ at: value.div(weights[i]), slope: weights[i] }, { at: limits[i].div(weights[i]), slope: weights[i].neg() });
  });
  const target = Money.min(amount, capacity);
  if (!target.gt(0)) return current.map(() => new Money(0));
  events.sort((a, b) => a.at.cmp(b.at));
  let level = new Money(0), used = new Money(0), slope = new Money(0);
  for (const event of events) {
    const next = used.plus(event.at.minus(level).mul(slope));
    if (slope.gt(0) && next.gte(target)) {
      level = level.plus(target.minus(used).div(slope));
      return current.map((value, i) => weights[i].gt(0)
        ? Money.max(0, Money.min(limits[i], level.mul(weights[i])).minus(value)) : new Money(0));
    }
    used = next; level = event.at; slope = slope.plus(event.slope);
  }
  return current.map((value, i) => weights[i].gt(0) ? Money.max(0, limits[i].minus(value)) : new Money(0));
}

export function prepareBudgetPolicy(input: AllocationInput, method: AllocationMethod) {
  validateInput(input);
  if (input.assets.length > 256) throw new Error("O cálculo aceita até 256 grupos de ativos por simulação.");
  const policy: BudgetPolicy = input.budgetPolicy ?? "TARGET_CAPPED";
  const budget = new Money(input.contribution), total = sum(input.assets.map((a) => a.currentValue));
  const classes = Object.keys(input.targets) as Array<keyof typeof input.targets>;
  const increments = input.assets.map((a) => {
    const price = new Money(a.unitPrice), step = new Money(a.quantityStep ?? (a.fractional ? a.instrumentType === "FIXED_INCOME" ? "0.01" : "0.0000000001" : 1));
    return a.fractional ? Money.max("0.01", price.mul(step)) : price;
  });
  const eligible = input.assets.map((a, i) => a.eligibleToReceive !== false && a.score > 0
    && new Money(a.unitPrice).gt(0) && new Money(input.targets[a.investmentClass]).gt(0) && increments[i].lte(budget));
  const current = classes.map((cls) => sum(input.assets.filter((a) => a.investmentClass === cls).map((a) => a.currentValue)));
  const scores = classes.map((cls) => input.assets.filter((a) => a.investmentClass === cls && a.score > 0).reduce((n, a) => n + a.score, 0));
  const shares = input.assets.map((a) => a.score > 0 ? new Money(a.score).div(scores[classes.indexOf(a.investmentClass)]) : new Money(0));
  const weights = classes.map((cls) => input.assets.some((a, i) => a.investmentClass === cls && eligible[i]) ? new Money(input.targets[cls]).div(100) : new Money(0));
  const noteCaps = classes.map((cls) => {
    if (!weights[classes.indexOf(cls)].gt(0)) return new Money(0);
    if (policy === "FULL_BUDGET" || method === "CERRADO") return budget;
    const room = (amount: Decimal) => sum(input.assets.flatMap((a, i) => a.investmentClass === cls && eligible[i]
      ? [Money.max(0, current[classes.indexOf(cls)].plus(amount).mul(shares[i]).plus(increments[i]).minus(a.currentValue))] : []));
    if (room(budget).gte(budget)) return budget;
    let low = new Money(0), high = budget;
    for (let n = 0; n < 64; n++) {
      const mid = low.plus(high).div(2);
      if (room(mid).gte(mid)) low = mid; else high = mid;
    }
    return low;
  });
  const allocateClasses = (amount: Decimal) => waterFill(current, weights, amount, current.map((value, i) => value.plus(noteCaps[i])));
  let plannedAmount = Money.min(budget, sum(noteCaps));
  if (policy === "TARGET_CAPPED") {
    const feasible = (amount: Decimal) => {
      const additions = allocateClasses(amount), actual = sum(additions);
      return additions.every((added, i) => !added.gt(0) || current[i].plus(added).lte(total.plus(actual).mul(input.targets[classes[i]]).div(100).plus("0.000000001")));
    };
    if (!feasible(plannedAmount)) {
      let low = new Money(0), high = plannedAmount;
      for (let n = 0; n < 64; n++) {
        const mid = low.plus(high).div(2);
        if (feasible(mid)) low = mid; else high = mid;
      }
      plannedAmount = low;
    }
  }
  const classAdditions = allocateClasses(plannedAmount);
  plannedAmount = sum(classAdditions);
  const assetAdditions = input.assets.map(() => new Money(0));
  classes.forEach((cls, group) => {
    const indices = input.assets.flatMap((a, i) => a.investmentClass === cls ? [i] : []);
    const values = waterFill(indices.map((i) => new Money(input.assets[i].currentValue)), indices.map((i) => eligible[i] ? new Money(input.assets[i].score) : new Money(0)), classAdditions[group]);
    indices.forEach((i, j) => { assetAdditions[i] = values[j]; });
  });
  const final = total.plus(plannedAmount);
  const targets = { ...input.targets };
  if (final.gt(0)) {
    const last = classes.reduce((best, cls, i) => current[i].plus(classAdditions[i]).gt(current[classes.indexOf(best)].plus(classAdditions[classes.indexOf(best)])) ? cls : best, classes[0]);
    classes.forEach((cls, i) => { targets[cls] = current[i].plus(classAdditions[i]).div(final).mul(100); });
    targets[last] = new Money(100).minus(sum(classes.filter((cls) => cls !== last).map((cls) => targets[cls])));
  }
  const plannedShares = input.assets.map((a, i) => {
    const group = classes.indexOf(a.investmentClass), value = current[group].plus(classAdditions[group]);
    return policy === "FULL_BUDGET" && value.gt(0) ? new Money(a.currentValue).plus(assetAdditions[i]).div(value) : shares[i];
  });
  return { policy, plannedAmount, targets, eligible, assetAdditions, plannedShares,
    classAdditions: new Map(classes.map((cls, i) => [cls, classAdditions[i]])),
    diagnostics: {
      budgetPolicy: policy, plannedAmount: plannedAmount.toString(),
      originalTargets: Object.fromEntries(classes.map((cls) => [cls, new Money(input.targets[cls]).toString()])),
      planningTargets: Object.fromEntries(classes.map((cls) => [cls, new Money(targets[cls]).toString()])),
    } satisfies Partial<CalculationDiagnostics>,
  };
}

export function describeBudgetRemainder(result: AllocationResult, plan: ReturnType<typeof prepareBudgetPolicy>): AllocationResult {
  const spent = sum(result.suggestions.map((s) => s.value));
  const reasons: NonNullable<CalculationDiagnostics["unallocatedReasons"]> = [];
  if (result.unallocatedAmount.gt("0.00000001")) {
    if (!plan.eligible.some(Boolean)) reasons.push("NO_ELIGIBLE_ASSETS");
    else {
      if (plan.plannedAmount.plus("0.01").lt(spent.plus(result.unallocatedAmount))) reasons.push("TARGET_LIMIT");
      if (spent.plus("0.01").lt(plan.plannedAmount)) reasons.push(result.calculation.algorithm === "CERRADO" ? "METHOD_RULES" : "ROUNDING");
      if (!reasons.length) reasons.push("ROUNDING");
    }
  }
  return { ...result, calculation: { ...result.calculation, ...plan.diagnostics, unallocatedReasons: reasons } };
}
