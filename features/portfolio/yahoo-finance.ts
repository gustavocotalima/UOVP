import YahooFinance from "yahoo-finance2";

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

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

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
};

const defaultYahooClient: YahooClient = {
  search: async (query, options) => yahooFinance.search(query, options),
  quote: async (symbols, options) => yahooFinance.quote(symbols, options),
  quoteSummary: async (symbol, options) => yahooFinance.quoteSummary(symbol, options),
};

export class YahooFinanceApiError extends Error {
  constructor(message: string, public readonly causeValue?: unknown) {
    super(message);
    this.name = "YahooFinanceApiError";
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
}: {
  query: string;
  kind: YahooSearchKind;
  client?: YahooClient;
}): Promise<YahooTickerSearchResult[]> {
  let result: Awaited<ReturnType<YahooClient["search"]>>;
  try {
    result = await client.search(query.trim(), { quotesCount: 20, newsCount: 0 });
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

  try {
    const quotes = await fetchAvailableYahooQuotes({
      symbols: candidates.map((candidate) => candidate.symbol),
      client,
    });
    const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    return candidates.map((candidate) => ({
      ...candidate,
      logoUrl: quoteBySymbol.get(candidate.symbol)?.logoUrl ?? null,
    }));
  } catch {
    return candidates;
  }
}

export async function fetchYahooAssetProfile({
  symbol,
  client = defaultYahooClient,
}: {
  symbol: string;
  client?: YahooClient;
}) {
  try {
    const result = await client.quoteSummary(normalizeYahooSymbol(symbol), { modules: ["assetProfile"] });
    return {
      sector: result.assetProfile?.sector ?? result.assetProfile?.sectorDisp ?? null,
      industry: result.assetProfile?.industry ?? result.assetProfile?.industryDisp ?? null,
    };
  } catch (error) {
    throw yahooError(error);
  }
}

export async function fetchYahooQuotes({
  symbols,
  client = defaultYahooClient,
}: {
  symbols: string[];
  client?: YahooClient;
}): Promise<YahooQuote[]> {
  const requestedSymbols = [...new Set(symbols.map(normalizeYahooSymbol).filter(Boolean))];
  if (!requestedSymbols.length) return [];

  let result: Awaited<ReturnType<YahooClient["quote"]>>;
  try {
    result = await client.quote(requestedSymbols, {
      return: "object",
      fields: [...YAHOO_QUOTE_FIELDS],
    });
  } catch (error) {
    throw yahooError(error);
  }

  return requestedSymbols.flatMap<YahooQuote>((requestedSymbol) => {
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
}

export async function fetchAvailableYahooQuotes({
  symbols,
  client = defaultYahooClient,
}: {
  symbols: string[];
  client?: YahooClient;
}): Promise<YahooQuote[]> {
  const unique = [...new Set(symbols.map(normalizeYahooSymbol).filter(Boolean))];
  if (!unique.length) return [];
  try {
    return await fetchYahooQuotes({ symbols: unique, client });
  } catch (error) {
    if (unique.length === 1) throw error;
    const middle = Math.ceil(unique.length / 2);
    const [left, right] = await Promise.allSettled([
      fetchAvailableYahooQuotes({ symbols: unique.slice(0, middle), client }),
      fetchAvailableYahooQuotes({ symbols: unique.slice(middle), client }),
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
}: {
  currencies: string[];
  client?: YahooClient;
}): Promise<YahooFxRate[]> {
  const normalizedCurrencies = [...new Set(currencies.map((currency) => currency.trim().toUpperCase()).filter(Boolean))];
  const symbols = normalizedCurrencies.flatMap((currency) => {
    const symbol = yahooFxSymbol(currency);
    return symbol ? [symbol] : [];
  });
  const quotes = await fetchAvailableYahooQuotes({ symbols, client });
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
