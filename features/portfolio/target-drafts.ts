import { parseNumericDraft } from "@/lib/numeric-draft";
import { INVESTMENT_CLASSES, type InvestmentClassKey } from "./constants";

type TargetDrafts = Record<InvestmentClassKey, string>;

/** Exact hundredths match InvestmentTarget.percentage DECIMAL(5, 2). */
export function targetPercentageCents(value: Decimal.Value): number | null {
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() && decimal.gte(0) && decimal.lte(100) && decimal.decimalPlaces() <= 2
      ? decimal.mul(100).toNumber() : null;
  } catch {
    return null;
  }
}

export function investmentTargetsTotalCents(values: Record<InvestmentClassKey, number>): number | null {
  let total = 0;
  for (const key of INVESTMENT_CLASSES) {
    const cents = targetPercentageCents(values[key]);
    if (cents === null) return null;
    total += cents;
  }
  return total;
}

export function parseTargetDraft(draft: string): number | null {
  const value = parseNumericDraft(draft, { min: 0, max: 100 });
  // Check the original text before Number can round sub-cent input away.
  return value !== null && targetPercentageCents(draft.trim()) !== null ? value : null;
}

export function toTargetDrafts(values: Record<InvestmentClassKey, number>): TargetDrafts {
  return Object.fromEntries(INVESTMENT_CLASSES.map((key) => [key, String(values[key])])) as TargetDrafts;
}

export function parseTargetDrafts(drafts: TargetDrafts): Record<InvestmentClassKey, number> | null {
  const entries = INVESTMENT_CLASSES.map((key) => [key, parseTargetDraft(drafts[key])] as const);
  return entries.some(([, value]) => value === null)
    ? null : Object.fromEntries(entries) as Record<InvestmentClassKey, number>;
}
import Decimal from "decimal.js";
