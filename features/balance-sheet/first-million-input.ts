import { parseNumericDraft } from "@/lib/numeric-draft";
import { effectiveMonthlyRate, firstMillionMatrix } from "@/features/portfolio/calculations";

export type FirstMillionInputs = { annualRate: number; initialValue: number; desiredValue: number };
export type FirstMillionDrafts = { [Key in keyof FirstMillionInputs]: string };
export type FirstMillionResult = {
  inputs: FirstMillionInputs;
  monthlyRate: number;
  matrix: Array<{ contribution: number; values: Array<{ years: number; value: number }> }>;
};

export const INITIAL_FIRST_MILLION_INPUTS: FirstMillionInputs = {
  annualRate: 8, initialValue: 10_000, desiredValue: 1_000_000,
};

export function parseFirstMillionDrafts(drafts: FirstMillionDrafts): FirstMillionInputs | null {
  const annualRate = parseNumericDraft(drafts.annualRate, { min: 0, max: 100 });
  const initialValue = parseNumericDraft(drafts.initialValue, { min: 0, max: Number.MAX_VALUE });
  const desiredValue = parseNumericDraft(drafts.desiredValue, { min: 0, max: Number.MAX_VALUE });
  return annualRate === null || initialValue === null || desiredValue === null
    ? null : { annualRate, initialValue, desiredValue };
}

/** Preserve the existing Decimal formulas; reject unrepresentable chart output. */
export function calculateFirstMillionResult(inputs: FirstMillionInputs): FirstMillionResult | null {
  if (![inputs.annualRate, inputs.initialValue, inputs.desiredValue].every(Number.isFinite)
    || inputs.annualRate < 0 || inputs.annualRate > 100 || inputs.initialValue < 0 || inputs.desiredValue < 0) return null;
  const matrix = firstMillionMatrix(inputs.initialValue, inputs.annualRate).map((row) => ({
    contribution: row.monthlyContribution,
    values: row.values.map((value) => ({ years: value.years, value: value.value.toNumber() })),
  }));
  if (matrix.some((row) => row.values.some((value) => !Number.isFinite(value.value)))) return null;
  return {
    inputs,
    monthlyRate: effectiveMonthlyRate(inputs.annualRate).times(100).toDecimalPlaces(2).toNumber(),
    matrix,
  };
}
