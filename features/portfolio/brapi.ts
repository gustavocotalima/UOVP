import { createHash } from "node:crypto";
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
import { usableBrapiLogoUrl } from "./market-logo";
import { BRAPI_PLAN_LIMITS, normalizeBrapiPlan, type BrapiPlan } from "./brapi-plans";

const BRAPI_QUOTE_URL = "https://brapi.dev/api/v2/stocks/quote";
const BRAPI_TICKERS_URL = "https://brapi.dev/api/v2/tickers";
type QuoteRequestQueue = {
  active: Map<symbol, number>;
  pending: Array<{ concurrency: number; start: (release: () => void) => void }>;
};
const quoteRequestQueues = new Map<string, QuoteRequestQueue>();

function drainQuoteRequestQueue(key: string, queue: QuoteRequestQueue) {
  while (queue.pending.length) {
    const next = queue.pending[0];
    const limit = Math.min(next.concurrency, ...queue.active.values());
    if (queue.active.size >= limit) return;
    queue.pending.shift();
    const token = Symbol();
    queue.active.set(token, next.concurrency);
    next.start(() => {
      queue.active.delete(token);
      if (!queue.active.size && !queue.pending.length) quoteRequestQueues.delete(key);
      else drainQuoteRequestQueue(key, queue);
    });
  }
}

function withQuoteRequestQueue<T>(apiKey: string, concurrency: number, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  // Share capacity across callers in this process without retaining raw keys.
  // If a tier changes during a request, honor the more conservative limit.
  const key = createHash("sha256").update(apiKey).digest("hex");
  const queue: QuoteRequestQueue = quoteRequestQueues.get(key) ?? { active: new Map(), pending: [] };
  quoteRequestQueues.set(key, queue);
  return new Promise<T>((resolve, reject) => {
    queue.pending.push({
      concurrency,
      start: (release) => {
        void Promise.resolve().then(() => {
          signal?.throwIfAborted();
          return operation();
        }).then(resolve, reject).finally(release);
      },
    });
    drainQuoteRequestQueue(key, queue);
  });
}

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
const cachedTickerSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  assetType: z.string().nullable(),
  subType: z.string().nullable(),
  currency: z.string(),
  lastPrice: z.number().nullable(),
  logoUrl: z.string().url().nullable(),
});
const cachedTickerSearchSchema = z.array(cachedTickerSchema);
const cachedQuoteSchema = z.object({
  requestedSymbol: z.string(),
  symbol: z.string(),
  name: z.string(),
  price: z.number().positive(),
  currency: z.string(),
  logoUrl: z.string().url().nullable(),
  asOf: z.string().datetime(),
});

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

export type CachedBrapiQuote = {
  quote: BrapiQuote;
  cachedAt: Date;
};

function decodeCachedQuote(value: unknown) {
  const parsed = cachedQuoteSchema.safeParse(value);
  return parsed.success ? { ...parsed.data, asOf: new Date(parsed.data.asOf) } : null;
}

export async function readCachedBrapiQuotes(tickers: string[]) {
  const symbols = [...new Set(tickers.map(normalizeBrapiSymbol).filter(Boolean))];
  const keysBySymbol = new Map(symbols.map((symbol) => [
    symbol,
    sharedCacheKey("brapi:quote", symbol),
  ]));
  const hits = await getSharedCacheMany([...keysBySymbol.values()], decodeCachedQuote);
  return new Map<string, CachedBrapiQuote>(symbols.flatMap((symbol) => {
    const hit = hits.get(keysBySymbol.get(symbol)!);
    return hit
      ? [[symbol, { quote: hit.value, cachedAt: new Date(hit.cachedAt) }] as const]
      : [];
  }));
}

