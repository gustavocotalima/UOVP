import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readMarketMetadata: vi.fn(),
  saveVerifiedMarketMetadata: vi.fn(),
  saveMissingMarketMetadata: vi.fn(),
  searchBrapiTickers: vi.fn(),
  searchYahooTickers: vi.fn(),
}));

vi.mock("@/lib/shared-cache", () => ({
  sharedCacheKey: (...parts: unknown[]) => JSON.stringify(parts),
  withSharedCacheCoalescing: async <T>({ operation }: { operation: () => Promise<T> }) => operation(),
}));

vi.mock("@/features/portfolio/market-metadata", () => ({
  readMarketMetadata: mocks.readMarketMetadata,
  saveVerifiedMarketMetadata: mocks.saveVerifiedMarketMetadata,
  saveMissingMarketMetadata: mocks.saveMissingMarketMetadata,
  missingMetadataCanRetry: (metadata: { status: string; lastAttemptAt: string }) =>
    metadata.status === "MISSING"
      && Date.now() - new Date(metadata.lastAttemptAt).getTime() >= 24 * 60 * 60 * 1_000,
}));

vi.mock("@/features/portfolio/brapi", () => ({
  normalizeBrapiSymbol: (value: string) => value.trim().toUpperCase().replace(/\.SA$/, ""),
  searchBrapiTickers: mocks.searchBrapiTickers,
}));

vi.mock("@/features/portfolio/yahoo-finance", () => ({
  normalizeYahooSymbol: (value: string) => value.trim().toUpperCase(),
  searchYahooTickers: mocks.searchYahooTickers,
}));

