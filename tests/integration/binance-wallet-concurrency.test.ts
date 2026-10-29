import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BinanceQuoteResult } from "@/features/portfolio/binance";

const mocks = vi.hoisted(() => ({ userId: "", quotes: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => mocks.userId }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/portfolio/binance", () => ({ fetchBinanceQuotes: mocks.quotes }));
vi.mock("@/lib/operation-security", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/operation-security")>(),
  assertUserOperationRateLimit: vi.fn(),
}));

import { disconnectBinanceAction, resolveBinanceWalletAssetAction } from "@/features/portfolio/binance-wallet-actions";
import { syncBinanceWalletForUser } from "@/features/portfolio/binance-wallet-sync";
import { OperationInProgressError, OperationLeaseLostError, withUserOperationLease } from "@/lib/operation-security";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : null;
const suite = enabled ? describe : describe.skip;
const quoteAt = new Date("2026-10-21T12:00:00Z");
const quotes: BinanceQuoteResult = {
  quotes: [{ requestedAsset: "BTC", symbol: "BTC", pair: "BTCBRL", price: 100_000, currency: "BRL", fxRateToBrl: null, asOf: quoteAt }],
  missing: [],
  missingConversion: [],
};

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

suite("concorrência da conciliação Binance", () => {
  const userIds: string[] = [];

  beforeEach(() => {
    mocks.quotes.mockReset();
    mocks.quotes.mockResolvedValue(quotes);
  });

  async function fixture(manual = false) {
    const user = await db!.user.create({
      data: { email: `binance-concurrency-${randomUUID()}@example.com`, portfolio: { create: {} } },
      include: { portfolio: true },
    });
    userIds.push(user.id);
    mocks.userId = user.id;
    const connection = await db!.binanceConnection.create({
      data: {
        userId: user.id,
        apiKeyCiphertext: "test-key-not-decrypted",
        apiSecretCiphertext: "test-secret-not-decrypted",
        apiKeyLastFour: "1234",
        walletAssets: { create: { symbol: "BTC", spotQuantity: "0.5", status: manual ? "NEEDS_REVIEW" : "AVAILABLE" } },
      },
      include: { walletAssets: true },
    });
    if (manual) await createManual(user.portfolio!.id);
    return { userId: user.id, portfolioId: user.portfolio!.id, walletAssetId: connection.walletAssets[0].id };
  }

  function createManual(portfolioId: string) {
    return db!.asset.create({
      data: {
        portfolioId, investmentClass: "CRYPTO", instrumentType: "CRYPTO", ticker: "BTC", name: "Bitcoin", score: 0,
        holdings: { create: { positionSource: "MANUAL", pricingSource: "MANUAL", issuer: "Manual", productName: "BTC manual", quantity: 1, unitPrice: 50_000 } },
      },
    });
  }

  function pauseQuotes() {
    const entered = barrier();
    const resume = barrier();
    mocks.quotes.mockImplementationOnce(async () => {
      entered.release();
      await resume.promise;
      return quotes;
    });
    return { entered: entered.promise, resume: resume.release };
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it.each([false, true])("não duplica a posição externa em duas conciliações (manual: %s)", async (manual) => {
    const f = await fixture(manual);
    const input = { walletAssetId: f.walletAssetId, resolution: manual ? "KEEP_BOTH" as const : "ADD" as const };
    const pending = pauseQuotes();
    const first = resolveBinanceWalletAssetAction(input);
    await pending.entered;
    try {
      await expect(resolveBinanceWalletAssetAction(input)).rejects.toBeInstanceOf(OperationInProgressError);
    } finally {
      pending.resume();
    }
    await first;
    await resolveBinanceWalletAssetAction(input);

    const holdings = await db!.assetHolding.findMany({ where: { asset: { portfolioId: f.portfolioId } } });
    expect(holdings.filter((holding) => holding.positionSource === "BINANCE")).toHaveLength(1);
    expect(holdings.filter((holding) => holding.positionSource === "MANUAL" && holding.includedInTotals)).toHaveLength(manual ? 1 : 0);
    const link = await db!.binanceWalletAsset.findUniqueOrThrow({ where: { id: f.walletAssetId } });
    expect(link.holdingId).toBe(holdings.find((holding) => holding.positionSource === "BINANCE")!.id);
  });

  it("sincronização não inicia enquanto a conciliação aguarda HTTP", async () => {
    const f = await fixture();
    const pending = pauseQuotes();
    const resolution = resolveBinanceWalletAssetAction({ walletAssetId: f.walletAssetId, resolution: "ADD" });
    await pending.entered;
    try {
      expect(await syncBinanceWalletForUser(f.userId)).toMatchObject({ status: "SKIPPED", changed: false });
    } finally {
      pending.resume();
    }
    await resolution;
    expect(await db!.assetHolding.count({ where: { asset: { portfolioId: f.portfolioId }, positionSource: "BINANCE" } })).toBe(1);
  });

  it("conciliação, exclusão e desconexão respeitam o lease da sincronização", async () => {
    const f = await fixture();
    await withUserOperationLease({
      userId: f.userId, operation: "binance-wallet-sync", leaseMs: 30_000,
      action: async () => {
        await expect(resolveBinanceWalletAssetAction({ walletAssetId: f.walletAssetId, resolution: "ADD" }))
          .rejects.toBeInstanceOf(OperationInProgressError);
        await expect(resolveBinanceWalletAssetAction({ walletAssetId: f.walletAssetId, resolution: "IGNORE" }))
          .rejects.toBeInstanceOf(OperationInProgressError);
        await expect(disconnectBinanceAction("REMOVE")).rejects.toBeInstanceOf(OperationInProgressError);
      },
    });
    expect((await db!.binanceWalletAsset.findUniqueOrThrow({ where: { id: f.walletAssetId } })).status).toBe("AVAILABLE");
    await resolveBinanceWalletAssetAction({ walletAssetId: f.walletAssetId, resolution: "ADD" });
    await resolveBinanceWalletAssetAction({ walletAssetId: f.walletAssetId, resolution: "IGNORE" });
    expect(await db!.assetHolding.count({ where: { asset: { portfolioId: f.portfolioId }, includedInTotals: true } })).toBe(0);
    await disconnectBinanceAction("REMOVE");
    expect(await db!.binanceConnection.count({ where: { userId: f.userId } })).toBe(0);
    expect(await db!.assetHolding.count({ where: { asset: { portfolioId: f.portfolioId } } })).toBe(0);
  });

  it("relê a posição manual criada durante a consulta de cotação", async () => {
    const f = await fixture();
    const pending = pauseQuotes();
    const resolution = resolveBinanceWalletAssetAction({ walletAssetId: f.walletAssetId, resolution: "ADD" });
    await pending.entered;
    try {
      await createManual(f.portfolioId);
    } finally {
      pending.resume();
    }
    await expect(resolution).rejects.toThrow("Escolha como conciliar");
    expect(await db!.assetHolding.count({ where: { asset: { portfolioId: f.portfolioId }, positionSource: "BINANCE" } })).toBe(0);
  });

  it("não grava após perder a posse do lease durante HTTP", async () => {
    const f = await fixture();
    const pending = pauseQuotes();
    const resolution = resolveBinanceWalletAssetAction({ walletAssetId: f.walletAssetId, resolution: "ADD" });
    await pending.entered;
    try {
      await db!.userOperationLease.update({
        where: { userId_operation: { userId: f.userId, operation: "binance-wallet-sync" } },
        data: { id: randomUUID(), lockedUntil: new Date(Date.now() + 30_000) },
      });
    } finally {
      pending.resume();
    }
    await expect(resolution).rejects.toBeInstanceOf(OperationLeaseLostError);
    expect(await db!.assetHolding.count({ where: { asset: { portfolioId: f.portfolioId } } })).toBe(0);
    expect((await db!.binanceWalletAsset.findUniqueOrThrow({ where: { id: f.walletAssetId } })).holdingId).toBeNull();
  });
});