export function preferredBrapiLogoUrl({
  metadataLogoUrl,
  existingLogoUrl,
}: {
  metadataLogoUrl: string | null | undefined;
  quoteLogoUrl: string | null | undefined;
  existingLogoUrl: string | null | undefined;
}) {
  return usableBrapiLogoUrl(metadataLogoUrl)
    ?? usableBrapiLogoUrl(existingLogoUrl)
    ?? null;
}

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
  signal,
  cacheMode = "USE_CACHE",
}: {
  query: string;
  subType?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  cacheMode?: MarketCacheMode;
}): Promise<BrapiTickerSearchResult[]> {
  const normalizedQuery = normalizeBrapiSymbol(query);
  const useSharedCache = fetcher === fetch && isSharedCacheConfigured();
  const cacheKey = sharedCacheKey("brapi:search", normalizedQuery, subType ?? null);
  const readCached = async (minimumCachedAt = 0) => {
    const hit = await getSharedCache(cacheKey, (value) => {
      const parsed = cachedTickerSearchSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    });
    return hit && hit.cachedAt >= minimumCachedAt ? hit.value : null;
  };
  if (useSharedCache && cacheMode === "USE_CACHE") {
    const cached = await readCached();
    if (cached) return cached;
  }

  const load = async () => {
    const startedAt = Date.now();
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
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BrapiApiError("Não foi possível conectar à brapi.", 0);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new BrapiApiError("Não foi possível buscar tickers na brapi.", response.status);
    const parsed = tickerSearchResponseSchema.safeParse(payload);
    if (!parsed.success) throw new BrapiApiError("A brapi retornou uma lista de tickers inválida.", 502);

    const results = parsed.data.results.filter((result) => !isBrapiOddLotSymbol(result.symbol)).map((result) => ({
      symbol: normalizeBrapiSymbol(result.symbol),
      name: result.longName || result.name || result.symbol,
      assetType: result.assetType ?? null,
      subType: result.subType ?? null,
      currency: result.currency?.toUpperCase() || "BRL",
      lastPrice: result.quote?.lastPrice ?? null,
      logoUrl: usableBrapiLogoUrl(result.logoUrl),
    })).sort((left, right) => {
      const relevance = (symbol: string) => symbol === normalizedQuery ? 0 : symbol.startsWith(normalizedQuery) ? 1 : 2;
      return relevance(left.symbol) - relevance(right.symbol) || left.symbol.localeCompare(right.symbol);
    });
    if (useSharedCache) await setSharedCache(cacheKey, results, 60 * 60, startedAt);
    return results;
  };

  if (!useSharedCache) return load();
  return withSharedCacheCoalescing({
    key: sharedCacheKey("brapi:search-flight", normalizedQuery, subType ?? null),
    operation: load,
    readAfterWait: (lockStartedAt) => readCached(cacheMode === "REFRESH" ? lockStartedAt : 0),
  });
}

export async function fetchBrapiTickerMetadata({
  tickers,
  fetcher = fetch,
  signal,
  cacheMode = "USE_CACHE",
}: {
  tickers: string[];
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  cacheMode?: MarketCacheMode;
}): Promise<BrapiTickerSearchResult[]> {
  const symbols = [...new Set(tickers.map(normalizeBrapiSymbol).filter(Boolean))];
  const useSharedCache = fetcher === fetch && isSharedCacheConfigured();
  const keysBySymbol = new Map(symbols.map((symbol) => [
    symbol,
    sharedCacheKey("brapi:metadata", symbol),
  ]));
  const cached = useSharedCache && cacheMode === "USE_CACHE"
    ? await getSharedCacheMany(
        [...keysBySymbol.values()],
        (value) => {
          const parsed = cachedTickerSchema.safeParse(value);
          return parsed.success ? parsed.data : null;
        },
      )
    : new Map();
  const results = new Map(symbols.flatMap((symbol) => {
    const hit = cached.get(keysBySymbol.get(symbol)!);
    return hit ? [[symbol, hit.value] as const] : [];
  }));
  const missing = symbols.filter((symbol) => !results.has(symbol));
  const settled = await Promise.allSettled(missing.map(async (symbol) => {
    const matches = await searchBrapiTickers({ query: symbol, fetcher, signal, cacheMode });
    return matches.find((candidate) => candidate.symbol === symbol) ?? null;
  }));
  const fetched = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : []
  );
  for (const item of fetched) results.set(item.symbol, item);
  if (useSharedCache) {
    await setSharedCacheMany(fetched.map((item) => ({
      key: keysBySymbol.get(item.symbol)!,
      value: item,
    })));
  }
  return symbols.flatMap((symbol) => results.get(symbol) ?? []);
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

type BrapiQuoteRequest = {
  apiKey: string;
  tickers: string[];
  plan?: BrapiPlan;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  cacheMode?: MarketCacheMode;
};