import {
  persistExactBrapiSearchMetadata,
  resolveBrapiLogo,
  resolveYahooLogo,
} from "@/features/portfolio/market-logo-resolver";

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    provider: "BRAPI",
    symbol: "EMBJ3",
    name: "Embraer S.A.",
    logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
    status: "VERIFIED",
    source: "CATALOG",
    resolvedAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("resolução persistente de logos de mercado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readMarketMetadata.mockResolvedValue(new Map());
    mocks.saveVerifiedMarketMetadata.mockImplementation(async (value) => metadata(value));
    mocks.saveMissingMarketMetadata.mockImplementation(async (value) => metadata({
      ...value,
      provider: value.provider,
      symbol: value.symbol,
      logoUrl: value.failedLogoUrl ?? null,
      status: "MISSING",
      resolvedAt: null,
    }));
  });

  it("reutiliza uma URL verificada sem consultar o catálogo", async () => {
    const stored = metadata();
    mocks.readMarketMetadata.mockResolvedValue(new Map([["EMBJ3", stored]]));

    await expect(resolveBrapiLogo("EMBJ3")).resolves.toEqual(stored);
    expect(mocks.searchBrapiTickers).not.toHaveBeenCalled();
  });

  it("corrige EMBJ3 com a URL exata retornada pelo catálogo após falha", async () => {
    const broken = "https://icons.brapi.dev/icons/EMBJ3.svg";
    mocks.readMarketMetadata.mockResolvedValue(new Map([["EMBJ3", metadata({ logoUrl: broken })]]));
    mocks.searchBrapiTickers.mockResolvedValue([{
      symbol: "EMBJ3",
      name: "Embraer S.A.",
      logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
    }]);

    const result = await resolveBrapiLogo("EMBJ3", [broken]);

    expect(mocks.searchBrapiTickers).toHaveBeenCalledOnce();
    expect(mocks.saveVerifiedMarketMetadata).toHaveBeenCalledWith(expect.objectContaining({
      provider: "BRAPI",
      symbol: "EMBJ3",
      logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
    }));
    expect(result.logoUrl).toBe("https://icons.brapi.dev/icons/EMBR3.svg");
  });

  it("respeita o cache negativo e não repete uma consulta", async () => {
    const missing = metadata({
      logoUrl: null,
      status: "MISSING",
      resolvedAt: null,
      lastAttemptAt: new Date().toISOString(),
    });
    mocks.readMarketMetadata.mockResolvedValue(new Map([["EMBJ3", missing]]));

    await expect(resolveBrapiLogo("EMBJ3")).resolves.toEqual(missing);
    expect(mocks.searchBrapiTickers).not.toHaveBeenCalled();
  });

  it("trata o placeholder da brapi como logo ausente", async () => {
    mocks.readMarketMetadata.mockResolvedValue(new Map([["EMBJ3", metadata({
      logoUrl: "https://icons.brapi.dev/icons/brapi.svg",
    })]]));
    mocks.searchBrapiTickers.mockResolvedValue([{
      symbol: "EMBJ3",
      name: "Embraer S.A.",
      logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
    }]);

    await resolveBrapiLogo("EMBJ3");

    expect(mocks.searchBrapiTickers).toHaveBeenCalledOnce();
    expect(mocks.saveVerifiedMarketMetadata).toHaveBeenCalledWith(expect.objectContaining({
      logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
    }));
  });

  it("persiste a correspondência exata recebida pelo autocomplete", async () => {
    await persistExactBrapiSearchMetadata("embj3", [{
      symbol: "EMBJ3",
      name: "Embraer S.A.",
      assetType: "stock",
      subType: "stock",
      currency: "BRL",
      lastPrice: null,
      logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
    }]);

    expect(mocks.saveVerifiedMarketMetadata).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "EMBJ3",
      logoUrl: "https://icons.brapi.dev/icons/EMBR3.svg",
      source: "SEARCH",
    }));
  });

  it("não substitui um logo verificado por uma busca posterior", async () => {
    const stored = metadata();
    mocks.readMarketMetadata.mockResolvedValue(new Map([["EMBJ3", stored]]));

    await expect(persistExactBrapiSearchMetadata("EMBJ3", [{
      symbol: "EMBJ3",
      name: "Embraer S.A.",
      assetType: "stock",
      subType: "stock",
      currency: "BRL",
      lastPrice: null,
      logoUrl: null,
    }])).resolves.toEqual(stored);

    expect(mocks.saveMissingMarketMetadata).not.toHaveBeenCalled();
    expect(mocks.saveVerifiedMarketMetadata).not.toHaveBeenCalled();
  });

  it("recupera uma ausência legada do Yahoo e persiste o fallback de IAUM", async () => {
    const missing = metadata({
      provider: "YAHOO",
      symbol: "IAUM",
      name: "iShares Gold Trust Micro",
      logoUrl: null,
      status: "MISSING",
      resolvedAt: null,
      lastAttemptAt: new Date().toISOString(),
    });
    mocks.readMarketMetadata.mockResolvedValue(new Map([["IAUM", missing]]));

    await resolveYahooLogo("IAUM", "ETF");

    expect(mocks.searchYahooTickers).not.toHaveBeenCalled();
    expect(mocks.saveVerifiedMarketMetadata).toHaveBeenCalledWith({
      provider: "YAHOO",
      symbol: "IAUM",
      name: "iShares Gold Trust Micro",
      logoUrl: "https://financialmodelingprep.com/image-stock/IAUM.png",
      source: "CATALOG",
    });
  });

  it("mantém por 24 horas o fallback do Yahoo confirmado como quebrado", async () => {
    const failedLogoUrl = "https://financialmodelingprep.com/image-stock/IAUM.png";
    const missing = metadata({
      provider: "YAHOO",
      symbol: "IAUM",
      logoUrl: failedLogoUrl,
      status: "MISSING",
      resolvedAt: null,
      lastAttemptAt: new Date().toISOString(),
    });
    mocks.readMarketMetadata.mockResolvedValue(new Map([["IAUM", missing]]));

    await expect(resolveYahooLogo("IAUM", "ETF")).resolves.toEqual(missing);

    expect(mocks.searchYahooTickers).not.toHaveBeenCalled();
    expect(mocks.saveVerifiedMarketMetadata).not.toHaveBeenCalled();
  });
});
