import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBinanceQuotes,
  resetBinanceCachesForTests,
  searchBinanceAssets,
} from "@/features/portfolio/binance";

const catalog = {
  symbols: [
    { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT", baseAssetPrecision: 8, isSpotTradingAllowed: true },
    { symbol: "BTCBRL", status: "TRADING", baseAsset: "BTC", quoteAsset: "BRL", baseAssetPrecision: 8, isSpotTradingAllowed: true },
    { symbol: "ADAUSDT", status: "TRADING", baseAsset: "ADA", quoteAsset: "USDT", baseAssetPrecision: 8, isSpotTradingAllowed: true },
    { symbol: "USDTBRL", status: "TRADING", baseAsset: "USDT", quoteAsset: "BRL", baseAssetPrecision: 8, isSpotTradingAllowed: true },
    { symbol: "OLDUSDT", status: "BREAK", baseAsset: "OLD", quoteAsset: "USDT", baseAssetPrecision: 8, isSpotTradingAllowed: true },
    { symbol: "MARGINBRL", status: "TRADING", baseAsset: "MARGIN", quoteAsset: "BRL", baseAssetPrecision: 8, isSpotTradingAllowed: false },
  ],
};

function response(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => resetBinanceCachesForTests());
afterEach(() => resetBinanceCachesForTests());

describe("integração Binance", () => {
  it("filtra o catálogo Spot e prefere o par direto em BRL", async () => {
    const fetcher = vi.fn(async () => response(catalog)) as unknown as typeof fetch;

    const results = await searchBinanceAssets({ query: "b", fetcher });

    expect(results).toEqual([{
      symbol: "BTC",
      name: "BTC",
      pair: "BTCBRL",
      quoteAsset: "BRL",
      baseAssetPrecision: 8,
      logoUrl: null,
    }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetcher).mock.calls[0][0])).toContain("/api/v3/exchangeInfo");
  });

  it("usa fallback em USDT e converte pela cotação USDT/BRL", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/exchangeInfo")) return response(catalog);
      const symbols = JSON.parse(url.searchParams.get("symbols") ?? "[]") as string[];
      return response(symbols.map((symbol) => ({
        symbol,
        price: symbol === "ADAUSDT" ? "0.50" : "5.25",
      })));
    }) as unknown as typeof fetch;

    const result = await fetchBinanceQuotes({
      assets: ["ADA"],
      fetcher,
      now: Date.parse("2026-07-23T12:00:00.000Z"),
    });

    expect(result).toEqual({
      quotes: [{
        requestedAsset: "ADA",
        symbol: "ADA",
        pair: "ADAUSDT",
        price: 0.5,
        currency: "USDT",
        fxRateToBrl: 5.25,
        asOf: new Date("2026-07-23T12:00:00.000Z"),
      }],
      missing: [],
      missingConversion: [],
    });
  });

  it("trata USDT como ativo usando diretamente USDT/BRL", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/exchangeInfo")) return response(catalog);
      return response([{ symbol: "USDTBRL", price: "5.20" }]);
    }) as unknown as typeof fetch;

    const result = await fetchBinanceQuotes({ assets: ["usdt"], fetcher });

    expect(result.quotes[0]).toEqual(expect.objectContaining({
      requestedAsset: "USDT",
      pair: "USDTBRL",
      price: 5.2,
      currency: "BRL",
      fxRateToBrl: null,
    }));
  });

  it("reutiliza o catálogo e as cotações dentro das janelas de cache", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/exchangeInfo")) return response(catalog);
      return response([{ symbol: "BTCBRL", price: "350000" }]);
    }) as unknown as typeof fetch;
    const now = Date.parse("2026-07-23T12:00:00.000Z");

    await Promise.all([
      fetchBinanceQuotes({ assets: ["BTC"], fetcher, now }),
      fetchBinanceQuotes({ assets: ["BTC"], fetcher, now }),
    ]);
    await fetchBinanceQuotes({ assets: ["BTC"], fetcher, now: now + 10_000 });

    const paths = vi.mocked(fetcher).mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths.filter((path) => path.endsWith("/exchangeInfo"))).toHaveLength(1);
    expect(paths.filter((path) => path.endsWith("/ticker/price"))).toHaveLength(1);
  });

  it("isola um par removido sem impedir as demais cotações", async () => {
    const extendedCatalog = {
      symbols: [
        ...catalog.symbols,
        { symbol: "INVALIDBRL", status: "TRADING", baseAsset: "INVALID", quoteAsset: "BRL", baseAssetPrecision: 8, isSpotTradingAllowed: true },
      ],
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/exchangeInfo")) return response(extendedCatalog);
      const symbols = JSON.parse(url.searchParams.get("symbols") ?? "[]") as string[];
      if (symbols.includes("INVALIDBRL")) return response({ code: -1121, msg: "Invalid symbol." }, 400);
      return response(symbols.map((symbol) => ({ symbol, price: "350000" })));
    }) as unknown as typeof fetch;

    const result = await fetchBinanceQuotes({ assets: ["BTC", "INVALID"], fetcher });

    expect(result.quotes.map((quote) => quote.symbol)).toEqual(["BTC"]);
    expect(result.missing).toEqual(["INVALID"]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("traduz limite e bloqueio temporário sem repetir a requisição", async () => {
    const limitedFetcher = vi.fn(async () =>
      response({ code: -1003, msg: "Too much request weight used" }, 429, { "Retry-After": "12" }),
    ) as unknown as typeof fetch;

    await expect(searchBinanceAssets({ query: "BTC", fetcher: limitedFetcher }))
      .rejects.toEqual(expect.objectContaining({
        name: "BinanceApiError",
        status: 429,
        retryAfterSeconds: 12,
        message: "O limite de requisições da Binance foi atingido. Tente novamente em 12 segundos.",
      }));
    expect(limitedFetcher).toHaveBeenCalledTimes(1);

    resetBinanceCachesForTests();
    const bannedFetcher = vi.fn(async () =>
      response({ code: -1003 }, 418, { "Retry-After": "60" }),
    ) as unknown as typeof fetch;
    await expect(searchBinanceAssets({ query: "BTC", fetcher: bannedFetcher }))
      .rejects.toThrow("A Binance bloqueou temporariamente este IP");
  });

  it("rejeita respostas malformadas", async () => {
    const fetcher = vi.fn(async () => response({ symbols: "invalid" })) as unknown as typeof fetch;
    await expect(searchBinanceAssets({ query: "BTC", fetcher }))
      .rejects.toThrow("A Binance retornou um catálogo inválido.");
  });
});
