import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOwnedItem: vi.fn(),
  findItems: vi.fn(),
  getItem: vi.fn(),
  getAccounts: vi.fn(),
  getInvestments: vi.fn(),
  requireCredentials: vi.fn(),
  markDisconnected: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pluggyItem: {
      findFirst: mocks.findOwnedItem,
      findMany: mocks.findItems,
    },
  },
}));

vi.mock("@/lib/operation-security", () => ({
  withUserOperationLease: vi.fn(async ({
    action,
  }: {
    action: (lease: {
      signal: AbortSignal;
      runFencedTransaction: <T>(operation: (tx: unknown) => Promise<T>) => Promise<T>;
    }) => Promise<unknown>;
  }) => action({
    signal: new AbortController().signal,
    runFencedTransaction: async (operation) => operation({}),
  })),
}));

vi.mock("@/features/open-finance/pluggy", () => ({
  getPluggyItem: mocks.getItem,
  getPluggyAccounts: mocks.getAccounts,
  getPluggyInvestments: mocks.getInvestments,
  getPluggyTransactions: vi.fn(),
  getPluggyInvestmentTransactions: vi.fn(),
}));

vi.mock("@/features/open-finance/pluggy-credentials", () => ({
  requirePluggyCredentials: mocks.requireCredentials,
}));

vi.mock("@/features/open-finance/disconnection", () => ({
  markPluggyItemDisconnected: mocks.markDisconnected,
}));

vi.mock("@/features/open-finance/diagram-sync", () => ({
  reconcilePluggyInvestmentsForUser: vi.fn(),
}));

vi.mock("@/features/finance/classification-service", () => ({
  classifyFinanceTransactionsForUser: vi.fn(),
}));

import { syncPluggyItemForUser, syncAllPluggyItemsForUser, syncSelectedPluggyItemsForUser } from "@/features/open-finance/sync";

describe("sincronização de item Pluggy removido", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findItems.mockResolvedValue([]);
    mocks.findOwnedItem.mockResolvedValue({
      id: "item-db",
      userId: "user-a",
      pluggyItemId: "11111111-1111-4111-8111-111111111111",
      status: "UPDATED",
    });
    mocks.requireCredentials.mockResolvedValue({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    mocks.getItem.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      clientUserId: "user-a",
      status: "DELETED",
      connector: { id: 1, name: "Banco" },
    });
    mocks.markDisconnected.mockResolvedValue({ userId: "user-a", itemId: "item-db" });
  });

  it("aciona o workflow de desconexão antes de ler snapshots financeiros", async () => {
    const result = await syncPluggyItemForUser(
      "user-a",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(mocks.markDisconnected).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mocks.getAccounts).not.toHaveBeenCalled();
    expect(mocks.getInvestments).not.toHaveBeenCalled();
    expect(result.diagram.changed).toBe(true);
  });

  it("mantém sync manual de todas as conexões, incluindo a recente sem pendências", async () => {
    mocks.findItems.mockResolvedValue([
      { pluggyItemId: "recent", syncPending: false, lastSyncAt: new Date() },
      { pluggyItemId: "pending", syncPending: true, lastSyncAt: new Date() },
    ]);
    const result = await syncAllPluggyItemsForUser("user-a");
    expect(mocks.findItems).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-a", status: { not: "DELETED" } },
    }));
    expect(mocks.getItem.mock.calls.map((call) => call[1])).toEqual(["recent", "pending"]);
    expect(result).toMatchObject({ itemCount: 2, succeededItemCount: 2, failedItemCount: 0 });
  });

  it("reconsulta posse/status, deduplica IDs e reavalia validade na seleção automática", async () => {
    mocks.findItems.mockResolvedValue([
      { pluggyItemId: "recent", syncPending: false, lastSyncAt: new Date() },
      { pluggyItemId: "pending", syncPending: true, lastSyncAt: new Date() },
      { pluggyItemId: "stale", syncPending: false, lastSyncAt: null },
    ]);
    const result = await syncSelectedPluggyItemsForUser("user-a", ["recent", "pending", "stale", "pending", "foreign"], { automatic: true });
    expect(mocks.findItems).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "user-a", status: { not: "DELETED" },
        pluggyItemId: { in: ["recent", "pending", "stale", "foreign"] },
      },
    }));
    expect(mocks.getItem.mock.calls.map((call) => call[1])).toEqual(["pending", "stale"]);
    expect(result).toMatchObject({ itemCount: 2, pendingItemCount: 1, succeededItemCount: 2 });
  });

  it("não amplia uma seleção vazia para todas as conexões", async () => {
    const result = await syncSelectedPluggyItemsForUser("user-a", [], { automatic: true });
    expect(mocks.findItems).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ pluggyItemId: { in: [] } }),
    }));
    expect(result.itemCount).toBe(0);
    expect(mocks.getItem).not.toHaveBeenCalled();
  });

  it("continua a sequência depois de falha em um item e conta somente a seleção", async () => {
    mocks.findItems.mockResolvedValue([
      { pluggyItemId: "failed", syncPending: true, lastSyncAt: null },
      { pluggyItemId: "ok", syncPending: false, lastSyncAt: null },
    ]);
    mocks.findOwnedItem.mockRejectedValueOnce(new Error("Conexão não encontrada"));
    const result = await syncSelectedPluggyItemsForUser("user-a", ["failed", "ok"], { automatic: true });
    expect(result).toMatchObject({
      itemCount: 2, succeededItemCount: 1, failedItemCount: 1,
      failures: [{ itemId: "failed", message: "Conexão não encontrada" }],
    });
    expect(mocks.getItem).toHaveBeenCalledTimes(1);
    expect(mocks.getItem.mock.calls[0][1]).toBe("ok");
  });

});
