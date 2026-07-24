import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOwnedItem: vi.fn(),
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
    },
  },
}));

vi.mock("@/lib/operation-security", () => ({
  withUserOperationLease: vi.fn(async ({ action }: { action: () => Promise<unknown> }) => action()),
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

import { syncPluggyItemForUser } from "@/features/open-finance/sync";

describe("sincronização de item Pluggy removido", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
