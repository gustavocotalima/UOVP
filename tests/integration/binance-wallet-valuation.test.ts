import { createPrismaClient } from "../../lib/prisma-client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BinanceQuoteResult } from "@/features/portfolio/binance";
import type { BinanceWalletSnapshot } from "@/features/portfolio/binance-wallet-client";

const mocks = vi.hoisted(() => ({ quotes: vi.fn(), walletSnapshot: vi.fn() }));
vi.mock("@/features/portfolio/binance", () => ({ fetchBinanceQuotes: mocks.quotes }));
vi.mock("@/features/portfolio/binance-wallet-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/portfolio/binance-wallet-client")>(),
  BinancePrivateClient: class { walletSnapshot = mocks.walletSnapshot; },
}));
vi.mock("@/features/portfolio/binance-wallet-credentials", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/portfolio/binance-wallet-credentials")>(),
  requireBinanceCredentials: async () => ({ apiKey: "test-key", apiSecret: "test-secret" }),
}));

import { getBinanceConnectionStatus } from "@/features/portfolio/binance-wallet-credentials";
import { syncBinanceWalletForUser } from "@/features/portfolio/binance-wallet-sync";

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : null;
const suite = enabled ? describe : describe.skip;
const quoteAt = new Date("2026-10-21T12:00:00Z");
const quote: BinanceQuoteResult["quotes"][number] = { requestedAsset: "BTC", symbol: "BTC", pair: "BTCUSDT", price: 100, currency: "USDT", fxRateToBrl: 5, asOf: quoteAt };
const snapshot: BinanceWalletSnapshot = {
  buckets: (["SPOT", "FUNDING", "EARN_FLEXIBLE", "EARN_LOCKED"] as const).map((kind) => ({ kind, ok: true, error: null, balances: kind === "SPOT" ? [{ symbol: "BTC", name: "Bitcoin", quantity: "2", btcValuation: null }] : [] })),
  totalBtcValuations: {}, valuationsComplete: false,
};

suite("invalidação patrimonial e snapshots da carteira Binance", () => {
  const userIds: string[] = [];

  beforeEach(() => {
    mocks.quotes.mockReset().mockResolvedValue({ quotes: [quote], missing: [], missingConversion: [] });
    mocks.walletSnapshot.mockReset().mockResolvedValue(snapshot);
  });

  async function fixture() {
    const user = await db!.user.create({ data: { email: `binance-valuation-${randomUUID()}@example.com`, portfolio: { create: {} } }, include: { portfolio: true } });
    userIds.push(user.id);
    const asset = await db!.asset.create({ data: { portfolioId: user.portfolio!.id, instrumentType: "CRYPTO", investmentClass: "CRYPTO", ticker: "BTC", name: "Bitcoin", score: 5 } });
    const holding = await db!.assetHolding.create({ data: { assetId: asset.id, issuer: "Binance", productName: "BTC · Binance", positionSource: "BINANCE", pricingSource: "BINANCE", quantity: 2, unitPrice: 100, currency: "USDT", fxRateToBrl: 5, fxUpdatedAt: quoteAt, priceUpdatedAt: quoteAt, marketQuoteType: "SPOT", providerSymbol: "BTCUSDT" } });
    const connection = await db!.binanceConnection.create({ data: { userId: user.id, apiKeyCiphertext: "test-key", apiSecretCiphertext: "test-secret", apiKeyLastFour: "1234", walletAssets: { create: { symbol: "BTC", name: "Bitcoin", status: "TRACKED", holdingId: holding.id, spotQuantity: 2, valuationSupported: true, valuationMethod: "DIRECT" } } } });
    return { user, holding, connection };
  }

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it.each(["price", "fx", "currency", "quantity"] as const)("invalida a simulação quando muda %s", async (field) => {
    const f = await fixture();
    if (field === "price") mocks.quotes.mockResolvedValue({ quotes: [{ ...quote, price: 110 }], missing: [], missingConversion: [] });
    if (field === "fx") mocks.quotes.mockResolvedValue({ quotes: [{ ...quote, fxRateToBrl: 6 }], missing: [], missingConversion: [] });
    if (field === "currency") mocks.quotes.mockResolvedValue({ quotes: [{ ...quote, currency: "BRL", pair: "BTCBRL", fxRateToBrl: null }], missing: [], missingConversion: [] });
    if (field === "quantity") mocks.walletSnapshot.mockResolvedValue({ ...snapshot, buckets: snapshot.buckets.map((bucket) => bucket.kind === "SPOT" ? { ...bucket, balances: [{ ...bucket.balances[0], quantity: "3" }] } : bucket) });
    expect(await syncBinanceWalletForUser(f.user.id)).toMatchObject({ status: "UPDATED", changed: true, portfolioChanged: true });
  });

  it("refresh de timestamps sem mudança financeira mantém versão e rascunho", async () => {
    const f = await fixture();
    mocks.quotes.mockResolvedValue({ quotes: [{ ...quote, asOf: new Date(quoteAt.getTime() + 60_000) }], missing: [], missingConversion: [] });
    expect(await syncBinanceWalletForUser(f.user.id)).toMatchObject({ status: "UPDATED", changed: true, portfolioChanged: false });
    expect((await db!.assetHolding.findUniqueOrThrow({ where: { id: f.holding.id } })).priceUpdatedAt?.getTime()).toBe(quoteAt.getTime() + 60_000);
  });

  it("descoberta atualiza a seleção sem invalidar patrimônio", async () => {
    const f = await fixture();
    mocks.walletSnapshot.mockResolvedValue({ ...snapshot, buckets: snapshot.buckets.map((bucket) => bucket.kind === "SPOT" ? { ...bucket, balances: [...bucket.balances, { symbol: "ETH", name: "Ethereum", quantity: "1", btcValuation: null }] } : bucket) });
    expect(await syncBinanceWalletForUser(f.user.id)).toMatchObject({ changed: true, portfolioChanged: false, discovered: 1 });
    expect((await getBinanceConnectionStatus(f.user.id)).assets).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: "ETH", totalQuantity: "1" })]));
  });

  it("falha da API atualiza erro visível sem invalidar a carteira", async () => {
    const f = await fixture();
    mocks.walletSnapshot.mockRejectedValue(new Error("Falha simulada"));
    expect(await syncBinanceWalletForUser(f.user.id)).toMatchObject({ status: "FAILED", changed: true, portfolioChanged: false });
    expect((await getBinanceConnectionStatus(f.user.id)).lastError).toBe("Falha simulada");
  });

  it("inclui revisão ordenável também no snapshot sem conexão", async () => {
    const f = await fixture();
    const before = await getBinanceConnectionStatus(f.user.id);
    await db!.binanceConnection.delete({ where: { id: f.connection.id } });
    const after = await getBinanceConnectionStatus(f.user.id);
    expect(after).toMatchObject({ configured: false, assets: [] });
    expect(BigInt(after.snapshotRevision)).toBeGreaterThan(BigInt(before.snapshotRevision));
  });
});
