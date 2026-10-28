import { describe, expect, it, vi } from "vitest";
import { AllocationAdmission, AllocationLimitError, isAllocationLimitError } from "@/features/portfolio/calculation/admission";
import { calculateContribution } from "@/features/portfolio/calculation/server";
import { DEFAULT_TARGETS } from "@/features/portfolio/constants";

describe("allocation worker admission", () => {
  it("recognizes admission errors from another server entry's module instance", async () => {
    vi.resetModules();
    const reloaded = await import("@/features/portfolio/calculation/admission");
    const error = new reloaded.AllocationLimitError("ALLOCATION_BUSY", 1000);
    expect(error).not.toBeInstanceOf(AllocationLimitError);
    expect(isAllocationLimitError(error)).toBe(true);
    expect(isAllocationLimitError(new Error("unrelated"))).toBe(false);
  });
  it("rejects a concurrent burst before entering the shared pool while admitting other accounts", async () => {
    const admission = new AllocationAdmission();
    let release!: () => void, calls = 0;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = admission.run("attacker", async () => { calls++; await held; return "first"; });
    const burst = await Promise.allSettled(Array.from({ length: 17 }, () => admission.run("attacker", async () => { calls++; })));
    expect(calls).toBe(1);
    expect(burst.every((r) => r.status === "rejected" && r.reason instanceof AllocationLimitError && r.reason.code === "ALLOCATION_BUSY")).toBe(true);
    await expect(admission.run("other-account", async () => "other")).resolves.toBe("other");
    release(); await expect(first).resolves.toBe("first");
    await expect(admission.run("attacker", async () => "released")).resolves.toBe("released");
  });
  it("enforces a sliding six-per-minute window independently for each account", async () => {
    let now = 100000;
    const admission = new AllocationAdmission(() => now);
    for (let i = 0; i < 6; i++) { await admission.run("account", async () => i); now += 1000; }
    await expect(admission.run("account", async () => 7)).rejects.toMatchObject({ code: "ALLOCATION_RATE_LIMIT", status: 429, retryAfterMs: 54000 });
    await expect(admission.run("different", async () => true)).resolves.toBe(true);
    now = 160000;
    await expect(admission.run("account", async () => "expired")).resolves.toBe("expired");
  });
  it("releases concurrency after exceptions without bypassing the rate window", async () => {
    const admission = new AllocationAdmission();
    await expect(admission.run("account", async () => { throw new Error("failure"); })).rejects.toThrow("failure");
    await expect(admission.run("account", async () => "retry")).resolves.toBe("retry");
    await expect(admission.run("", async () => true)).rejects.toThrow("autenticada");
  });
  it("applies the authenticated-account gate to the real calculation service", async () => {
    const input = { contribution: 100, targets: Object.fromEntries(Object.keys(DEFAULT_TARGETS).map((k) => [k, k === "BRAZILIAN_STOCKS" ? 100 : 0])) as typeof DEFAULT_TARGETS,
      assets: [{ id: "s", ticker: "SYNTH", name: "Synthetic", investmentClass: "BRAZILIAN_STOCKS" as const, currentValue: 0, quantity: 0, unitPrice: 1, score: 1, fractional: false }] };
    const user = `burst-${Date.now()}`;
    const attempts = Array.from({ length: 18 }, () => calculateContribution(input, "IMPROVED", user));
    const other = calculateContribution(input, "IMPROVED", `${user}-other`);
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason.code === "ALLOCATION_BUSY")).toHaveLength(17);
    expect((await other).unallocatedAmount.toString()).toBe("0");
  });
});
