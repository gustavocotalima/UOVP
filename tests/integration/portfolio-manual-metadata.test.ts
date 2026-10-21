import { randomUUID } from "node:crypto";
import { PrismaClient, type InstrumentType, type InvestmentClass } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: "",
  searchBrapi: vi.fn(), quoteBrapi: vi.fn(),
  searchYahoo: vi.fn(), quoteYahoo: vi.fn(), yahooFx: vi.fn(),
  searchBinance: vi.fn(), quoteBinance: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ requireUserId: async () => mocks.userId }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/portfolio/brapi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/portfolio/brapi")>(),
  searchBrapiTickers: mocks.searchBrapi, fetchBrapiQuotes: mocks.quoteBrapi,
}));
vi.mock("@/features/portfolio/brapi-credentials", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/portfolio/brapi-credentials")>(),
  requireBrapiApiKey: async () => "test-only",
}));
vi.mock("@/features/portfolio/yahoo-finance", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/portfolio/yahoo-finance")>(),
  searchYahooTickers: mocks.searchYahoo, fetchYahooQuotes: mocks.quoteYahoo,
  fetchYahooFxRates: mocks.yahooFx,
  fetchYahooAssetProfile: async () => ({ sector: "Technology", industry: "Software" }),
}));
vi.mock("@/features/portfolio/binance", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/portfolio/binance")>(),
  searchBinanceAssets: mocks.searchBinance, fetchBinanceQuotes: mocks.quoteBinance,
}));
vi.mock("@/features/portfolio/market-logo-resolver", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/portfolio/market-logo-resolver")>(),
  persistExactBrapiSearchMetadata: async () => null,
  persistExactYahooSearchMetadata: async () => null,
}));

import { saveAssetAction } from "@/features/portfolio/actions";

const db = process.env.DATABASE_URL ? new PrismaClient() : null;
const suite = db ? describe : describe.skip;
const asOf = new Date("2026-10-21T12:00:00.000Z");

