import Decimal from "decimal.js";
import { Money, sum, finish, validateInput, ALLOCATION_VERSION, type AllocationInput, type AllocationResult, type CalculationStage } from "./types";
import { searchIntegers, type IntegerModel, type IntegerSolution } from "./integer-search";

type Row = Record<number, number>;
const floor = (x: Decimal) => x.floor().toNumber();

/** Yields numeric search problems; financial rules and exact checks stay here. */
export function* improvedCalculation(input: AllocationInput): Generator<IntegerModel, AllocationResult, IntegerSolution> {
  validateInput(input);
  if (input.assets.length > 256) throw new Error("O cálculo Melhorado aceita até 256 grupos de ativos por simulação.");
  const amount = new Money(input.contribution);
  const budget = floor(amount.mul(100));
  const assets = [...input.assets].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const classes = Object.keys(input.targets) as Array<keyof typeof input.targets>;
  const total = sum(assets.map((a) => a.currentValue));
  const eligible = assets.map((a) => a.score > 0 && a.eligibleToReceive !== false && new Money(a.unitPrice).gt(0) && new Money(input.targets[a.investmentClass]).gt(0));
  const steps = assets.map((a) => new Money(a.quantityStep ?? (a.fractional ? a.instrumentType === "FIXED_INCOME" ? "0.01" : "0.0000000001" : 1)));
  const granularities = new Map(classes.map((cls) => {
    const candidates = assets.flatMap((a, i) => a.investmentClass === cls && eligible[i]
      ? [Money.min(new Money(budget).div(100), Money.max("0.01", new Money(a.unitPrice).mul(a.fractional ? steps[i] : 1)))] : []);
    return [cls, candidates.length ? Money.min(...candidates) : new Money(0)] as const;
  }));
  const tolerances = new Map(classes.map((cls) => [cls, new Money("0.01").plus(new Money(input.targets[cls]).div(100)
    .mul(sum([...granularities].filter(([other]) => other !== cls).map(([, g]) => g))))] as const));
  const costs: number[] = [], upper: number[] = [], losses: Decimal[] = [];
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i], price = new Money(a.unitPrice), quantum = price.mul(steps[i]).mul(100);
    if (!a.fractional && !price.mul(100).isInteger()) throw new Error("A cotação de ativos inteiros precisa de uma grade de liquidação em centavos.");
    const exactFraction = a.fractional && quantum.gte(1);
    if (exactFraction && !quantum.isInteger()) throw new Error("O passo fracionário exige uma grade de liquidação explícita.");
    const cost = a.fractional ? exactFraction ? quantum.toNumber() : 1 : Math.max(1, price.mul(100).toNumber());
    if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(budget)) throw new Error("Valor fora dos limites de precisão do cálculo.");
    costs.push(cost); upper.push(eligible[i] ? Math.floor(budget / cost) : 0);
    losses.push(eligible[i] && a.fractional && !exactFraction ? quantum : new Money(0));
  }
  let width = assets.length;
  const integer = Array.from({ length: width }, (_, i) => i);
  const binary: number[] = [];
  const activeClasses = new Map<string, number>();
  const rows: Row[] = [], bounds: number[] = [];
  let seed = Array(width).fill(0);
  const add = (row: Row, rhs: number) => { rows.push(row); bounds.push(rhs); };
  const variable = (integral = false, cap?: number) => {
    const i = width++; seed.push(0); if (integral) integer.push(i);
    if (cap !== undefined) add({ [i]: 1 }, cap);
    return i;
  };
  const cashRow = Object.fromEntries(costs.map((c, i) => [i, c]));
  add(cashRow, budget);
  upper.forEach((limit, i) => add({ [i]: 1 }, limit));
  const classRows = new Map(classes.map((cls) => [cls, Object.fromEntries(assets.flatMap((a, i) => a.investmentClass === cls ? [[i, costs[i]]] : []))]));
  for (const cls of classes) {
    const indices = Object.keys(classRows.get(cls)!).map(Number);
    if (!indices.some((i) => upper[i])) continue;
    const [pn, qn] = new Money(input.targets[cls]).div(100).toFraction();
    const p = pn.toNumber(), q = qn.toNumber();
    if (p === q) continue;
    const current = sum(assets.filter((a) => a.investmentClass === cls).map((a) => a.currentValue));
    const outsideLoss = sum(losses.filter((_, i) => assets[i].investmentClass !== cls));
    const rhs = floor(total.mul(100).mul(p).minus(current.mul(100).mul(q)).minus(outsideLoss.mul(p)).plus(tolerances.get(cls)!.mul(q * 100)));
    if (!Number.isSafeInteger(rhs)) throw new Error("Metas fora dos limites de precisão do cálculo.");
    const active = variable(true, 1), bigM = Math.max(0, -rhs);
    binary.push(active);
    activeClasses.set(cls, active);
    add({ ...classRows.get(cls), [active]: -budget }, 0);
    const row: Row = Object.fromEntries(costs.map((cost, i) => [i, ((assets[i].investmentClass === cls ? q : 0) - p) * cost]));
    row[active] = bigM;
    add(row, rhs + bigM);
  }
  // A feasible cheap-lot incumbent gives the search a useful bound immediately.
  // It is only an initial combination: subsequent stages optimize classes/notes.
  const fullFinal = total.plus(new Money(budget).div(100));
  const initialGaps = new Map(classes.map((cls) => [cls, assets.some((a, i) => a.investmentClass === cls && upper[i])
    ? Money.max(0, fullFinal.mul(input.targets[cls]).div(100).minus(sum(assets.filter((a) => a.investmentClass === cls).map((a) => a.currentValue)))) : new Money(0)]));
  const initialTotal = sum([...initialGaps.values()]);
  if (initialTotal.gt(0)) {
    for (const cls of classes) {
      const candidates = assets.flatMap((a, i) => a.investmentClass === cls && upper[i] ? [i] : []).sort((a, b) => costs[a] - costs[b]);
      const i = candidates[0];
      if (i === undefined) continue;
      seed[i] = Math.min(upper[i], floor(initialGaps.get(cls)!.mul(budget).div(initialTotal).div(costs[i])));
    }
    for (const cls of classes) {
      const i = assets.findIndex((a, i) => a.investmentClass === cls && upper[i] && costs[i] === 1);
      if (i < 0) continue;
      const already = sum(assets.flatMap((a, j) => a.investmentClass === cls ? [new Money(a.currentValue).mul(100).plus(seed[j] * costs[j])] : []));
      const safety = sum(losses.filter((_, j) => assets[j].investmentClass !== cls)).mul(new Money(input.targets[cls]).div(100));
      const room = floor(fullFinal.mul(input.targets[cls]).plus(tolerances.get(cls)!.mul(100)).minus(already).minus(safety));
      const remaining = budget - costs.reduce((s, c, j) => s + c * seed[j], 0);
      seed[i] += Math.max(0, Math.min(room, remaining));
    }
    for (const [cls, index] of activeClasses) seed[index] = assets.some((a, i) => a.investmentClass === cls && seed[i] > 0) ? 1 : 0;
  }
  const stages: CalculationStage[] = [];
  const model = (objective: Row): IntegerModel => ({
    objective: Array.from({ length: width }, (_, i) => objective[i] ?? 0),
    rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? 0)), bounds: [...bounds],
    integer: [...integer], binary: [...binary], weights: Array.from({ length: width }, (_, i) => costs[i] ?? 1), seed: [...seed], timeLimitMs: 3000,
  });
  const accept = (name: string, solution: IntegerSolution) => {
    seed = [...solution.values]; stages.push({ name, optimal: solution.optimal, nodes: solution.nodes });
  };
  if (budget && upper.some(Boolean)) {
    accept("maximize_cash", yield model(cashRow));
    const best = costs.reduce((v, cost, i) => v + cost * Math.round(seed[i]), 0);
    add(cashRow, best); add(Object.fromEntries(Object.entries(cashRow).map(([i, c]) => [i, -c])), -best);
    if (best) {
      const final = total.plus(new Money(best).div(100));
      const gaps = new Map(classes.map((cls) => [cls, Object.keys(classRows.get(cls)!).some((i) => upper[Number(i)])
        ? Money.max(0, final.mul(input.targets[cls]).div(100).minus(sum(assets.filter((a) => a.investmentClass === cls).map((a) => a.currentValue)))) : new Money(0)]));
      const allGaps = sum([...gaps.values()]);
      const refs = new Map(classes.map((cls) => [cls, allGaps.gt(0) ? gaps.get(cls)!.mul(best).div(allGaps) : new Money(0)]));
      const classDeviations: number[] = [], assetDeviations: number[] = [];
      const deviation = (row: Row, reference: Decimal) => {
        const aux = variable();
        add({ ...row, [aux]: -1 }, reference.toNumber());
        add({ ...Object.fromEntries(Object.entries(row).map(([i, c]) => [i, -c])), [aux]: -1 }, reference.neg().toNumber());
        seed[aux] = Math.abs(Object.entries(row).reduce((v, [i, c]) => v + c * seed[Number(i)], 0) - reference.toNumber());
        return aux;
      };
      for (const cls of classes) classDeviations.push(deviation(classRows.get(cls)!, refs.get(cls)!));
      for (const cls of classes) {
        const positive = assets.flatMap((a, i) => a.investmentClass === cls && a.score > 0 ? [i] : []);
        const notes = positive.reduce((s, i) => s + assets[i].score, 0);
        const pool = sum(positive.map((i) => new Money(assets[i].currentValue).mul(100))).plus(refs.get(cls)!);
        const deficits = positive.filter((i) => upper[i]).map((i) => [i, Money.max(0, pool.mul(assets[i].score).div(notes).minus(new Money(assets[i].currentValue).mul(100)))] as const);
        const allDeficits = sum(deficits.map(([, d]) => d));
        for (const [i, deficit] of deficits) assetDeviations.push(deviation({ [i]: costs[i] }, allDeficits.gt(0) ? refs.get(cls)!.mul(deficit).div(allDeficits) : new Money(0)));
      }
      accept("minimize_class_error", yield model(Object.fromEntries(classDeviations.map((i) => [i, -1]))));
      const classError = classDeviations.reduce((s, i) => s + seed[i], 0);
      add(Object.fromEntries(classDeviations.map((i) => [i, 1])), classError + 0.00001);
      accept("minimize_score_error", yield model(Object.fromEntries(assetDeviations.map((i) => [i, -1]))));
    }
  }
  const values = new Map<string, { quantity: Decimal; value: Decimal }>();
  let reserved = new Money(0);
  for (let i = 0; i < assets.length; i++) {
    const count = Math.round(seed[i]); if (!count) continue;
    const a = assets[i], price = new Money(a.unitPrice), reserve = new Money(count).mul(costs[i]).div(100);
    const quantity = a.fractional ? reserve.div(price).div(steps[i]).floor().mul(steps[i]) : new Money(count);
    // Database values have ten decimal places. Persist with conservative rounding.
    const value = quantity.mul(price).toDecimalPlaces(10, Decimal.ROUND_DOWN);
    if (quantity.gt(0)) values.set(a.id, { quantity, value });
    reserved = reserved.plus(reserve);
  }
  const spent = sum([...values.values()].map((v) => v.value));
  if (reserved.gt(amount) || spent.gt(reserved)) throw new Error("O cálculo excedeu o orçamento.");
  for (const cls of classes) {
    const group = assets.filter((a) => a.investmentClass === cls);
    const added = sum(group.map((a) => values.get(a.id)?.value ?? 0));
    const current = sum(group.map((a) => a.currentValue));
    if (added.gt(0) && current.plus(added).gt(total.plus(spent).mul(input.targets[cls]).div(100).plus(tolerances.get(cls)!))) {
      throw new Error("A combinação encontrada não respeita o limite da meta. Calcule novamente.");
    }
  }
  return finish(input, values, {
    algorithm: "IMPROVED", version: ALLOCATION_VERSION, stages,
    warnings: stages.some((s) => !s.optimal) ? ["Limite de cálculo atingido: esta combinação é válida, mas sua otimização não foi totalmente comprovada."] : [],
    classTolerancesBrl: Object.fromEntries([...tolerances].map(([cls, v]) => [cls, v.toString()])), reservedAmount: reserved.toString(),
  });
}

export function allocateImproved(input: AllocationInput) {
  const calculation = improvedCalculation(input);
  let step = calculation.next();
  while (!step.done) step = calculation.next(searchIntegers(step.value));
  return step.value;
}
