import { describe, expect, it, vi } from "vitest";
import {
  classifyYahooReitMetadata,
  fetchAvailableYahooQuotes,
  fetchYahooFxRates,
  fetchYahooHistoricalFxRates,
  fetchYahooQuotes,
  isYahooB3Listing,
  normalizeYahooCurrency,
  searchYahooTickers,
  yahooFxSymbol,
  type YahooClient,
} from "@/features/portfolio/yahoo-finance";

function yahooClient(overrides: Partial<YahooClient> = {}): YahooClient {
  return {
    search: vi.fn(async () => ({ quotes: [] })),
    quote: vi.fn(async () => ({})),
    quoteSummary: vi.fn(async () => ({ assetProfile: undefined })),
    ...overrides,
  };
}

describe("integração Yahoo Finance", () => {
  it("classifica REITs pelo setor/indústria e rejeita metadados conflitantes", () => {
    expect(classifyYahooReitMetadata({ sector: "Real Estate", industry: "REIT - Retail" })).toBe("CONFIRMED");
    expect(classifyYahooReitMetadata({ sector: "Real Estate", industry: "REIT—Retail" })).toBe("CONFIRMED");
    expect(classifyYahooReitMetadata({ sector: "Real Estate", industry: "Real Estate Services" })).toBe("POSSIBLE");
    expect(classifyYahooReitMetadata({ sector: null, industry: null })).toBe("AMBIGUOUS");
    expect(classifyYahooReitMetadata({ sector: "Technology", industry: "Software" })).toBe("CONTRADICTED");
  });

  it("filtra a busca de REITs, mantém tickers internacionais e remove listagens da B3", async () => {
    const client = yahooClient({
      search: vi.fn(async () => ({
        quotes: [
          {
            isYahooFinance: true,
            symbol: "O",
            quoteType: "EQUITY",
            exchange: "NYQ",
            exchDisp: "NYSE",
            longname: "Realty Income Corporation",
            sector: "Real Estate",
            industry: "REIT - Retail",
          },
          {
            isYahooFinance: true,
            symbol: "XYZ",
            quoteType: "EQUITY",
            exchange: "NMS",
            longname: "Sem metadados",
          },
          {
            isYahooFinance: true,
            symbol: "AAPL",
            quoteType: "EQUITY",
            exchange: "NMS",
            sector: "Technology",
            industry: "Consumer Electronics",
          },
          {
            isYahooFinance: true,
            symbol: "PETR4.SA",
            quoteType: "EQUITY",
            exchange: "SAO",
            sector: "Energy",
          },
        ],
      })),
    });

    const results = await searchYahooTickers({ query: "realty", kind: "REITS", client });

    expect(results.map((result) => result.symbol)).toEqual(["O", "XYZ"]);
    expect(results[0]).toEqual(expect.objectContaining({
      quoteType: "EQUITY",
      exchange: "NYSE",
      reitStatus: "CONFIRMED",
      requiresReitConfirmation: false,
    }));
    expect(results[1].requiresReitConfirmation).toBe(true);
    expect(isYahooB3Listing("PETR4.SA", "SAO")).toBe(true);
    expect(isYahooB3Listing("PBR", "NYQ")).toBe(false);
  });

  it("não oferece REIT confirmado na busca de ações internacionais", async () => {
    const client = yahooClient({
      search: vi.fn(async () => ({
        quotes: [
          {
            isYahooFinance: true,
            symbol: "O",
            quoteType: "EQUITY",
            exchange: "NYQ",
            sector: "Real Estate",
            industry: "REIT - Retail",
          },
          {
            isYahooFinance: true,
            symbol: "AAPL",
            quoteType: "EQUITY",
            exchange: "NMS",
            longname: "Apple Inc.",
            sector: "Technology",
          },
        ],
      })),
    });

    const results = await searchYahooTickers({ query: "a", kind: "INTERNATIONAL_STOCKS", client });

    expect(results.map((result) => result.symbol)).toEqual(["AAPL"]);
  });

  it("normaliza cotações em lote e busca câmbio de cada moeda para BRL", async () => {
    const client = yahooClient({
      quote: vi.fn(async (symbols: string[]) => Object.fromEntries(symbols.map((symbol) => {
        const prices: Record<string, number> = {
          AAPL: 250,
          "BRL=X": 5.25,
          "EURBRL=X": 6.15,
        };
        return [symbol, {
          symbol,
          quoteType: symbol.endsWith("=X") ? "CURRENCY" : "EQUITY",
          regularMarketPrice: prices[symbol],
          regularMarketTime: new Date("2026-07-23T18:00:00.000Z"),
          currency: symbol.endsWith("=X") ? "BRL" : "USD",
          exchange: symbol.endsWith("=X") ? "CCY" : "NMS",
          companyLogoUrl: symbol === "AAPL" ? "https://s.yimg.com/example/aapl.png" : undefined,
        }];
      }))),
    });

    const quotes = await fetchYahooQuotes({ symbols: ["aapl"], client });
    const rates = await fetchYahooFxRates({ currencies: ["USD", "EUR", "BRL"], client });

    expect(quotes).toEqual([expect.objectContaining({
      requestedSymbol: "AAPL",
      symbol: "AAPL",
      price: 250,
      currency: "USD",
      logoUrl: "https://s.yimg.com/example/aapl.png",
    })]);
    expect(rates).toEqual(expect.arrayContaining([
      expect.objectContaining({ currency: "USD", symbol: "BRL=X", rateToBrl: 5.25 }),
      expect.objectContaining({ currency: "EUR", symbol: "EURBRL=X", rateToBrl: 6.15 }),
      expect.objectContaining({ currency: "BRL", symbol: "BRL", rateToBrl: 1 }),
    ]));
    expect(yahooFxSymbol("USD")).toBe("BRL=X");
    expect(yahooFxSymbol("EUR")).toBe("EURBRL=X");
    expect(yahooFxSymbol("BRL")).toBeNull();
    expect(normalizeYahooCurrency("GBp")).toEqual({ currency: "GBP", priceScale: 0.01 });
    expect(normalizeYahooCurrency("GBP")).toEqual({ currency: "GBP", priceScale: 1 });
    expect(normalizeYahooCurrency("ILA")).toEqual({ currency: "ILS", priceScale: 0.01 });
  });

  it("traduz limite de requisições sem expor detalhes internos", async () => {
    const client = yahooClient({
      search: vi.fn(async () => {
        throw new Error("HTTP 429 Too Many Requests: cookie token");
      }),
    });

    await expect(searchYahooTickers({ query: "AAPL", kind: "INTERNATIONAL_STOCKS", client }))
      .rejects.toEqual(expect.objectContaining({
        name: "YahooFinanceApiError",
        message: "O limite temporário do Yahoo Finance foi atingido. Tente novamente em alguns minutos.",
      }));
  });

  it("preserva cotações válidas quando apenas parte do lote falha", async () => {
    const client = yahooClient({
      quote: vi.fn(async (symbols: string[]) => {
        if (symbols.length > 1 || symbols[0] === "INVALID") {
          throw new Error("Quote not found");
        }
        return {
          AAPL: {
            symbol: "AAPL",
            regularMarketPrice: 250,
            currency: "USD",
            quoteType: "EQUITY",
          },
        };
      }),
    });

    const quotes = await fetchAvailableYahooQuotes({ symbols: ["AAPL", "INVALID"], client });

    expect(quotes).toEqual([expect.objectContaining({ symbol: "AAPL", price: 250 })]);
  });

  it("busca o histórico diário em lote para congelar o câmbio", async () => {
    const chart = vi.fn(async () => ({
      quotes: [
        { date: new Date("2026-07-17T12:00:00.000Z"), close: 5.41 },
        { date: new Date("2026-07-20T12:00:00.000Z"), close: 5.47 },
        { date: new Date("2026-07-21T12:00:00.000Z"), close: null },
      ],
    }));
    const rates = await fetchYahooHistoricalFxRates({
      currency: "USD",
      period1: new Date("2026-07-17T00:00:00.000Z"),
      period2: new Date("2026-07-22T00:00:00.000Z"),
      client: yahooClient({ chart }),
    });
    expect(chart).toHaveBeenCalledOnce();
    expect(rates.map((rate) => [rate.rateDate.toISOString().slice(0, 10), rate.rateToBrl]))
      .toEqual([
        ["2026-07-17", 5.41],
        ["2026-07-20", 5.47],
      ]);
  });
});
