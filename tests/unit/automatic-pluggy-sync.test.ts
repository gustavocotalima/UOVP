import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ items: vi.fn(), selected: vi.fn(), lease: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { pluggyItem: { findMany: mocks.items } } }));
vi.mock("@/features/open-finance/sync", () => ({ syncSelectedPluggyItemsForUser: mocks.selected }));
vi.mock("@/lib/operation-security", () => ({
  OperationInProgressError: class extends Error {},
  withUserOperationLease: mocks.lease,
}));
import { syncStalePluggyItemsForUser } from "@/features/open-finance/automatic-sync";

const now = new Date("2026-10-20T15:00:00Z");
const summary = {
  itemCount: 2, pendingItemCount: 1, succeededItemCount: 2,
  failedItemCount: 0, partialItemCount: 0,
};

describe("sincronização automática seletiva Pluggy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.items.mockResolvedValue([
      { pluggyItemId: "recent", syncPending: false, lastSyncAt: now },
      { pluggyItemId: "pending", syncPending: true, lastSyncAt: now },
      { pluggyItemId: "stale", syncPending: false, lastSyncAt: new Date("2026-10-19T15:00:00Z") },
    ]);
    mocks.selected.mockResolvedValue(summary);
    mocks.lease.mockImplementation(({ action }: { action: () => Promise<unknown> }) => action());
  });

  afterEach(() => vi.useRealTimers());

  it("envia somente pendentes e vencidos e prioriza o motivo WEBHOOK_PENDING", async () => {
    const result = await syncStalePluggyItemsForUser("user-a");
    expect(mocks.items).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-a", status: { not: "DELETED" } },
    }));
    expect(mocks.selected).toHaveBeenCalledWith("user-a", ["pending", "stale"], { automatic: true });
    expect(result).toMatchObject({ status: "UPDATED", reason: "WEBHOOK_PENDING", requestedConnections: 2, updatedConnections: 2 });
  });

  it("não adquire lease nem chama o provedor quando todos os itens estão recentes", async () => {
    mocks.items.mockResolvedValue([{ pluggyItemId: "recent", syncPending: false, lastSyncAt: now }]);
    expect(await syncStalePluggyItemsForUser("user-a")).toMatchObject({ status: "SKIPPED", requestedConnections: 0, reason: null });
    expect(mocks.lease).not.toHaveBeenCalled();
    expect(mocks.selected).not.toHaveBeenCalled();
  });

  it("conta somente selecionados e mantém falhas e snapshots parciais", async () => {
    mocks.selected.mockResolvedValueOnce({ ...summary, succeededItemCount: 1, failedItemCount: 1 });
    expect(await syncStalePluggyItemsForUser("user-a")).toMatchObject({
      status: "PARTIAL", changed: true, requestedConnections: 2, updatedConnections: 1, failedConnections: 1,
    });
    mocks.selected.mockResolvedValueOnce({ ...summary, partialItemCount: 1 });
    expect(await syncStalePluggyItemsForUser("user-a")).toMatchObject({ status: "PARTIAL", failedConnections: 0 });
    mocks.selected.mockResolvedValueOnce({ ...summary, succeededItemCount: 0, failedItemCount: 2 });
    expect(await syncStalePluggyItemsForUser("user-a")).toMatchObject({ status: "FAILED", changed: false, failedConnections: 2 });
  });

  it("reavalia o motivo e os contadores depois da seleção autenticada final", async () => {
    mocks.selected.mockResolvedValueOnce({ ...summary, itemCount: 1, pendingItemCount: 0, succeededItemCount: 1 });
    expect(await syncStalePluggyItemsForUser("user-a")).toMatchObject({ reason: "AUTOMATIC_STALE", requestedConnections: 1 });
    mocks.selected.mockResolvedValueOnce({ ...summary, itemCount: 0, pendingItemCount: 0, succeededItemCount: 0 });
    expect(await syncStalePluggyItemsForUser("user-a")).toMatchObject({ status: "SKIPPED", changed: false, reason: null, requestedConnections: 0 });
  });
});
