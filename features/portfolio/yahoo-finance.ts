import YahooFinance from "yahoo-finance2";
import { z } from "zod";
import {
  getSharedCache,
  getSharedCacheMany,
  isSharedCacheConfigured,
  setSharedCache,
  setSharedCacheMany,
  sharedCacheKey,
  withSharedCacheCoalescing,
  type MarketCacheMode,
} from "@/lib/shared-cache";

export type YahooSearchKind = "INTERNATIONAL_STOCKS" | "REITS" | "ETF";
export type YahooReitStatus = "CONFIRMED" | "POSSIBLE" | "AMBIGUOUS" | "CONTRADICTED";

export type YahooTickerSearchResult = {
  symbol: string;
  name: string;
  logoUrl: string | null;
  quoteType: "EQUITY" | "ETF";
  exchange: string;
  currency: string | null;
  sector: string | null;
  industry: string | null;
  reitStatus: YahooReitStatus;
  requiresReitConfirmation: boolean;
};

export type YahooQuote = {
  requestedSymbol: string;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  exchange: string | null;
  quoteType: string | null;
  logoUrl: string | null;
  asOf: Date;
};

export type YahooFxRate = {
  currency: string;
  symbol: string;
  rateToBrl: number;
  asOf: Date;
};

export type YahooHistoricalFxRate = {
  currency: string;
  symbol: string;
  rateToBrl: number;
  rateDate: Date;
};

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const YAHOO_TIMEOUT_MS = 15_000;

type YahooSearchCandidate = {
  isYahooFinance?: boolean;
  quoteType?: string;
  symbol?: string;
  exchange?: string;
  exchDisp?: string;
  shortname?: string;
  longname?: string;
  sector?: string;
  sectorDisp?: string;
  industry?: string;
  industryDisp?: string;
};

type YahooQuoteCandidate = {
  symbol?: string;
  longName?: string;
  shortName?: string;
  regularMarketPrice?: number;
  regularMarketTime?: Date;
  currency?: string;
  exchange?: string;
  quoteType?: string;
  companyLogoUrl?: string;
  logoUrl?: string;
};

const YAHOO_QUOTE_FIELDS = [
  "symbol",
  "longName",
  "shortName",
  "regularMarketPrice",
  "regularMarketTime",
  "currency",
  "exchange",
  "quoteType",
  "companyLogoUrl",
  "logoUrl",
] as const;
const cachedYahooSearchSchema = z.array(z.object({
  symbol: z.string(),
  name: z.string(),
  logoUrl: z.string().url().nullable(),
  quoteType: z.enum(["EQUITY", "ETF"]),
  exchange: z.string(),
  currency: z.string().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  reitStatus: z.enum(["CONFIRMED", "POSSIBLE", "AMBIGUOUS", "CONTRADICTED"]),
  requiresReitConfirmation: z.boolean(),
}));
const cachedYahooQuoteSchema = z.object({
  requestedSymbol: z.string(),
  symbol: z.string(),
  name: z.string(),
  price: z.number().positive(),
  currency: z.string(),
  exchange: z.string().nullable(),
  quoteType: z.string().nullable(),
  logoUrl: z.string().url().nullable(),
  asOf: z.string().datetime(),
});
const cachedYahooProfileSchema = z.object({
  sector: z.string().nullable(),
  industry: z.string().nullable(),
});

export type YahooClient = {
  search(query: string, options: { quotesCount: number; newsCount: number }): Promise<{ quotes: YahooSearchCandidate[] }>;
  quote(symbols: string[], options: {
    return: "object";
    fields: Array<(typeof YAHOO_QUOTE_FIELDS)[number]>;
  }): Promise<Record<string, YahooQuoteCandidate>>;
  quoteSummary(symbol: string, options: { modules: ["assetProfile"] }): Promise<{
    assetProfile?: {
      sector?: string;
      sectorDisp?: string;
      industry?: string;
      industryDisp?: string;
    };
  }>;
  chart?(symbol: string, options: {
    period1: Date;
    period2: Date;
    interval: "1d";
    events: "history";
  }): Promise<{
    quotes: Array<{
      date: Date;
      close: number | null;
    }>;
  }>;
};

