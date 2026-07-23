import { z } from "zod";

const BRAPI_QUOTE_URL = "https://brapi.dev/api/v2/stocks/quote";
const BRAPI_TICKERS_URL = "https://brapi.dev/api/v2/tickers";

const quoteResponseSchema = z.object({
  results: z.array(z.object({
    requestedSymbol: z.string(),
    symbol: z.string(),
    data: z.object({
      shortName: z.string().nullish(),
      longName: z.string().nullish(),
      currency: z.string().nullish(),
      regularMarketPrice: z.number().nullish(),
      regularMarketTime: z.string().nullish(),
      logourl: z.string().url().nullish(),
    }).passthrough(),
  }).passthrough()),
  requestedAt: z.string().nullish(),
}).passthrough();

const errorResponseSchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
}).passthrough();

const tickerSearchResponseSchema = z.object({
  results: z.array(z.object({
    symbol: z.string(),
    name: z.string().nullish(),
    longName: z.string().nullish(),
    assetType: z.string().nullish(),
    subType: z.string().nullish(),
    exchange: z.string().nullish(),
    currency: z.string().nullish(),
    logoUrl: z.string().url().nullish(),
    quote: z.object({
      lastPrice: z.number().nullish(),
    }).nullish(),
  }).passthrough()),
}).passthrough();

export type BrapiQuote = {
  requestedSymbol: string;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  logoUrl: string | null;
  asOf: Date;
};

export type BrapiTickerSearchResult = {
  symbol: string;
  name: string;
  assetType: string | null;
  subType: string | null;
  currency: string;
  lastPrice: number | null;
  logoUrl: string | null;
};

export class BrapiApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "BrapiApiError";
  }
}

export function isBrapiOddLotSymbol(ticker: string) {
  return /\dF$/.test(ticker.trim().toUpperCase().replace(/\.SA$/, ""));
}

export function normalizeBrapiSymbol(ticker: string) {
  return ticker.trim().toUpperCase().replace(/\.SA$/, "").replace(/(\d)F$/, "$1");
}

export async function searchBrapiTickers({
  query,
  subType,
  fetcher = fetch,
}: {
  query: string;
  subType?: string;
  fetcher?: typeof fetch;
}): Promise<BrapiTickerSearchResult[]> {
  const url = new URL(BRAPI_TICKERS_URL);
  url.searchParams.set("search", query.trim());
  url.searchParams.set("sortBy", "symbol");
  url.searchParams.set("sortOrder", "asc");
  url.searchParams.set("limit", "12");
  if (subType) url.searchParams.set("subType", subType);

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new BrapiApiError("Não foi possível conectar à brapi.", 0);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new BrapiApiError("Não foi possível buscar tickers na brapi.", response.status);
  const parsed = tickerSearchResponseSchema.safeParse(payload);
  if (!parsed.success) throw new BrapiApiError("A brapi retornou uma lista de tickers inválida.", 502);

  const normalizedQuery = normalizeBrapiSymbol(query);
  return parsed.data.results.filter((result) => !isBrapiOddLotSymbol(result.symbol)).map((result) => ({
    symbol: normalizeBrapiSymbol(result.symbol),
    name: result.longName || result.name || result.symbol,
    assetType: result.assetType ?? null,
    subType: result.subType ?? null,
    currency: result.currency?.toUpperCase() || "BRL",
    lastPrice: result.quote?.lastPrice ?? null,
    logoUrl: result.logoUrl ?? null,
  })).sort((left, right) => {
    const relevance = (symbol: string) => symbol === normalizedQuery ? 0 : symbol.startsWith(normalizedQuery) ? 1 : 2;
    return relevance(left.symbol) - relevance(right.symbol) || left.symbol.localeCompare(right.symbol);
  });
}

export async function searchBrapiEtfTickers({
  query,
  fetcher = fetch,
}: {
  query: string;
  fetcher?: typeof fetch;
}) {
  const typed = await searchBrapiTickers({ query, subType: "etf", fetcher });
  const exactSymbol = normalizeBrapiSymbol(query);
  if (typed.some((item) => item.symbol === exactSymbol)) return typed;
  const fallback = await searchBrapiTickers({ query, fetcher });
  const exactFallback = fallback.filter((item) => item.symbol === exactSymbol && item.assetType === "fund");
  return [...typed, ...exactFallback]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.symbol === item.symbol) === index)
    .slice(0, 12);
}

function dateOrFallback(value: string | null | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function errorMessage(status: number) {
  if (status === 401) return "A chave da brapi é inválida ou expirou.";
  if (status === 403) return "Seu plano da brapi não permite consultar essas cotações.";
  if (status === 404) return "A brapi não encontrou um ou mais tickers informados.";
  if (status === 429) return "O limite de requisições da brapi foi atingido. Tente novamente mais tarde.";
  if (status >= 500) return "A brapi está indisponível no momento. Tente novamente mais tarde.";
  return "Não foi possível consultar as cotações na brapi.";
}

export async function fetchBrapiQuotes({
  apiKey,
  tickers,
  fetcher = fetch,
}: {
  apiKey: string;
  tickers: string[];
  fetcher?: typeof fetch;
}) {
  const symbols = [...new Set(tickers.map(normalizeBrapiSymbol).filter(Boolean))];
  if (!symbols.length) return [];

  const url = new URL(BRAPI_QUOTE_URL);
  url.searchParams.set("symbols", symbols.join(","));

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BrapiApiError("Não foi possível conectar à brapi.", 0);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const details = errorResponseSchema.safeParse(payload);
    throw new BrapiApiError(errorMessage(response.status), response.status, details.success ? details.data.code : undefined);
  }

  const parsed = quoteResponseSchema.safeParse(payload);
  if (!parsed.success) throw new BrapiApiError("A brapi retornou uma resposta inválida.", 502);
  const requestedAt = dateOrFallback(parsed.data.requestedAt, new Date());

  return parsed.data.results.flatMap<BrapiQuote>((result) => {
    const price = result.data.regularMarketPrice;
    if (price == null || !Number.isFinite(price) || price < 0) return [];
    return [{
      requestedSymbol: normalizeBrapiSymbol(result.requestedSymbol),
      symbol: normalizeBrapiSymbol(result.symbol),
      name: result.data.longName || result.data.shortName || result.symbol,
      price,
      currency: result.data.currency?.toUpperCase() || "BRL",
      logoUrl: result.data.logourl ?? null,
      asOf: dateOrFallback(result.data.regularMarketTime, requestedAt),
    }];
  });
}

export async function fetchAvailableBrapiQuotes({
  apiKey,
  tickers,
  fetcher = fetch,
}: {
  apiKey: string;
  tickers: string[];
  fetcher?: typeof fetch;
}): Promise<BrapiQuote[]> {
  const symbols = [...new Set(tickers.map(normalizeBrapiSymbol).filter(Boolean))];

  async function fetchGroup(group: string[]): Promise<BrapiQuote[]> {
    if (!group.length) return [];
    try {
      return await fetchBrapiQuotes({ apiKey, tickers: group, fetcher });
    } catch (error) {
      const recoverable = error instanceof BrapiApiError && (error.status === 400 || error.status === 404);
      if (!recoverable) throw error;
      if (group.length === 1) return [];
      const middle = Math.ceil(group.length / 2);
      const left = await fetchGroup(group.slice(0, middle));
      const right = await fetchGroup(group.slice(middle));
      return [...left, ...right];
    }
  }

  return fetchGroup(symbols);
}
