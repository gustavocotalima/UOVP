import { describe, expect, it } from "vitest";
import { createSnapshotRequests } from "@/features/open-finance/snapshot-requests";

describe("requisições de detalhes por snapshot Open Finance", () => {
  it("deduplica chamadas simultâneas por investimento, permitindo outros investimentos", () => {
    const requests = createSnapshotRequests("snapshot-a");
    const first = requests.start("investment-a", "snapshot-a")!;
    expect(requests.start("investment-a", "snapshot-a")).toBeNull();
    expect(requests.start("investment-b", "snapshot-a")).not.toBeNull();
    expect(requests.isCurrent("investment-a", first)).toBe(true);
    expect(requests.finish("investment-a", first)).toBe(true);
    expect(requests.start("investment-a", "snapshot-a")).not.toBeNull();
  });

  it("cancela as requisições anteriores e ignora callbacks com revisão antiga", () => {
    const requests = createSnapshotRequests("snapshot-a");
    const old = requests.start("investment-a", "snapshot-a")!;
    expect(requests.reset("snapshot-b")).toBe(true);
    expect(old.signal.aborted).toBe(true);
    expect(requests.isCurrent("investment-a", old)).toBe(false);
    expect(requests.start("investment-a", "snapshot-a")).toBeNull();
    const current = requests.start("investment-a", "snapshot-b")!;
    // A late finally from the old fetch must not release the new fetch's lock.
    expect(requests.finish("investment-a", old)).toBe(false);
    expect(requests.isCurrent("investment-a", current)).toBe(true);
    expect(requests.start("investment-a", "snapshot-b")).toBeNull();
  });

  it("mantém requisições válidas quando a revisão não muda", () => {
    const requests = createSnapshotRequests("snapshot-a");
    const current = requests.start("investment-a", "snapshot-a")!;
    expect(requests.reset("snapshot-a")).toBe(false);
    expect(current.signal.aborted).toBe(false);
    expect(requests.isCurrent("investment-a", current)).toBe(true);
  });

  it("cancela todas as requisições ao desmontar", () => {
    const requests = createSnapshotRequests("snapshot-a");
    const first = requests.start("investment-a", "snapshot-a")!;
    const second = requests.start("investment-b", "snapshot-a")!;
    requests.clear();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(requests.finish("investment-a", first)).toBe(false);
  });
});