const defaultYahooClient: YahooClient = {
  search: async (query, options) => yahooFinance.search(query, options),
  quote: async (symbols, options) => yahooFinance.quote(symbols, options),
  quoteSummary: async (symbol, options) => yahooFinance.quoteSummary(symbol, options),
  chart: async (symbol, options) => yahooFinance.chart(symbol, options),
};

export class YahooFinanceApiError extends Error {
  constructor(message: string, public readonly causeValue?: unknown) {
    super(message);
    this.name = "YahooFinanceApiError";
  }
}

async function withYahooTimeout<T>(operation: Promise<T>, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Operação cancelada.", "AbortError");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new YahooFinanceApiError("O Yahoo Finance demorou demais para responder. Tente novamente."));
        }, YAHOO_TIMEOUT_MS);
      }),
      ...(signal
        ? [new Promise<never>((_, reject) => {
            abortListener = () => reject(signal.reason ?? new DOMException("Operação cancelada.", "AbortError"));
            signal.addEventListener("abort", abortListener, { once: true });
          })]
        : []),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedMetadata(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function safeYahooLogoUrl(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && url.hostname === "s.yimg.com") return url.href;
    } catch {
      // Ignore malformed or provider-untrusted image URLs.
    }
  }
  return null;
}

export function normalizeYahooSymbol(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeYahooCurrency(value: string | null | undefined) {
  const raw = value?.trim() || "USD";
  if (raw === "GBp" || raw.toUpperCase() === "GBX") {
    return { currency: "GBP", priceScale: 0.01 };
  }
  if (raw === "ZAc" || raw.toUpperCase() === "ZAC") {
    return { currency: "ZAR", priceScale: 0.01 };
  }
  if (raw.toUpperCase() === "ILA") {
    return { currency: "ILS", priceScale: 0.01 };
  }
  return { currency: raw.toUpperCase(), priceScale: 1 };
}

export function isYahooB3Listing(symbol: string, exchange?: string | null) {
  const normalizedExchange = normalizedMetadata(exchange);
  return normalizeYahooSymbol(symbol).endsWith(".SA")
    || ["B3", "SAO", "SAO PAULO", "SAO PAULO STOCK EXCHANGE"].includes(normalizedExchange);
}

export function classifyYahooReitMetadata({
  sector,
  industry,
}: {
  sector?: string | null;
  industry?: string | null;
}): YahooReitStatus {
  const normalizedSector = normalizedMetadata(sector);
  const normalizedIndustry = normalizedMetadata(industry);
  if (/\bREIT\b/.test(normalizedIndustry)) return "CONFIRMED";
  if (normalizedSector === "REAL ESTATE" || normalizedIndustry.includes("REAL ESTATE")) return "POSSIBLE";
  if (normalizedSector || normalizedIndustry) return "CONTRADICTED";
  return "AMBIGUOUS";
}

function yahooError(error: unknown) {
  if (error instanceof YahooFinanceApiError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/\b429\b|too many|rate.?limit/i.test(message)) {
    return new YahooFinanceApiError("O limite temporário do Yahoo Finance foi atingido. Tente novamente em alguns minutos.", error);
  }
  if (/not found|no fundamentals|quote not found/i.test(message)) {
    return new YahooFinanceApiError("O Yahoo Finance não encontrou esse ticker.", error);
  }
  return new YahooFinanceApiError("Não foi possível consultar o Yahoo Finance.", error);
}

export async function searchYahooTickers({
  query,
  kind,
  client = defaultYahooClient,
  signal,
  cacheMode = "USE_CACHE",
}: {
  query: string;
  kind: YahooSearchKind;
  client?: YahooClient;
  signal?: AbortSignal;
  cacheMode?: MarketCacheMode;
}): Promise<YahooTickerSearchResult[]> {
  const normalizedQuery = query.trim().toUpperCase();
  const useSharedCache = client === defaultYahooClient && isSharedCacheConfigured();
  const cacheKey = sharedCacheKey("yahoo:search", normalizedQuery, kind);
  const readCached = async (minimumCachedAt = 0) => {
    const hit = await getSharedCache(cacheKey, (value) => {
      const parsed = cachedYahooSearchSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    });
    return hit && hit.cachedAt >= minimumCachedAt ? hit.value : null;
  };
  if (useSharedCache && cacheMode === "USE_CACHE") {
    const cached = await readCached();
    if (cached) return cached;
  }

  const startedAt = Date.now();
  const load = async () => {
    let result: Awaited<ReturnType<YahooClient["search"]>>;
    try {
      result = await withYahooTimeout(
        client.search(query.trim(), { quotesCount: 20, newsCount: 0 }),
        signal,
      );
    } catch (error) {
      throw yahooError(error);
    }

    const candidates = result.quotes.flatMap<YahooTickerSearchResult>((candidate) => {
      if (candidate.isYahooFinance !== true || !candidate.symbol) return [];
      if (candidate.quoteType !== "EQUITY" && candidate.quoteType !== "ETF") return [];
      if (isYahooB3Listing(candidate.symbol, candidate.exchange)) return [];
      if (kind === "ETF" && candidate.quoteType !== "ETF") return [];
      if (kind !== "ETF" && candidate.quoteType !== "EQUITY") return [];

      const sector = text(candidate.sector) || text(candidate.sectorDisp) || null;
      const industry = text(candidate.industry) || text(candidate.industryDisp) || null;
      const reitStatus = classifyYahooReitMetadata({ sector, industry });
      if (kind === "REITS" && reitStatus === "CONTRADICTED") return [];
      if (kind === "INTERNATIONAL_STOCKS" && reitStatus === "CONFIRMED") return [];

      return [{
        symbol: normalizeYahooSymbol(candidate.symbol),
        name: text(candidate.longname) || text(candidate.shortname) || candidate.symbol,
        logoUrl: null,
        quoteType: candidate.quoteType,
        exchange: text(candidate.exchDisp) || text(candidate.exchange),
        currency: null,
        sector,
        industry,
        reitStatus,
        requiresReitConfirmation: kind === "REITS" && reitStatus !== "CONFIRMED",
      }];
    }).filter((candidate, index, all) =>
      all.findIndex((item) => item.symbol === candidate.symbol) === index,
    ).slice(0, 12);

    let results = candidates;
    try {
      const quotes = await fetchAvailableYahooQuotes({
        symbols: candidates.map((candidate) => candidate.symbol),
        client,
        signal,
        cacheMode,
      });
      const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
      results = candidates.map((candidate) => ({
        ...candidate,
        logoUrl: quoteBySymbol.get(candidate.symbol)?.logoUrl ?? null,
      }));
    } catch {
      results = candidates;
    }
    if (useSharedCache) await setSharedCache(cacheKey, results, 60 * 60, startedAt);
    return results;
  };

  if (!useSharedCache) return load();
  return withSharedCacheCoalescing({
    key: sharedCacheKey("yahoo:search-flight", normalizedQuery, kind),
    operation: load,
    readAfterWait: (lockStartedAt) => readCached(cacheMode === "REFRESH" ? lockStartedAt : 0),
  });
}

export async function fetchYahooAssetProfile({
  symbol,
  client = defaultYahooClient,
  signal,
  cacheMode = "USE_CACHE",
}: {
  symbol: string;
  client?: YahooClient;
  signal?: AbortSignal;
  cacheMode?: MarketCacheMode;
}) {
  const normalizedSymbol = normalizeYahooSymbol(symbol);
  const useSharedCache = client === defaultYahooClient && isSharedCacheConfigured();
  const cacheKey = sharedCacheKey("yahoo:profile", normalizedSymbol);
  const readCached = async (minimumCachedAt = 0) => {
    const hit = await getSharedCache(cacheKey, (value) => {
      const parsed = cachedYahooProfileSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    });
    return hit && hit.cachedAt >= minimumCachedAt ? hit.value : null;
  };
  if (useSharedCache && cacheMode === "USE_CACHE") {
    const cached = await readCached();
    if (cached) return cached;
  }
  const startedAt = Date.now();
  const load = async () => {
    try {
      const result = await withYahooTimeout(
        client.quoteSummary(normalizedSymbol, { modules: ["assetProfile"] }),
        signal,
      );
      const profile = {
        sector: result.assetProfile?.sector ?? result.assetProfile?.sectorDisp ?? null,
        industry: result.assetProfile?.industry ?? result.assetProfile?.industryDisp ?? null,
      };
      if (useSharedCache) await setSharedCache(cacheKey, profile, undefined, startedAt);
      return profile;
    } catch (error) {
      throw yahooError(error);
    }
  };
  if (!useSharedCache) return load();
  return withSharedCacheCoalescing({
    key: sharedCacheKey("yahoo:profile-flight", normalizedSymbol),
    operation: load,
    readAfterWait: (lockStartedAt) => readCached(cacheMode === "REFRESH" ? lockStartedAt : 0),
  });
}

export async function fetchYahooQuotes({
  symbols,
  client = defaultYahooClient,
  signal,
  cacheMode = "USE_CACHE",
}: {
  symbols: string[];
  client?: YahooClient;
  signal?: AbortSignal;
  cacheMode?: MarketCacheMode;
}): Promise<YahooQuote[]> {
  const requestedSymbols = [...new Set(symbols.map(normalizeYahooSymbol).filter(Boolean))];
  if (!requestedSymbols.length) return [];
  const useSharedCache = client === defaultYahooClient && isSharedCacheConfigured();
  const keysBySymbol = new Map(requestedSymbols.map((symbol) => [
    symbol,
    sharedCacheKey("yahoo:quote", symbol),
  ]));
  const decodeQuote = (value: unknown) => {
    const parsed = cachedYahooQuoteSchema.safeParse(value);
    return parsed.success ? { ...parsed.data, asOf: new Date(parsed.data.asOf) } : null;
  };
  const readCached = async (requested: string[], minimumCachedAt = 0) => {
    const hits = await getSharedCacheMany(
      requested.map((symbol) => keysBySymbol.get(symbol)!),
      decodeQuote,
    );
    return new Map(requested.flatMap((symbol) => {
      const hit = hits.get(keysBySymbol.get(symbol)!);
      return hit && hit.cachedAt >= minimumCachedAt ? [[symbol, hit.value] as const] : [];
    }));
  };
  const cached = useSharedCache && cacheMode === "USE_CACHE"
    ? await readCached(requestedSymbols)
    : new Map<string, YahooQuote>();
  const missing = requestedSymbols.filter((symbol) => !cached.has(symbol));
  if (!missing.length) return requestedSymbols.flatMap((symbol) => cached.get(symbol) ?? []);

  const startedAt = Date.now();
  const load = async () => {
    let result: Awaited<ReturnType<YahooClient["quote"]>>;
    try {
      result = await withYahooTimeout(
        client.quote(missing, {
          return: "object",
          fields: [...YAHOO_QUOTE_FIELDS],
        }),
        signal,
      );
    } catch (error) {
      throw yahooError(error);
    }

    const fetched = missing.flatMap<YahooQuote>((requestedSymbol) => {
      const quote = result[requestedSymbol];
      const price = quote?.regularMarketPrice;
      if (price == null || !Number.isFinite(price) || price <= 0) return [];
      const normalizedCurrency = normalizeYahooCurrency(quote.currency);
      return [{
        requestedSymbol,
        symbol: normalizeYahooSymbol(quote.symbol || requestedSymbol),
        name: quote.longName || quote.shortName || requestedSymbol,
        price: price * normalizedCurrency.priceScale,
        currency: normalizedCurrency.currency,
        exchange: quote.exchange || null,
        quoteType: quote.quoteType || null,
        logoUrl: safeYahooLogoUrl(quote.companyLogoUrl, quote.logoUrl),
        asOf: quote.regularMarketTime instanceof Date ? quote.regularMarketTime : new Date(),
      }];
    });
    if (useSharedCache) {
      await setSharedCacheMany(fetched.map((quote) => ({
        key: keysBySymbol.get(quote.requestedSymbol)!,
        value: { ...quote, asOf: quote.asOf.toISOString() },
        cachedAt: startedAt,
      })));
    }
    return new Map(fetched.map((quote) => [quote.requestedSymbol, quote]));
  };

  const fetched = !useSharedCache
    ? await load()
    : await withSharedCacheCoalescing({
        key: sharedCacheKey("yahoo:quote-flight", missing.slice().sort()),
        operation: load,
        readAfterWait: async (lockStartedAt) => {
          const waited = await readCached(missing, cacheMode === "REFRESH" ? lockStartedAt : 0);
          return waited.size === missing.length ? waited : null;
        },
      });
  return requestedSymbols.flatMap((symbol) => cached.get(symbol) ?? fetched.get(symbol) ?? []);
}

export async function fetchAvailableYahooQuotes({
  symbols,
  client = defaultYahooClient,
  signal,
  cacheMode = "USE_CACHE",
}: {
  symbols: string[];
  client?: YahooClient;
  signal?: AbortSignal;
  cacheMode?: MarketCacheMode;
}): Promise<YahooQuote[]> {
  const unique = [...new Set(symbols.map(normalizeYahooSymbol).filter(Boolean))];
  if (!unique.length) return [];
  try {
    return await fetchYahooQuotes({ symbols: unique, client, signal, cacheMode });
  } catch (error) {
    if (unique.length === 1) throw error;
    const middle = Math.ceil(unique.length / 2);
    const [left, right] = await Promise.allSettled([
      fetchAvailableYahooQuotes({ symbols: unique.slice(0, middle), client, signal, cacheMode }),
      fetchAvailableYahooQuotes({ symbols: unique.slice(middle), client, signal, cacheMode }),
    ]);
    const available = [
      ...(left.status === "fulfilled" ? left.value : []),
      ...(right.status === "fulfilled" ? right.value : []),
    ];
    if (!available.length) throw error;
    return available;
  }
}

export function yahooFxSymbol(currency: string) {
  const normalized = currency.trim().toUpperCase();
  if (normalized === "BRL") return null;
  if (normalized === "USD") return "BRL=X";
  return `${normalized}BRL=X`;
}

export async function fetchYahooFxRates({
  currencies,
  client = defaultYahooClient,
  signal,
  cacheMode = "USE_CACHE",
}: {
  currencies: string[];
  client?: YahooClient;
  signal?: AbortSignal;
  cacheMode?: MarketCacheMode;
}): Promise<YahooFxRate[]> {
  const normalizedCurrencies = [...new Set(currencies.map((currency) => currency.trim().toUpperCase()).filter(Boolean))];
  const symbols = normalizedCurrencies.flatMap((currency) => {
    const symbol = yahooFxSymbol(currency);
    return symbol ? [symbol] : [];
  });
  const quotes = await fetchAvailableYahooQuotes({ symbols, client, signal, cacheMode });
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.requestedSymbol, quote]));
  return normalizedCurrencies.flatMap<YahooFxRate>((currency) => {
    if (currency === "BRL") {
      return [{ currency, symbol: "BRL", rateToBrl: 1, asOf: new Date() }];
    }
    const symbol = yahooFxSymbol(currency)!;
    const quote = quoteBySymbol.get(symbol);
    return quote
      ? [{ currency, symbol, rateToBrl: quote.price, asOf: quote.asOf }]
      : [];
  });
}