async function loadBrapiQuotes({
  apiKey,
  tickers,
  plan = "FREE",
  fetcher = fetch,
  signal,
  cacheMode = "USE_CACHE",
}: BrapiQuoteRequest, skipMissing: boolean): Promise<BrapiQuote[]> {
  const normalized = [...new Set(tickers.map(normalizeBrapiSymbol).filter(Boolean))];
  if (!skipMissing && normalized.some((symbol) => symbol.includes(","))) {
    throw new BrapiApiError("Informe apenas um ticker por ativo.", 400);
  }
  const symbols = normalized.filter((symbol) => !symbol.includes(","));
  if (!symbols.length) return [];
  const limits = BRAPI_PLAN_LIMITS[normalizeBrapiPlan(plan)];
  const useSharedCache = fetcher === fetch && isSharedCacheConfigured();
  const keysBySymbol = new Map(symbols.map((symbol) => [
    symbol,
    sharedCacheKey("brapi:quote", symbol),
  ]));
  const readCached = async (requested: string[], minimumCachedAt = 0) => {
    const hits = await getSharedCacheMany(
      requested.map((symbol) => keysBySymbol.get(symbol)!),
      decodeCachedQuote,
    );
    return new Map(requested.flatMap((symbol) => {
      const hit = hits.get(keysBySymbol.get(symbol)!);
      return hit && hit.cachedAt >= minimumCachedAt ? [[symbol, hit.value] as const] : [];
    }));
  };
  const cached = useSharedCache && cacheMode === "USE_CACHE"
    ? await readCached(symbols)
    : new Map<string, BrapiQuote>();
  const missing = symbols.filter((symbol) => !cached.has(symbol));
  if (!missing.length) return symbols.flatMap((symbol) => cached.get(symbol) ?? []);

  let failed = false;
  let failure: unknown;
  const load = (group: string[]) => withQuoteRequestQueue(apiKey, limits.concurrentRequests, signal, async () => {
    if (failed) throw failure;
    const startedAt = Date.now();
    const url = new URL(BRAPI_QUOTE_URL);
    url.searchParams.set("symbols", group.join(","));

    let response: Response;
    try {
      response = await fetcher(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
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
    const fetched = parsed.data.results.flatMap<BrapiQuote>((result) => {
      if (!group.includes(normalizeBrapiSymbol(result.requestedSymbol))) return [];
      const price = result.data.regularMarketPrice;
      if (price == null || !Number.isFinite(price) || price <= 0) return [];
      return [{
        requestedSymbol: normalizeBrapiSymbol(result.requestedSymbol),
        symbol: normalizeBrapiSymbol(result.symbol),
        name: result.data.longName || result.data.shortName || result.symbol,
        price,
        currency: result.data.currency?.toUpperCase() || "BRL",
        logoUrl: usableBrapiLogoUrl(result.data.logourl),
        asOf: dateOrFallback(result.data.regularMarketTime, requestedAt),
      }];
    });
    if (useSharedCache) {
      await setSharedCacheMany(fetched.map((quote) => ({
        key: keysBySymbol.get(quote.requestedSymbol)!,
        value: { ...quote, asOf: quote.asOf.toISOString() },
        cachedAt: startedAt,
      })));
    }
    return fetched;
  });

  async function fetchGroup(group: string[]): Promise<BrapiQuote[]> {
    signal?.throwIfAborted();
    if (failed) throw failure;
    try {
      return !useSharedCache
        ? await load(group)
        : await withSharedCacheCoalescing({
            key: sharedCacheKey("brapi:quote-flight", group.slice().sort()),
            operation: () => load(group),
            readAfterWait: async (lockStartedAt) => {
              const waited = await readCached(group, cacheMode === "REFRESH" ? lockStartedAt : 0);
              return waited.size === group.length ? [...waited.values()] : null;
            },
          });
    } catch (error) {
      const missingTicker = error instanceof BrapiApiError && (error.status === 400 || error.status === 404);
      if (!skipMissing || !missingTicker) throw error;
      if (group.length === 1) return [];
      const middle = Math.ceil(group.length / 2);
      const left = await fetchGroup(group.slice(0, middle));
      const right = await fetchGroup(group.slice(middle));
      return [...left, ...right];
    }
  }

  const groups: string[][] = [];
  for (let index = 0; index < missing.length; index += limits.symbolsPerRequest) {
    groups.push(missing.slice(index, index + limits.symbolsPerRequest));
  }
  let nextGroup = 0;
  await Promise.all(Array.from({ length: Math.min(limits.concurrentRequests, groups.length) }, async () => {
    while (!failed && nextGroup < groups.length) {
      const group = groups[nextGroup++];
      try {
        const fetched = await fetchGroup(group);
        for (const quote of fetched) cached.set(quote.requestedSymbol, quote);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }));
  if (failed) throw failure;
  return symbols.flatMap((symbol) => cached.get(symbol) ?? []);
}

export async function fetchBrapiQuotes(request: BrapiQuoteRequest): Promise<BrapiQuote[]> {
  return loadBrapiQuotes(request, false);
}

export async function fetchAvailableBrapiQuotes(request: BrapiQuoteRequest): Promise<BrapiQuote[]> {
  return loadBrapiQuotes(request, true);
}
