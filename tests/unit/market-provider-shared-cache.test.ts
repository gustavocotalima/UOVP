import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheMock = vi.hoisted(() => {
  const values = new Map<string, { cachedAt: number; value: unknown }>();
  const quote = vi.fn();
  return {
    quote,
    values,
    reset() {
      values.clear();
      quote.mockReset();
    },
  };
});

vi.mock("@/lib/shared-cache", () => ({
  isSharedCacheConfigured: () => true,
  sharedCacheKey: (scope: string, ...parts: unknown[]) => `${scope}:${JSON.stringify(parts)}`,
  getSharedCache: async (key: string, decode: (value: unknown) => unknown) => {
    const entry = cacheMock.values.get(key);
    if (!entry) return null;
    const value = decode(entry.value);
    return value == null ? null : { ...entry, ageMs: Date.now() - entry.cachedAt, value };
  },
  getSharedCacheMany: async (keys: string[], decode: (value: unknown) => unknown) =>
    new Map(keys.flatMap((key) => {
      const entry = cacheMock.values.get(key);
      if (!entry) return [];
      const value = decode(entry.value);
      return value == null
        ? []
        : [[key, { ...entry, ageMs: Date.now() - entry.cachedAt, value }] as const];
    })),
  setSharedCache: async (key: string, value: unknown, _ttl?: number, cachedAt = Date.now()) => {
    cacheMock.values.set(key, { cachedAt, value });
  },
  setSharedCacheMany: async (entries: Array<{ key: string; value: unknown; cachedAt?: number }>) => {
    for (const entry of entries) {
      cacheMock.values.set(entry.key, {
        cachedAt: entry.cachedAt ?? Date.now(),
        value: entry.value,
      });
    }
  },
  withSharedCacheCoalescing: async <T>({ operation }: { operation: () => Promise<T> }) => operation(),
}));

vi.mock("yahoo-finance2", () => ({
  default: class YahooFinanceMock {
    quote(symbols: string[]) {
      return cacheMock.quote(symbols);
    }
    search() {
      return Promise.resolve({ quotes: [] });
    }
    quoteSummary() {
      return Promise.resolve({});
    }
    chart() {
      return Promise.resolve({ quotes: [] });
    }
  },
}));

import { fetchBrapiQuotes } from "@/features/portfolio/brapi";
import { fetchBinanceQuotes, resetBinanceCachesForTests } from "@/features/portfolio/binance";
import { fetchYahooQuotes } from "@/features/portfolio/yahoo-finance";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  cacheMock.reset();
  resetBinanceCachesForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetBinanceCachesForTests();
});

describe("cache compartilhado dos provedores", () => {
  it("brapi atualiza somente os tickers solicitados e não armazena a chave pessoal", async () => {
    let request = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      request += 1;
      const symbols = new URL(String(input)).searchParams.get("symbols")?.split(",") ?? [];
      return jsonResponse({
        results: symbols.map((symbol) => ({
          requestedSymbol: symbol,
          symbol,
          data: {
            longName: symbol,
            currency: "BRL",
            regularMarketPrice: request * 10,
          },
        })),
      });
    });
    vi.stubGlobal("fetch", fetcher);

    await fetchBrapiQuotes({
      apiKey: "chave-usuario-a",
      tickers: ["EMBJ3", "ITUB3"],
      cacheMode: "REFRESH",
    });
    await fetchBrapiQuotes({
      apiKey: "chave-usuario-b",
      tickers: ["EMBJ3", "ITUB3"],
    });
    const refreshed = await fetchBrapiQuotes({
      apiKey: "chave-usuario-b",
      tickers: ["EMBJ3"],
      cacheMode: "REFRESH",
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("symbols")).toBe("EMBJ3");
    expect(refreshed[0].price).toBe(20);
    expect(JSON.stringify([...cacheMock.values])).not.toContain("chave-usuario");
  });

  it("Yahoo reutiliza por símbolo e o refresh consulta somente o subconjunto solicitado", async () => {
    let request = 0;
    cacheMock.quote.mockImplementation(async (symbols: string[]) => {
      request += 1;
      return Object.fromEntries(symbols.map((symbol) => [symbol, {
        symbol,
        longName: symbol,
        regularMarketPrice: request * 100,
        regularMarketTime: new Date("2026-07-24T12:00:00.000Z"),
        currency: "USD",
        exchange: "NMS",
        quoteType: "EQUITY",
      }]));
    });

    await fetchYahooQuotes({ symbols: ["GOOG", "AAPL"], cacheMode: "REFRESH" });
    await fetchYahooQuotes({ symbols: ["GOOG", "AAPL"] });
    const refreshed = await fetchYahooQuotes({ symbols: ["GOOG"], cacheMode: "REFRESH" });

    expect(cacheMock.quote).toHaveBeenCalledTimes(2);
    expect(cacheMock.quote.mock.calls[1][0]).toEqual(["GOOG"]);
    expect(refreshed[0].price).toBe(200);
  });

  it("Binance reutiliza catálogo e preços, mas o refresh consulta somente os pares do usuário", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/exchangeInfo")) {
        return jsonResponse({
          symbols: [
            { symbol: "BTCBRL", status: "TRADING", baseAsset: "BTC", quoteAsset: "BRL", baseAssetPrecision: 8, isSpotTradingAllowed: true },
            { symbol: "ETHBRL", status: "TRADING", baseAsset: "ETH", quoteAsset: "BRL", baseAssetPrecision: 8, isSpotTradingAllowed: true },
          ],
        });
      }
      const symbols = JSON.parse(url.searchParams.get("symbols") ?? "[]") as string[];
      return jsonResponse(symbols.map((symbol) => ({ symbol, price: "100" })));
    });
    vi.stubGlobal("fetch", fetcher);

    await fetchBinanceQuotes({ assets: ["BTC", "ETH"], cacheMode: "REFRESH" });
    resetBinanceCachesForTests();
    await fetchBinanceQuotes({ assets: ["BTC", "ETH"] });
    await fetchBinanceQuotes({ assets: ["BTC"], cacheMode: "REFRESH" });

    const priceRequests = fetcher.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.endsWith("/ticker/price"));
    expect(priceRequests).toHaveLength(2);
    expect(JSON.parse(priceRequests[1].searchParams.get("symbols") ?? "[]")).toEqual(["BTCBRL"]);
  });
});
