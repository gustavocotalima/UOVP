import Decimal from "decimal.js";

export function canReconcileChangedProviderSnapshot(input: {
  requestedAt: Date;
  providerUpdatedAt: Date | null;
  currentQuantity: string;
  baselineQuantity: string | null;
}) {
  return input.providerUpdatedAt !== null
    && input.providerUpdatedAt.getTime() >= input.requestedAt.getTime()
    && input.baselineQuantity !== null
    && !new Decimal(input.currentQuantity).equals(input.baselineQuantity);
}
