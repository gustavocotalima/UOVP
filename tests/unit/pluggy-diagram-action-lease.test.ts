import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    pluggyInvestmentDiagramLink: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    fixedIncomeFamily: { findUnique: vi.fn() },
    asset: { update: vi.fn() },
    assetHolding: { update: vi.fn() },
  },
  item: { findFirst: vi.fn() },
  lease: vi.fn(), reconcile: vi.fn(), invalidate: vi.fn(), disconnected: vi.fn(),
  credentials: vi.fn(), deleteRemote: vi.fn(), revalidate: vi.fn(),
  inLease: false, inTransaction: false,
}));

vi.mock("@/lib/prisma", () => ({ prisma: { pluggyItem: mocks.item } }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => "user-1" }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/operation-security", () => ({
  assertUserOperationRateLimit: vi.fn(),
  withUserOperationLease: mocks.lease,
  OperationInProgressError: class extends Error {},
}));
vi.mock("@/features/portfolio/invalidation", () => ({ bumpPortfolioAndInvalidateDrafts: mocks.invalidate }));
vi.mock("@/features/open-finance/diagram-sync", () => ({ reconcilePluggyInvestmentsForUser: mocks.reconcile }));
vi.mock("@/features/open-finance/disconnection", () => ({
  markPluggyItemDisconnected: mocks.disconnected, resolvePluggyItemDisconnection: vi.fn(),
}));
vi.mock("@/features/open-finance/pluggy", () => ({
  deletePluggyItem: mocks.deleteRemote, PluggyApiError: class extends Error {},
}));
vi.mock("@/features/open-finance/pluggy-credentials", () => ({ requirePluggyCredentials: mocks.credentials }));
vi.mock("@/features/open-finance/investment-quantity-quote", () => ({
  hasPluggyQuantityQuoteFx: vi.fn(), resolvePluggyQuantityQuote: vi.fn(), storedPluggyQuantityQuote: vi.fn(),
}));

import {
  deletePluggyConnectionAction,
  excludePluggyDiagramLinkAction,
  reviewPluggyDiagramLinkAction,
} from "@/features/open-finance/diagram-actions";

const linkId = "cmrzcyi3305pglw710ptyacct";
const itemId = "3ed58bb4-7b71-4a5e-bd4b-84abb171a3bf";

describe("coordenação de ações de revisão Pluggy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.inLease = false;
    mocks.inTransaction = false;
    mocks.lease.mockImplementation(async ({ action }) => {
      mocks.inLease = true;
      try {
        return await action({
          id: "lease-1", userId: "user-1", operation: "pluggy-sync",
          signal: new AbortController().signal,
          runFencedTransaction: async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => {
            mocks.inTransaction = true;
            try { return await callback(mocks.tx); }
            finally { mocks.inTransaction = false; }
          },
        });
      } finally { mocks.inLease = false; }
    });
    mocks.tx.pluggyInvestmentDiagramLink.findFirst.mockImplementation(async () => {
      expect(mocks.inLease && mocks.inTransaction).toBe(true);
      return {
        id: linkId,
        holding: { id: "holding-1", assetId: "asset-1", includedInTotals: true, asset: { portfolioId: "portfolio-1" } },
      };
    });
    mocks.tx.asset.update.mockResolvedValue({ portfolioId: "portfolio-1" });
    mocks.tx.pluggyInvestmentDiagramLink.findUnique.mockResolvedValue({ contributionBatches: [] });
    mocks.item.findFirst.mockImplementation(async () => {
      expect(mocks.inLease).toBe(true);
      return { id: "item-db-1" };
    });
  });

  it("mantém a classificação, conciliação e score dentro do mesmo lease", async () => {
    mocks.reconcile.mockImplementation(async (_userId, lease) => {
      expect(mocks.inLease).toBe(true);
      expect(mocks.inTransaction).toBe(false);
      expect(lease).toMatchObject({ userId: "user-1", operation: "pluggy-sync" });
    });
    await reviewPluggyDiagramLinkAction({
      linkId, instrumentType: "STOCK", investmentClass: "BRAZILIAN_STOCKS", score: 5,
    });
    expect(mocks.lease).toHaveBeenCalledOnce();
    expect(mocks.lease).toHaveBeenCalledWith(expect.objectContaining({ operation: "pluggy-sync" }));
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.tx.asset.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "asset-1" } }));
  });

  it("relê a exclusão somente dentro da transação cercada e retira a posição dos totais", async () => {
    await excludePluggyDiagramLinkAction(linkId);
    expect(mocks.lease).toHaveBeenCalledWith(expect.objectContaining({ operation: "pluggy-sync" }));
    expect(mocks.tx.pluggyInvestmentDiagramLink.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "EXCLUDED" }),
    }));
    expect(mocks.tx.assetHolding.update).toHaveBeenCalledWith({
      where: { id: "holding-1" }, data: { includedInTotals: false },
    });
    expect(mocks.invalidate).toHaveBeenCalledWith(mocks.tx, "portfolio-1", "user-1");
  });

  it("protege a exclusão remota com o lease sem manter SQL aberto durante a rede", async () => {
    mocks.credentials.mockResolvedValue({ clientId: "test", clientSecret: "test" });
    mocks.deleteRemote.mockImplementation(async () => {
      expect(mocks.inLease).toBe(true);
      expect(mocks.inTransaction).toBe(false);
    });
    await deletePluggyConnectionAction(itemId);
    expect(mocks.deleteRemote).toHaveBeenCalledWith({ clientId: "test", clientSecret: "test" }, itemId);
    expect(mocks.disconnected).toHaveBeenCalledWith(itemId, expect.objectContaining({
      userId: "user-1", operation: "pluggy-sync",
    }));
  });

  it("não lê nem grava revisão quando a aquisição do lease falha", async () => {
    mocks.lease.mockRejectedValue(new Error("operação em andamento"));
    await expect(reviewPluggyDiagramLinkAction({
      linkId, instrumentType: "STOCK", investmentClass: "BRAZILIAN_STOCKS", score: 5,
    })).rejects.toThrow("operação em andamento");
    expect(mocks.tx.pluggyInvestmentDiagramLink.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.pluggyInvestmentDiagramLink.update).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
