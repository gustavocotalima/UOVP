export type IntegerModel = {
  objective: number[]; rows: number[][]; bounds: number[]; integer: number[];
  seed: number[]; timeLimitMs: number; nodeLimit?: number;
  binary?: number[];
  weights?: number[];
};
export type IntegerSolution = { values: number[]; objective: number; optimal: boolean; nodes: number };

/** Original two-phase simplex / branch-and-bound implementation.
 * Only numeric models enter this function. It is self-contained so Node's native
 * worker can execute the exact same implementation without bundling a service.
 * Objective is MAXIMIZED; rows are Ax <= b and every variable is nonnegative.
 */
export function searchIntegers(model: IntegerModel): IntegerSolution {
  const deadline = Date.now() + model.timeLimitMs;
  const EPS = 1e-8;
  const n = model.objective.length;
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  const feasible = (x: number[]) => x.length === n && x.every((v) => Number.isFinite(v) && v >= -1e-7)
    && model.integer.every((i) => Math.abs(x[i] - Math.round(x[i])) < 1e-7)
    && model.rows.every((row, i) => dot(row, x) <= model.bounds[i] + 0.00002);

  function relaxation(extra: Array<[number, number, boolean]>): { x: number[]; value: number } | null {
    const rows = model.rows.map((r) => [...r]);
    const rhs = [...model.bounds];
    for (const [index, limit, upper] of extra) {
      const row = Array(n).fill(0); row[index] = upper ? 1 : -1;
      rows.push(row); rhs.push(upper ? limit : -limit);
    }
    const m = rows.length;
    const basic = Array.from({ length: m }, (_, i) => n + i);
    const nonbasic = Array.from({ length: n + 1 }, (_, i) => i === n ? -1 : i);
    const tab = Array.from({ length: m + 2 }, () => Array(n + 2).fill(0));
    for (let i = 0; i < m; i++) {
      // Scaling constraints does not alter their feasible region.
      const scale = Math.max(1, ...rows[i].map(Math.abs));
      for (let j = 0; j < n; j++) tab[i][j] = rows[i][j] / scale;
      tab[i][n] = -1; tab[i][n + 1] = rhs[i] / scale;
    }
    for (let j = 0; j < n; j++) tab[m][j] = -model.objective[j];
    tab[m + 1][n] = 1;
    function pivot(r: number, s: number) {
      const inv = 1 / tab[r][s];
      for (let i = 0; i < m + 2; i++) if (i !== r) {
        const factor = tab[i][s] * inv;
        if (!factor) continue;
        for (let j = 0; j < n + 2; j++) if (j !== s) tab[i][j] -= tab[r][j] * factor;
      }
      for (let j = 0; j < n + 2; j++) if (j !== s) tab[r][j] *= inv;
      for (let i = 0; i < m + 2; i++) if (i !== r) tab[i][s] *= -inv;
      tab[r][s] = inv;
      [basic[r], nonbasic[s]] = [nonbasic[s], basic[r]];
    }
    function simplex(phase: 1 | 2) {
      const objectiveRow = phase === 1 ? m + 1 : m;
      for (let iteration = 0; iteration < 20000; iteration++) {
        if ((iteration & 31) === 0 && Date.now() >= deadline) return false;
        let s = -1;
        for (let j = 0; j <= n; j++) {
          if (phase === 2 && nonbasic[j] === -1) continue;
          if (s === -1 || tab[objectiveRow][j] < tab[objectiveRow][s] - EPS
            || (Math.abs(tab[objectiveRow][j] - tab[objectiveRow][s]) <= EPS && nonbasic[j] < nonbasic[s])) s = j;
        }
        if (s === -1 || tab[objectiveRow][s] >= -EPS) return true;
        let r = -1;
        for (let i = 0; i < m; i++) {
          if (tab[i][s] <= EPS) continue;
          const ratio = tab[i][n + 1] / tab[i][s];
          const old = r < 0 ? Infinity : tab[r][n + 1] / tab[r][s];
          if (ratio < old - EPS || (Math.abs(ratio - old) <= EPS && (r < 0 || basic[i] < basic[r]))) r = i;
        }
        if (r < 0) return false;
        pivot(r, s);
      }
      return false;
    }
    let r = 0;
    for (let i = 1; i < m; i++) if (tab[i][n + 1] < tab[r][n + 1]) r = i;
    if (m && tab[r][n + 1] < -EPS) {
      pivot(r, n);
      if (!simplex(1)) { incomplete = true; return null; }
      if (Math.abs(tab[m + 1][n + 1]) > 1e-7) return null;
      const artificial = basic.indexOf(-1);
      if (artificial >= 0) {
        let col = -1;
        for (let j = 0; j <= n; j++) if (Math.abs(tab[artificial][j]) > EPS
          && (col < 0 || nonbasic[j] < nonbasic[col])) col = j;
        if (col >= 0) pivot(artificial, col);
      }
    }
    if (!simplex(2)) { incomplete = true; return null; }
    const x = Array(n).fill(0);
    for (let i = 0; i < m; i++) if (basic[i] >= 0 && basic[i] < n) x[basic[i]] = Math.max(0, tab[i][n + 1]);
    return { x, value: dot(model.objective, x) };
  }

  let best = feasible(model.seed) ? [...model.seed] : Array(n).fill(0);
  let value = feasible(best) ? dot(model.objective, best) : -Infinity;
  const stack: Array<Array<[number, number, boolean]>> = [[]];
  let nodes = 0;
  let incomplete = false;
  while (stack.length && nodes < (model.nodeLimit ?? 10000) && Date.now() < deadline) {
    const path = stack.pop()!;
    nodes++;
    const lp = relaxation(path);
    if (!lp) { if (Date.now() >= deadline) incomplete = true; continue; }
    if (lp.value <= value + 0.000005) continue;
    const rounded = [...lp.x];
    for (const i of model.integer) rounded[i] = (model.binary ?? []).includes(i) ? Math.round(rounded[i]) : Math.floor(rounded[i] + 1e-7);
    if (feasible(rounded)) {
      const score = dot(model.objective, rounded);
      if (score > value + 0.000005) { best = rounded; value = score; }
    }
    let branch = -1, fraction = 0;
    const fractionalBinaries = (model.binary ?? []).filter((i) => Math.abs(lp.x[i] - Math.round(lp.x[i])) > 1e-7);
    for (const i of fractionalBinaries.length ? fractionalBinaries : model.integer) {
      const f = Math.abs(lp.x[i] - Math.round(lp.x[i]));
      const priority = f > 1e-7 ? f * (model.weights?.[i] ?? 1) : 0;
      if (priority > fraction + 1e-7) { branch = i; fraction = priority; }
    }
    if (branch < 0) {
      const candidate = [...lp.x];
      for (const i of model.integer) candidate[i] = Math.round(candidate[i]);
      if (feasible(candidate)) {
        const objective = dot(model.objective, candidate);
        if (objective > value + 0.000005) { best = candidate; value = objective; }
      } else incomplete = true;
      continue;
    }
    const down: [number, number, boolean] = [branch, Math.floor(lp.x[branch]), true];
    const up: [number, number, boolean] = [branch, Math.ceil(lp.x[branch]), false];
    // Visit the closest integer first to obtain an incumbent quickly.
    if (!(model.binary ?? []).includes(branch) && lp.x[branch] - Math.floor(lp.x[branch]) < 0.5) {
      stack.push([...path, up], [...path, down]);
    } else stack.push([...path, down], [...path, up]);
  }
  if (!Number.isFinite(value)) throw new Error("Não foi encontrada uma combinação válida dentro do limite de cálculo.");
  return { values: best, objective: value, optimal: !incomplete && stack.length === 0 && Date.now() < deadline, nodes };
}