suite("metadados de ativos com múltiplas posições manuais", () => {
  const userIds: string[] = [];

  async function fixture(investmentClass: InvestmentClass, instrumentType: InstrumentType) {
    const user = await db!.user.create({
      data: { email: `manual-metadata-${randomUUID()}@example.com`, portfolio: { create: {} } },
      include: { portfolio: true },
    });
    userIds.push(user.id);
    mocks.userId = user.id;
    return db!.asset.create({
      data: {
        portfolioId: user.portfolio!.id, investmentClass, instrumentType, ticker: "OLD", name: "Ativo anterior",
        holdings: { create: [
          { ticker: "OLD", issuer: "Origem A", productName: "Posição A", pricingSource: "MANUAL", fractional: true, quantity: 2, unitPrice: 100, currentValue: 200, investedValue: 150, investedValueCurrency: "BRL" },
          { ticker: "OLD", issuer: "Origem B", productName: "Posição B", pricingSource: "MANUAL", fractional: true, quantity: 3, unitPrice: 120, currentValue: 360, investedValue: 60, investedValueCurrency: "USD" },
          { ticker: "OLD", issuer: "Excluída", productName: "Posição excluída", pricingSource: "PLUGGY", positionSource: "PLUGGY", includedInTotals: false, quantity: 9, unitPrice: 99 },
        ] },
      },
      include: { holdings: { orderBy: { createdAt: "asc" } } },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchBrapi.mockResolvedValue([{ symbol: "NEW", name: "Novo ativo", assetType: "stock", subType: null }]);
    mocks.quoteBrapi.mockResolvedValue([{ symbol: "NEW", name: "Novo ativo", price: 42, currency: "BRL", asOf }]);
    mocks.searchYahoo.mockResolvedValue([{ symbol: "NEW", name: "Novo ativo", exchange: "NASDAQ", quoteType: "EQUITY", sector: "Technology", industry: "Software" }]);
    mocks.quoteYahoo.mockResolvedValue([{ symbol: "NEW", name: "Novo ativo", price: 42, currency: "USD", exchange: "NASDAQ", quoteType: "EQUITY", asOf }]);
    mocks.yahooFx.mockResolvedValue([{ currency: "USD", rateToBrl: 5, asOf }]);
    mocks.searchBinance.mockResolvedValue([{ symbol: "NEW", name: "Novo ativo", pair: "NEWUSDT" }]);
    mocks.quoteBinance.mockResolvedValue({ quotes: [{ symbol: "NEW", pair: "NEWUSDT", price: 42, currency: "USDT", fxRateToBrl: 5, asOf }], missing: [], missingConversion: [] });
  });

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  it.each([
    { investmentClass: "BRAZILIAN_STOCKS", instrumentType: "STOCK", pricingSource: "BRAPI", currency: "BRL", fx: undefined, pair: null },
    { investmentClass: "INTERNATIONAL_STOCKS", instrumentType: "STOCK", pricingSource: "YAHOO", currency: "USD", fx: "5", pair: null },
    { investmentClass: "CRYPTO", instrumentType: "CRYPTO", pricingSource: "BINANCE", currency: "USDT", fx: "5", pair: "NEWUSDT" },
  ] as const)("sincroniza ticker e cotação $pricingSource sem redistribuir posições", async (scenario) => {
    const asset = await fixture(scenario.investmentClass, scenario.instrumentType);
    await db!.assetHolding.updateMany({
      where: { assetId: asset.id, includedInTotals: true },
      data: { pricingSource: scenario.pricingSource, currency: scenario.currency, providerSymbol: "OLDPAIR", fxRateToBrl: 4, marketSector: "Setor anterior" },
    });

    await saveAssetAction({ id: asset.id, investmentClass: scenario.investmentClass, instrumentType: scenario.instrumentType, ticker: "NEW", name: "Novo ativo", quantity: 5, unitPrice: 999 });

    expect((await db!.asset.findUniqueOrThrow({ where: { id: asset.id } })).ticker).toBe("NEW");
    for (const original of asset.holdings) {
      const stored = await db!.assetHolding.findUniqueOrThrow({ where: { id: original.id } });
      if (!original.includedInTotals) {
        expect(stored).toEqual(original);
        continue;
      }
      expect(stored.ticker).toBe("NEW");
      expect(stored.pricingSource).toBe(scenario.pricingSource);
      expect(stored.unitPrice.toString()).toBe("42");
      expect(stored.currency).toBe(scenario.currency);
      expect(stored.fxRateToBrl?.toString()).toBe(scenario.fx);
      expect(stored.providerSymbol).toBe(scenario.pair);
      expect(stored.priceUpdatedAt).toEqual(asOf);
      expect(stored.currentValue).toBeNull();
      expect(stored.marketSector).toBe(scenario.pricingSource === "YAHOO" ? "Technology" : null);
      for (const key of ["quantity", "investedValue", "investedValueCurrency", "issuer", "productName"] as const) {
        expect(stored[key]?.toString()).toBe(original[key]?.toString());
      }
    }
  });

  it.each(["OLD", "NEW"])("preserva preços e valores manuais ao salvar metadados com ticker %s", async (ticker) => {
    const asset = await fixture("STORE_OF_VALUE", "MUTUAL_FUND");
    await saveAssetAction({ id: asset.id, investmentClass: "STORE_OF_VALUE", instrumentType: "MUTUAL_FUND", ticker, name: "Nome corrigido", quantity: 5, unitPrice: 112 });
    for (const original of asset.holdings) {
      const stored = await db!.assetHolding.findUniqueOrThrow({ where: { id: original.id } });
      expect(stored).toEqual({ ...original, ticker: original.includedInTotals ? ticker : original.ticker, updatedAt: stored.updatedAt });
    }
    expect(mocks.quoteBrapi).not.toHaveBeenCalled();
    expect(mocks.quoteYahoo).not.toHaveBeenCalled();
    expect(mocks.quoteBinance).not.toHaveBeenCalled();
  });

  it("reverte o ativo e as posições quando a quantidade agregada é alterada", async () => {
    const asset = await fixture("BRAZILIAN_STOCKS", "STOCK");
    await expect(saveAssetAction({ id: asset.id, investmentClass: "BRAZILIAN_STOCKS", instrumentType: "STOCK", ticker: "NEW", name: "Novo ativo", quantity: 6, unitPrice: 42 }))
      .rejects.toThrow("mais de uma posição manual");
    expect((await db!.asset.findUniqueOrThrow({ where: { id: asset.id } })).ticker).toBe("OLD");
    for (const original of asset.holdings) {
      expect(await db!.assetHolding.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    }
  });
});
