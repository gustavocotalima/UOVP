import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ search: vi.fn(), quote: vi.fn(), quoteSummary: vi.fn(), chart: vi.fn() }));
vi.mock("yahoo-finance2", () => ({
  default: class { search = sdk.search; quote = sdk.quote; quoteSummary = sdk.quoteSummary; chart = sdk.chart; },
}));
vi.mock("@/lib/shared-cache", () => ({
  isSharedCacheConfigured: () => false,
  sharedCacheKey: (...parts: unknown[]) => JSON.stringify(parts),
  getSharedCache: vi.fn(), getSharedCacheMany: vi.fn(), setSharedCache: vi.fn(), setSharedCacheMany: vi.fn(), withSharedCacheCoalescing: vi.fn(),
}));

import {
  fetchAvailableYahooQuotes, fetchYahooAssetProfile, fetchYahooHistoricalFxRates,
  fetchYahooQuotes, searchYahooTickers, type YahooClient,
} from "@/features/portfolio/yahoo-finance";

function client(overrides: Partial<YahooClient> = {}): YahooClient {
  return {
    search: vi.fn(async () => ({ quotes: [] })),
    quote: vi.fn(async () => ({})),
    quoteSummary: vi.fn(async () => ({ assetProfile: undefined })),
    ...overrides,
  };
}

function validQuotes(symbols: string[]) {
  return Object.fromEntries(symbols.map((symbol) => [symbol, { symbol, regularMarketPrice: 10, currency: "USD" }]));
}

describe("orçamento e cancelamento das consultas Yahoo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.search.mockResolvedValue({ quotes: [] });
    sdk.quote.mockResolvedValue(validQuotes(["AAPL"]));
    sdk.quoteSummary.mockResolvedValue({ assetProfile: { sector: "Technology" } });
    sdk.chart.mockResolvedValue({ quotes: [] });
  });
  afterEach(() => { vi.useRealTimers(); });

  it.each([429, 500, 503])("não subdivide falha global HTTP %s, mesmo com texto de ticker", async (code) => {
    const quote = vi.fn<YahooClient["quote"]>(async () => { throw Object.assign(new Error("Quote not found"), { code }); });
    await expect(fetchAvailableYahooQuotes({ symbols: ["AAPL", "MSFT", "KO"], client: client({ quote }) })).rejects.toThrow();
    expect(quote).toHaveBeenCalledOnce();
  });

  it("não subdivide falhas de transporte", async () => {
    const quote = vi.fn<YahooClient["quote"]>(async () => { throw new TypeError("fetch failed"); });
    await expect(fetchAvailableYahooQuotes({ symbols: ["AAPL", "MSFT"], client: client({ quote }) })).rejects.toThrow();
    expect(quote).toHaveBeenCalledOnce();
  });

  it("recupera símbolos válidos com no máximo dois workers", async () => {
    let active = 0;
    let maximum = 0;
    const symbols = Array.from({ length: 64 }, (_, index) => index === 31 ? "INVALID" : `S${index}`);
    const quote = vi.fn<YahooClient["quote"]>(async (group) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      if (group.includes("INVALID")) throw new Error("Quote not found");
      return validQuotes(group);
    });
    const result = await fetchAvailableYahooQuotes({ symbols, client: client({ quote }) });
    expect(result.map((entry) => entry.symbol)).toEqual(symbols.filter((symbol) => symbol !== "INVALID"));
    expect(maximum).toBe(2);
    expect(quote.mock.calls.length).toBeLessThanOrEqual(32);
  });

  it("limita o número total de tentativas em um lote inteiramente inválido", async () => {
    const quote = vi.fn<YahooClient["quote"]>(async () => { throw new Error("Quote not found"); });
    await expect(fetchAvailableYahooQuotes({ symbols: Array.from({ length: 256 }, (_, index) => `INVALID${index}`), client: client({ quote }) }))
      .rejects.toThrow("limite de tentativas");
    expect(quote.mock.calls.length).toBeGreaterThan(1);
    expect(quote.mock.calls.length).toBeLessThanOrEqual(32);
  });

  it("timeout por chamada aborta o sinal passado ao SDK e não inicia fallback", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const quote = vi.fn<YahooClient["quote"]>((_symbols, _options, request) => {
      requestSignal = request?.fetchOptions.signal;
      return new Promise(() => undefined);
    });
    const operation = fetchAvailableYahooQuotes({ symbols: ["AAPL", "MSFT"], client: client({ quote }) });
    const assertion = expect(operation).rejects.toThrow("demorou demais");
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
    expect(requestSignal?.aborted).toBe(true);
    expect(quote).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("o prazo total cancela workers mesmo quando cada chamada individual cabe no prazo", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const quote = vi.fn<YahooClient["quote"]>((symbols, _options, request) => {
      if (symbols.length === 256) return Promise.reject(new Error("Quote not found"));
      const signal = request!.fetchOptions.signal;
      signals.push(signal);
      return new Promise((_, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          reject(new Error("Quote not found"));
        }, 9_000);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    });
    const operation = fetchAvailableYahooQuotes({ symbols: Array.from({ length: 256 }, (_, index) => `S${index}`), client: client({ quote }) });
    const assertion = expect(operation).rejects.toThrow("prazo total");
    await vi.advanceTimersByTimeAsync(30_001);
    await assertion;
    expect(signals.slice(-2).every((signal) => signal.aborted)).toBe(true);
    const calls = quote.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(quote).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancelamento do chamador chega ao SDK e impede novas tentativas", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const quote = vi.fn<YahooClient["quote"]>((_symbols, _options, request) => {
      requestSignal = request?.fetchOptions.signal;
      return new Promise(() => undefined);
    });
    const reason = new Error("Lease perdido");
    const operation = fetchAvailableYahooQuotes({ symbols: ["AAPL", "MSFT"], signal: controller.signal, client: client({ quote }) });
    const assertion = expect(operation).rejects.toBe(reason);
    await vi.waitFor(() => expect(quote).toHaveBeenCalledOnce());
    controller.abort(reason);
    await assertion;
    expect(requestSignal?.aborted).toBe(true);
    expect(quote).toHaveBeenCalledOnce();
  });

  it("não chama o SDK se o sinal já estiver cancelado", async () => {
    const controller = new AbortController();
    const reason = new Error("Cancelado antes da consulta");
    controller.abort(reason);
    const quote = vi.fn<YahooClient["quote"]>(async () => ({}));
    await expect(fetchAvailableYahooQuotes({ symbols: ["AAPL"], signal: controller.signal, client: client({ quote }) })).rejects.toBe(reason);
    expect(quote).not.toHaveBeenCalled();
  });

  it("encaminha o sinal no terceiro argumento dos métodos do adaptador padrão", async () => {
    await searchYahooTickers({ query: "AAPL", kind: "INTERNATIONAL_STOCKS" });
    await fetchYahooQuotes({ symbols: ["AAPL"] });
    await fetchYahooAssetProfile({ symbol: "AAPL" });
    await fetchYahooHistoricalFxRates({ currency: "USD", period1: new Date("2026-10-01"), period2: new Date("2026-10-21") });
    for (const method of [sdk.search, sdk.quote, sdk.quoteSummary, sdk.chart]) {
      expect(method).toHaveBeenCalledOnce();
      expect(method.mock.calls[0][2].fetchOptions.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
