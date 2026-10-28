import { allocateCerrado } from "./calculation/cerrado";
import { allocateImproved } from "./calculation/improved";
import type { AllocationInput, AllocationMethod } from "./calculation/types";
export type { AllocationInput, AllocationAsset, AllocationSuggestion, AllocationResult } from "./calculation/types";

export function questionChangeAffectsAllocation(currentActive: boolean, change: { active?: boolean }) {
  return change.active !== undefined && change.active !== currentActive;
}

export function allocateContribution(input: AllocationInput, algorithm: AllocationMethod = "IMPROVED") {
  return algorithm === "CERRADO" ? allocateCerrado(input) : allocateImproved(input);
}
