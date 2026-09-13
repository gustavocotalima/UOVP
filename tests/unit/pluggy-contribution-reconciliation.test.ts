import { describe, expect, it } from "vitest";
import { canReconcileChangedProviderSnapshot } from "@/features/open-finance/contribution-reconciliation";

const requestedAt = new Date("2026-09-11T17:36:05.763Z");
const providerUpdatedAt = new Date("2026-09-13T12:00:00.000Z");
const viva3 = {
  requestedAt,
  providerUpdatedAt,
  currentQuantity: "92",
  baselineQuantity: "103",
};

describe("canReconcileChangedProviderSnapshot", () => {
  it("reconciles VIVA3 after a newer provider snapshot changes its quantity", () => {
    expect(canReconcileChangedProviderSnapshot(viva3)).toBe(true);
  });

  it("keeps waiting while the synchronized quantity remains unchanged", () => {
    expect(canReconcileChangedProviderSnapshot({ ...viva3, currentQuantity: "103" })).toBe(false);
  });

  it.each([
    { providerUpdatedAt: new Date("2026-09-10T12:00:00.000Z") },
    { providerUpdatedAt: null },
    { baselineQuantity: null },
  ])("does not reconcile without proof of a newer comparable snapshot (%o)", (override) => {
    expect(canReconcileChangedProviderSnapshot({ ...viva3, ...override })).toBe(false);
  });
});