export async function fetchYahooHistoricalFxRates({
  currency,
  period1,
  period2,
  client = defaultYahooClient,
  signal,
}: {
  currency: string;
  period1: Date;
  period2: Date;
  client?: YahooClient;
  signal?: AbortSignal;
}): Promise<YahooHistoricalFxRate[]> {
  const normalizedCurrency = currency.trim().toUpperCase();
  if (normalizedCurrency === "BRL") {
    return [{
      currency: "BRL",
      symbol: "BRL",
      rateToBrl: 1,
      rateDate: new Date(Date.UTC(
        period1.getUTCFullYear(),
        period1.getUTCMonth(),
        period1.getUTCDate(),
      )),
    }];
  }
  const symbol = yahooFxSymbol(normalizedCurrency);
  if (!symbol || !client.chart) return [];
  try {
    const result = await withYahooTimeout(
      client.chart(symbol, {
        period1,
        period2,
        interval: "1d",
        events: "history",
      }),
      signal,
    );
    return result.quotes.flatMap<YahooHistoricalFxRate>((quote) => {
      if (quote.close == null || !Number.isFinite(quote.close) || quote.close <= 0) return [];
      return [{
        currency: normalizedCurrency,
        symbol,
        rateToBrl: quote.close,
        rateDate: new Date(Date.UTC(
          quote.date.getUTCFullYear(),
          quote.date.getUTCMonth(),
          quote.date.getUTCDate(),
        )),
      }];
    });
  } catch (error) {
    throw yahooError(error);
  }
}
