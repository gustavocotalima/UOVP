import Decimal from "decimal.js";
import { ALLOCATION_VERSIONS, Money, sum, finish, validateInput, type AllocationInput, type AllocationResult } from "./types";
import { balancePurchases, type BalanceModel, type BalanceSolution } from "./balanced-search";

export const IMPROVED_VERSION = ALLOCATION_VERSIONS.IMPROVED;

/** Class targets -> score proportions -> budget use. Financial amounts stay
 * in Decimal; only bounded numeric apportionment runs in the native worker. */
export function* improvedCalculation(input: AllocationInput): Generator<BalanceModel, AllocationResult, BalanceSolution> {
  validateInput(input);
  if (input.assets.length > 256) throw new Error("O cálculo Melhorado aceita até 256 grupos de ativos por simulação.");
  const amount = new Money(input.contribution), budget = amount.mul(100).floor().toNumber();
  const assets = [...input.assets].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const classes = Object.keys(input.targets) as Array<keyof typeof input.targets>;
  const total = sum(assets.map((a) => a.currentValue));
  if (!Number.isSafeInteger(budget) || !Number.isFinite(total.toNumber()) || total.mul(100).gt(Number.MAX_SAFE_INTEGER / 4)) {
    throw new Error("Valor fora dos limites de precisão do cálculo.");
  }
  const eligible = assets.map((a) => a.score > 0 && a.eligibleToReceive !== false && new Money(a.unitPrice).gt(0) && new Money(input.targets[a.investmentClass]).gt(0));
  const steps = assets.map((a) => new Money(a.quantityStep ?? (a.fractional ? a.instrumentType === "FIXED_INCOME" ? "0.01" : "0.0000000001" : 1)));
  const costs: number[] = [], upper: number[] = [], losses: Decimal[] = [], lots: Decimal[] = [];
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i], price = new Money(a.unitPrice), quantum = price.mul(steps[i]).mul(100);
    if (!eligible[i]) {
      costs.push(1); upper.push(0); losses.push(new Money(0));
      lots.push(Money.max("0.01", a.fractional ? quantum.div(100) : price));
      continue;
    }
    if (!a.fractional && !price.mul(100).isInteger()) throw new Error("A cotação de ativos inteiros precisa de uma grade de liquidação em centavos.");
    const exactFraction = a.fractional && quantum.gte(1);
    if (exactFraction && !quantum.isInteger()) throw new Error("O passo fracionário exige uma grade de liquidação explícita.");
    const cost = a.fractional ? exactFraction ? quantum.toNumber() : 1 : price.mul(100).toNumber();
    if (!Number.isSafeInteger(cost) || cost < 1) throw new Error("Valor fora dos limites de precisão do cálculo.");
    costs.push(cost); upper.push(Math.floor(budget / cost));
    lots.push(new Money(cost).div(100));
    losses.push(a.fractional && !exactFraction ? quantum.div(100) : new Money(0));
  }
  const current = new Map(classes.map((cls) => [cls, sum(assets.filter((a) => a.investmentClass === cls).map((a) => a.currentValue))]));
  const scores = new Map(classes.map((cls) => [cls, assets.filter((a) => a.investmentClass === cls && a.score > 0).reduce((s, a) => s + a.score, 0)]));
  const shares = assets.map((a) => a.score > 0 ? new Money(a.score).div(scores.get(a.investmentClass)!) : new Money(0));
  const granularities = new Map(classes.map((cls) => {
    const candidates = assets.flatMap((a, i) => a.investmentClass === cls && upper[i] ? [lots[i]] : []);
    return [cls, candidates.length ? Money.min(...candidates) : new Money(0)] as const;
  }));
  const roundingLoss = (cls: string, outside: boolean) => sum(losses.filter((_, i) => (assets[i].investmentClass !== cls) === outside));
  const allClassesAvailable = classes.every((cls) => new Money(input.targets[cls]).eq(0) || granularities.get(cls)!.gt(0));
  const tolerances = new Map(classes.map((cls) => {
    const target = new Money(input.targets[cls]).div(100), own = granularities.get(cls)!;
    return [cls, Money.max(allClassesAvailable && own.gt("0.01") ? own.div(2) : 0,
      target.mul(sum([...granularities].filter(([other]) => other !== cls).map(([, g]) => g))),
      target.mul(roundingLoss(cls, true))).plus("0.01")] as const;
  }));
  const noteTolerances = assets.map((a, i) => lots[i].plus(shares[i].mul(roundingLoss(a.investmentClass, false).minus(losses[i]))));
  const gaps = new Map(classes.map((cls) => [cls, assets.some((a, i) => a.investmentClass === cls && upper[i])
    ? Money.max(0, total.plus(amount).mul(input.targets[cls]).div(100).minus(current.get(cls)!)) : new Money(0)]));
  const allGaps = sum([...gaps.values()]);
  const classReferences = new Map(classes.map((cls) => [cls, allGaps.gt(0) ? amount.mul(gaps.get(cls)!).div(allGaps) : new Money(0)]));
  const assetReferences = assets.map(() => new Money(0));
  for (const cls of classes) {
    const reference = classReferences.get(cls)!, final = current.get(cls)!.plus(reference);
    const deficits = assets.map((a, i) => a.investmentClass === cls && upper[i] ? Money.max(0, final.mul(shares[i]).minus(a.currentValue)) : new Money(0));
    const all = sum(deficits);
    if (all.gt(0)) assets.forEach((a, i) => { if (a.investmentClass === cls) assetReferences[i] = reference.mul(deficits[i]).div(all); });
  }
  const guard = Math.max(0.0001, Number.EPSILON * total.plus(amount).mul(100).toNumber() * 32);
  const model: BalanceModel = {
    budget, timeLimitMs: 3000,
    classes: classes.map((cls) => ({ current: current.get(cls)!.mul(100).toNumber(), target: new Money(input.targets[cls]).div(100).toNumber(),
      tolerance: tolerances.get(cls)!.minus(new Money(input.targets[cls]).div(100).mul(roundingLoss(cls, true))).mul(100).toNumber() - guard })),
    assets: assets.map((a, i) => ({ group: classes.indexOf(a.investmentClass), current: new Money(a.currentValue).mul(100).toNumber(), share: shares[i].toNumber(),
      tolerance: lots[i].mul(100).toNumber() - guard, cost: costs[i], upper: upper[i], initial: assetReferences[i].mul(100).div(costs[i]).toNumber() })),
  };
  const solution: BalanceSolution = budget && upper.some(Boolean) ? yield model : { values: assets.map(() => 0), iterations: 0, evaluations: 0, stopReason: "stable" };
  const values = new Map<string, { quantity: Decimal; value: Decimal }>();
  let reserved = new Money(0);
  for (let i = 0; i < assets.length; i++) {
    const count = solution.values[i];
    if (!Number.isSafeInteger(count) || count < 0 || count > upper[i]) throw new Error("Quantidade inválida no cálculo.");
    if (!count) continue;
    const a = assets[i], reserve = new Money(count).mul(costs[i]).div(100), price = new Money(a.unitPrice);
    const quantity = a.fractional ? reserve.div(price).div(steps[i]).floor().mul(steps[i]) : new Money(count);
    const value = quantity.mul(price).toDecimalPlaces(10, Decimal.ROUND_DOWN);
    if (quantity.gt(0)) values.set(a.id, { quantity, value });
    reserved = reserved.plus(reserve);
  }
  const spent = sum([...values.values()].map((v) => v.value));
  if (reserved.gt(amount) || spent.gt(reserved)) throw new Error("O cálculo excedeu o orçamento.");
  for (const cls of classes) {
    const group = assets.filter((a) => a.investmentClass === cls);
    const added = sum(group.map((a) => values.get(a.id)?.value ?? 0)), classFinal = current.get(cls)!.plus(added);
    if (added.gt(0) && classFinal.gt(total.plus(spent).mul(input.targets[cls]).div(100).plus(tolerances.get(cls)!))) {
      throw new Error("A distribuição encontrada não respeita o limite da meta.");
    }
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i], value = values.get(a.id)?.value;
      if (a.investmentClass === cls && value?.gt(0) && new Money(a.currentValue).plus(value).gt(classFinal.mul(shares[i]).plus(noteTolerances[i]))) {
        throw new Error("A distribuição encontrada não respeita a proporção das notas.");
      }
    }
  }
  return finish(input, values, {
    algorithm: "IMPROVED", version: IMPROVED_VERSION, stages: [], warnings: [],
    classTolerancesBrl: Object.fromEntries([...tolerances].map(([cls, value]) => [cls, value.toString()])), reservedAmount: reserved.toString(),
    heuristic: { priorities: ["class_balance", "score_balance", "budget_use"], iterations: solution.iterations, evaluations: solution.evaluations, stopReason: solution.stopReason },
  });
}

export function allocateImproved(input: AllocationInput) {
  const calculation = improvedCalculation(input);
  let step = calculation.next();
  while (!step.done) step = calculation.next(balancePurchases(step.value));
  return step.value;
}
