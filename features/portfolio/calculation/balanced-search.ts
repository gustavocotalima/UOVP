export type BalanceModel = {
  budget: number;
  classes: { current: number; target: number; tolerance: number }[];
  assets: { group: number; current: number; share: number; tolerance: number; cost: number; upper: number; initial: number }[];
  timeLimitMs: number;
};
export type BalanceSolution = {
  values: number[]; iterations: number; evaluations: number;
  stopReason: "stable" | "iteration_limit" | "time_limit";
};

/** Deterministic local apportionment, not a proof of a global optimum. Its
 * priorities are class balance, score balance, then budget use. One-lot bands
 * make indivisible holdings possible without turning small price differences
 * into permission to concentrate a contribution in the cheapest instrument.
 * Self-contained: the native worker runs the same function as offline tests.
 */
export function balancePurchases(model: BalanceModel): BalanceSolution {
  const n = model.assets.length, m = model.classes.length;
  const total = model.classes.reduce((s, c) => s + c.current, 0);
  const deadline = Date.now() + model.timeLimitMs;
  let evaluations = 0;
  type State = { values: number[]; spent: number; groups: number[]; hard: number; macro: number; notes: number };
  const evaluate = (values: number[]): State => {
    evaluations++;
    const groups = Array(m).fill(0);
    let spent = 0, hard = 0, macro = 0, notes = 0;
    for (let i = 0; i < n; i++) {
      const value = values[i] * model.assets[i].cost;
      spent += value; groups[model.assets[i].group] += value;
    }
    const final = total + spent;
    for (let c = 0; c < m; c++) {
      const group = model.classes[c], value = group.current + groups[c];
      const difference = value - final * group.target;
      if (groups[c] > 0) hard += Math.max(0, difference - group.tolerance);
      const error = Math.max(0, Math.abs(difference) - group.tolerance);
      if (final > 0) macro += (error / final) ** 2;
    }
    if (!final && model.budget > 0) macro = 1;
    for (let i = 0; i < n; i++) {
      const a = model.assets[i], group = model.classes[a.group];
      const classValue = group.current + groups[a.group];
      const difference = a.current + values[i] * a.cost - classValue * a.share;
      if (values[i] > 0) hard += Math.max(0, difference - a.tolerance);
      if (classValue > 0) {
        const error = Math.max(0, Math.abs(difference) - a.tolerance);
        notes += group.target * (error / classValue) ** 2;
      }
    }
    return { values, spent, groups, hard, macro, notes };
  };
  const better = (a: State, b: State) => {
    const overA = Math.max(0, a.spent - model.budget), overB = Math.max(0, b.spent - model.budget);
    if (overA !== overB) return overA < overB;
    if (Math.abs(a.hard - b.hard) > 1e-5) return a.hard < b.hard;
    if (Math.abs(a.macro - b.macro) > 1e-15) return a.macro < b.macro;
    if (Math.abs(a.notes - b.notes) > 1e-15) return a.notes < b.notes;
    return a.spent > b.spent;
  };
  const valid = (s: State) => s.spent <= model.budget && s.hard < 1e-5;
  let current = evaluate(model.assets.map((a) => Math.min(a.upper, Math.max(0, Math.round(a.initial)))));
  let best = evaluate(Array(n).fill(0));
  const considerBest = (s: State) => { if (valid(s) && better(s, best)) best = s; };
  considerBest(current);
  // Round complete baskets together. Fractional positions reserve cents, so
  // largest remainders must be assigned jointly rather than growing one asset
  // until its score cap blocks the rest of the class.
  const roundBasket = (raw: number[]) => {
    const values = raw.map((value, i) => Math.min(model.assets[i].upper, Math.max(0, Math.floor(value))));
    let used = values.reduce((s, value, i) => s + value * model.assets[i].cost, 0);
    const order = raw.map((value, i) => ({ i, fraction: value - Math.floor(value) }))
      .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
    for (const { i, fraction } of order) {
      if (fraction > 1e-9 && values[i] < model.assets[i].upper && used + model.assets[i].cost <= model.budget) {
        values[i]++; used += model.assets[i].cost;
      }
    }
    return evaluate(values);
  };
  const initial = model.assets.map((a) => a.initial);
  const floorSeed = evaluate(initial.map((value, i) => Math.min(model.assets[i].upper, Math.max(0, Math.floor(value)))));
  const basketSeed = roundBasket(initial);
  considerBest(floorSeed); considerBest(basketSeed);
  if (better(basketSeed, current)) current = basketSeed;
  if (better(floorSeed, current)) current = floorSeed;
  // Give the fallback real purchase candidates even if the refinement deadline
  // expires before the rounded seed can be repaired or restarted.
  for (let i = 0; i < n; i++) {
    if (!model.assets[i].upper) continue;
    const values = Array(n).fill(0); values[i] = 1;
    considerBest(evaluate(values));
  }

  // Nearest-lot rounding may exceed the budget internally. Repair proposed
  // quantities before exposing a result; existing holdings are never sold.
  for (let pass = 0; current.spent > model.budget && pass < n; pass++) {
    let next: State | undefined;
    for (let i = 0; i < n; i++) {
      if (!current.values[i]) continue;
      const values = [...current.values];
      values[i] -= Math.min(values[i], Math.ceil((current.spent - model.budget) / model.assets[i].cost));
      const candidate = evaluate(values);
      if (!next || better(candidate, next)) next = candidate;
    }
    if (!next) break;
    current = next; considerBest(current);
  }

  let iterations = 0;
  let restarted = false;
  const limit = Math.min(256, Math.max(64, n * 4));
  for (; iterations < limit && Date.now() < deadline; iterations++) {
    if (!restarted && current !== best && iterations >= limit / 2) {
      current = best; restarted = true;
    }
    let next = current;
    const remaining = model.budget - current.spent;
    const tryMove = (i: number, delta: number, j = -1, otherDelta = 0) => {
      if (!Number.isSafeInteger(delta) || !delta || current.values[i] + delta < 0 || current.values[i] + delta > model.assets[i].upper) return;
      if (j >= 0 && (current.values[j] + otherDelta < 0 || current.values[j] + otherDelta > model.assets[j].upper)) return;
      const spent = current.spent + delta * model.assets[i].cost + (j < 0 ? 0 : otherDelta * model.assets[j].cost);
      if (spent < 0 || spent > model.budget) return;
      const values = [...current.values]; values[i] += delta;
      if (j >= 0) values[j] += otherDelta;
      const candidate = evaluate(values);
      if (better(candidate, next)) next = candidate;
    };
    const tryClassBasket = (group: number, addition: number) => {
      if (!(addition > 0)) return;
      const indices = model.assets.flatMap((a, i) => a.group === group && a.upper > 0 && a.share > 0 ? [i] : []);
      if (!indices.length) return;
      let available = current.groups[group] + addition + indices.reduce((s, i) => s + model.assets[i].current, 0);
      let active = [...indices];
      let scale = 0;
      for (let pass = 0; pass <= indices.length; pass++) {
        const weight = active.reduce((s, i) => s + model.assets[i].share, 0);
        if (!(weight > 0)) return;
        scale = available / weight;
        const fixed = active.filter((i) => model.assets[i].current > scale * model.assets[i].share);
        if (!fixed.length) break;
        available -= fixed.reduce((s, i) => s + model.assets[i].current, 0);
        active = active.filter((i) => !fixed.includes(i));
      }
      const raw = [...current.values];
      for (const i of indices) {
        const a = model.assets[i];
        raw[i] = Math.min(a.upper, Math.max(0, (scale * a.share - a.current) / a.cost));
      }
      const candidate = roundBasket(raw);
      if (better(candidate, next)) next = candidate;
    };
    for (let group = 0; group < m; group++) {
      const c = model.classes[group], value = c.current + current.groups[group];
      const room = c.target < 1 ? ((total + current.spent) * c.target + c.tolerance - value) / (1 - c.target) : remaining;
      tryClassBasket(group, Math.min(remaining, Math.max(0, room)));
    }
    const addRank: { i: number; deficit: number }[] = [], removeRank: { i: number; excess: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = model.assets[i], c = model.classes[a.group];
      const classValue = c.current + current.groups[a.group];
      const own = a.current + current.values[i] * a.cost;
      const deficit = classValue * a.share - own;
      if (a.upper > current.values[i]) {
        const affordable = Math.min(a.upper - current.values[i], Math.floor(remaining / a.cost));
        const classRoom = c.target < 1 ? ((total + current.spent) * c.target + c.tolerance - classValue) / (1 - c.target) : remaining;
        const scoreRoom = a.share < 1 ? (classValue * a.share + a.tolerance - own) / (1 - a.share) : remaining;
        const cap = Math.min(affordable, Math.max(0, Math.floor(Math.min(classRoom, scoreRoom) / a.cost)));
        tryMove(i, 1);
        tryMove(i, cap);
        if (deficit > 0) tryMove(i, Math.min(affordable, Math.max(1, Math.round(deficit / a.cost))));
        addRank.push({ i, deficit: Math.max(0, (total + current.spent) * c.target - classValue) / Math.max(1, total + current.spent)
          + Math.max(0, deficit) / Math.max(1, classValue) });
      }
      if (current.values[i]) {
        tryMove(i, -1);
        tryMove(i, -current.values[i]);
        if (a.share < 1 && own > classValue * a.share + a.tolerance) {
          tryMove(i, -Math.min(current.values[i], Math.ceil((own - classValue * a.share - a.tolerance) / ((1 - a.share) * a.cost))));
        }
        if (c.target < 1 && classValue > (total + current.spent) * c.target + c.tolerance) {
          tryMove(i, -Math.min(current.values[i], Math.ceil((classValue - (total + current.spent) * c.target - c.tolerance) / ((1 - c.target) * a.cost))));
        }
        removeRank.push({ i, excess: (own - classValue * a.share) / Math.max(1, classValue) });
      }
    }
    // A larger lot can require releasing several proposed cheap units. Include
    // replacements so the algorithm does not get stuck only adding purchases.
    const additions = addRank.sort((a, b) => b.deficit - a.deficit || a.i - b.i).slice(0, 12);
    const removals = removeRank.sort((a, b) => b.excess - a.excess || model.assets[a.i].cost - model.assets[b.i].cost || a.i - b.i).slice(0, 12);
    // Two underweight positions may need to grow together: either purchase
    // alone can worsen their proportions even though the pair is balanced.
    for (const { i } of additions) for (const { i: j } of additions) {
      if (i === j || model.assets[i].cost + model.assets[j].cost > remaining) continue;
      tryMove(i, 1, j, 1);
      const a = model.assets[j], c = model.classes[a.group];
      const value = c.current + current.groups[a.group];
      const wanted = a.group === model.assets[i].group
        ? a.share < 1 ? (a.share * (value + model.assets[i].cost) - a.current - current.values[j] * a.cost) / (1 - a.share) : 0
        : c.target < 1 ? (c.target * (total + current.spent + model.assets[i].cost) - value) / (1 - c.target) : 0;
      const cap = Math.min(a.upper - current.values[j], Math.floor((remaining - model.assets[i].cost) / a.cost));
      for (const quantity of [Math.floor(wanted / a.cost), Math.ceil(wanted / a.cost)]) {
        if (quantity > 0) tryMove(i, 1, j, Math.min(cap, quantity));
      }
    }
    for (const { i } of additions) for (const { i: j } of removals) {
      if (i === j) continue;
      const release = Math.max(1, Math.ceil((model.assets[i].cost - remaining) / model.assets[j].cost));
      if (release <= current.values[j]) tryMove(i, 1, j, -release);
      const add = Math.min(model.assets[i].upper - current.values[i], Math.floor((remaining + model.assets[j].cost) / model.assets[i].cost));
      if (add > 0) tryMove(i, add, j, -1);
    }
    if (next === current) {
      if (!restarted && current !== best) { current = best; restarted = true; continue; }
      return { values: best.values, iterations, evaluations, stopReason: "stable" };
    }
    current = next; considerBest(current);
  }
  return { values: best.values, iterations, evaluations, stopReason: iterations >= limit ? "iteration_limit" : "time_limit" };
}
