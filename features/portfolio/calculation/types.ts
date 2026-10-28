import Decimal from "decimal.js";
import type { InvestmentClassKey } from "../constants";

export const ALLOCATION_METHODS = ["IMPROVED", "CERRADO"] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];
export const ALLOCATION_LABELS: Record<AllocationMethod, string> = {
  IMPROVED: "Melhorado", CERRADO: "Diagrama do Cerrado",
};
export const ALLOCATION_VERSIONS = { IMPROVED: "2", CERRADO: "1" } as const;
export const Money = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export type AllocationAsset = {
  id: string; ticker: string; name: string; investmentClass: InvestmentClassKey;
  currentValue: Decimal.Value; quantity: Decimal.Value; unitPrice: Decimal.Value;
  score: number; fractional: boolean; eligibleToReceive?: boolean;
  quantityStep?: Decimal.Value; sourceOrder?: string;
  instrumentType?: string;
};
export type AllocationInput = {
  contribution: Decimal.Value;
  targets: Record<InvestmentClassKey, Decimal.Value>;
  assets: AllocationAsset[];
  capEligibleClassesAtTarget?: boolean;
};
export type AllocationSuggestion = {
  assetId: string; ticker: string; name: string; investmentClass: InvestmentClassKey;
  quantity: Decimal; value: Decimal; suggestionPercentage: Decimal;
  totalAfterSuggestionPercentage: Decimal;
};
export type CalculationStage = { name: string; optimal: boolean; nodes: number };
export type CalculationDiagnostics = {
  algorithm: AllocationMethod; version: string;
  stages: CalculationStage[]; warnings: string[];
  classTolerancesBrl: Partial<Record<InvestmentClassKey, string>>;
  reservedAmount: string;
  heuristic?: { priorities: string[]; iterations: number; evaluations: number; stopReason: "stable" | "iteration_limit" | "time_limit" };
};
export type AllocationResult = {
  suggestions: AllocationSuggestion[]; unallocatedAmount: Decimal;
  calculation: CalculationDiagnostics;
};
export const sum = (values: Decimal.Value[]) => values.reduce<Decimal>((a, b) => a.plus(b), new Money(0));

export function validateInput(input: AllocationInput) {
  const budget = new Money(input.contribution);
  if (!budget.isFinite() || budget.lt(0) || budget.gt("1000000000000")) throw new Error("Valor de aporte inválido.");
  const targets = Object.values(input.targets).map((x) => new Money(x));
  if (targets.some((x) => !x.isFinite() || x.lt(0) || x.gt(100)) || !sum(targets).eq(100)) {
    throw new Error("As metas precisam totalizar 100%.");
  }
  const ids = new Set<string>();
  for (const a of input.assets) {
    if (ids.has(a.id)) throw new Error("Ativo duplicado no cálculo.");
    ids.add(a.id);
    for (const v of [a.currentValue, a.unitPrice]) {
      if (!new Money(v).isFinite() || new Money(v).lt(0)) throw new Error("Carteira com avaliação inválida.");
    }
    if (!(a.investmentClass in input.targets) || !Number.isSafeInteger(a.score)) throw new Error("Ativo inválido.");
    const step = new Money(a.quantityStep ?? (a.fractional ? "0.0000000001" : 1));
    if (!step.isFinite() || step.lte(0) || step.decimalPlaces() > 10 || (!a.fractional && !step.eq(1))) throw new Error("Passo de quantidade inválido.");
  }
}

export function finish(input: AllocationInput, values: Map<string, { quantity: Decimal; value: Decimal }>, calculation: CalculationDiagnostics): AllocationResult {
  // A finite-precision proportional pass can sum to budget + 1e-38. Normalize
  // each output DOWN to the database grid before summing with higher precision;
  // never add budget slack or round a quantity up to hide that discrepancy.
  const assets = new Map(input.assets.map((a) => [a.id, a]));
  values = new Map([...values].map(([id, original]) => {
    const asset = assets.get(id);
    if (!asset) throw new Error("Ativo desconhecido na sugestão.");
    const quantity = new Money(original.quantity).toDecimalPlaces(10, Decimal.ROUND_DOWN);
    const value = Money.min(original.value, quantity.mul(asset.unitPrice)).toDecimalPlaces(10, Decimal.ROUND_DOWN);
    return [id, { quantity, value }];
  }));
  const budget = new Money(input.contribution);
  const spent = sum([...values.values()].map((v) => v.value));
  const final = sum(input.assets.map((a) => a.currentValue)).plus(spent);
  if (spent.gt(budget) || spent.lt(0)) throw new Error("O cálculo excedeu o orçamento.");
  const suggestions = input.assets.flatMap((a) => {
    const v = values.get(a.id);
    if (!v || v.value.lte(0)) return [];
    if (a.eligibleToReceive === false || a.score <= 0 || new Money(input.targets[a.investmentClass]).lte(0)
      || v.quantity.lte(0) || (!a.fractional && !v.quantity.isInteger())) throw new Error("Sugestão inelegível.");
    return [{ assetId: a.id, ticker: a.ticker, name: a.name, investmentClass: a.investmentClass,
      quantity: v.quantity, value: v.value, suggestionPercentage: budget.gt(0) ? v.value.div(budget).mul(100) : new Money(0),
      totalAfterSuggestionPercentage: final.gt(0) ? new Money(a.currentValue).plus(v.value).div(final).mul(100) : new Money(0) }];
  });
  return { suggestions, unallocatedAmount: budget.minus(spent), calculation };
}
