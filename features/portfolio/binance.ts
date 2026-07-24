import Decimal from "decimal.js";
import { z } from "zod";

const BINANCE_MARKET_DATA_URL = "https://data-api.binance.vision";
const CATALOG_FRESH_MS = 60 * 60 * 1000;
const CATALOG_STALE_MS = 24 * 60 * 60 * 1000;
const QUOTE_FRESH_MS = 30 * 1000;
const MAX_BATCH_SIZE = 100;

const exchangeInfoSchema = z.object({
  symbols: z.array(z.object({
    symbol: z.string(),
    status: z.string(),
    baseAsset: z.string(),
    baseAssetPrecision: z.number().int().nonnegative(),
    quoteAsset: z.string(),
    isSpotTradingAllowed: z.boolean().optional(),
  }).passthrough()),
}).passthrough();

const priceSchema = z.object({
  symbol: z.string(),
  price: z.string(),
}).passthrough();

const priceResponseSchema = z.union([priceSchema, z.array(priceSchema)]);
const errorSchema = z.object({
  code: z.number().optional(),
  msg: z.string().optional(),
}).passthrough();

export type BinanceSpotPair = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
};

export type BinanceAssetSearchResult = {
  symbol: string;
  name: string;
  pair: string;
  quoteAsset: "BRL" | "USDT";
  baseAssetPrecision: number;
  logoUrl: null;
};

export type BinanceQuote = {
  requestedAsset: string;
  symbol: string;
  pair: string;
  price: number;
  currency: "BRL" | "USDT";
  fxRateToBrl: number | null;
  asOf: Date;
};

export type BinanceQuoteResult = {
  quotes: BinanceQuote[];
  missing: string[];
  missingConversion: string[];
};

export class BinanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "BinanceApiError";
  }
}

type CatalogCache = {
  pairs: BinanceSpotPair[];
  fetchedAt: number;
};

type PriceCacheEntry = {
  price: Decimal;
  fetchedAt: number;
};

let catalogCache: CatalogCache | null = null;
let catalogRequest: Promise<BinanceSpotPair[]> | null = null;
const priceCache = new Map<string, PriceCacheEntry>();
const priceRequests = new Map<string, Promise<Map<string, PriceCacheEntry>>>();

function normalizedAsset(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function retryAfterSeconds(response: Response) {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function errorMessage(status: number, retryAfter?: number) {
  const retry = retryAfter === undefined ? "" : ` Tente novamente em ${retryAfter} segundos.`;
  if (status === 418) return `A Binance bloqueou temporariamente este IP por excesso de requisições.${retry}`;
  if (status === 429) return `O limite de requisições da Binance foi atingido.${retry}`;
  if (status >= 500) return "A Binance está indisponível no momento. Tente novamente mais tarde.";
  if (status === 400 || status === 404) return "A Binance não encontrou um ou mais pares solicitados.";
  return "Não foi possível consultar a Binance.";
}

async function binanceFetch(
  path: string,
  {
    fetcher,
    timeoutMs,
  }: {
    fetcher: typeof fetch;
    timeoutMs: number;
  },
) {
  let response: Response;
  try {
    response = await fetcher(`${BINANCE_MARKET_DATA_URL}${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new BinanceApiError("Não foi possível conectar à Binance.", 0);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const details = errorSchema.safeParse(payload);
    const retryAfter = retryAfterSeconds(response);
    throw new BinanceApiError(
      errorMessage(response.status, retryAfter),
      response.status,
      details.success ? details.data.code : undefined,
      retryAfter,
    );
  }
  return payload;
}

async function fetchCatalog(fetcher: typeof fetch) {
  const payload = await binanceFetch(
    "/api/v3/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false",
    { fetcher, timeoutMs: 15_000 },
  );
  const parsed = exchangeInfoSchema.safeParse(payload);
  if (!parsed.success) throw new BinanceApiError("A Binance retornou um catálogo inválido.", 502);
  return parsed.data.symbols.flatMap<BinanceSpotPair>((pair) => {
    if (pair.status !== "TRADING" || pair.isSpotTradingAllowed === false) return [];
    const baseAsset = normalizedAsset(pair.baseAsset);
    const quoteAsset = normalizedAsset(pair.quoteAsset);
    if (!baseAsset || !quoteAsset || !["BRL", "USDT"].includes(quoteAsset)) return [];
    return [{
      symbol: normalizedAsset(pair.symbol),
      baseAsset,
      quoteAsset,
      baseAssetPrecision: pair.baseAssetPrecision,
    }];
  });
}

export async function getBinanceSpotCatalog({
  fetcher = fetch,
  now = Date.now(),
}: {
  fetcher?: typeof fetch;
  now?: number;
} = {}) {
  if (catalogCache && now - catalogCache.fetchedAt < CATALOG_FRESH_MS) return catalogCache.pairs;
  if (catalogRequest) return catalogRequest;
  catalogRequest = (async () => {
    try {
      const pairs = await fetchCatalog(fetcher);
      catalogCache = { pairs, fetchedAt: now };
      return pairs;
    } catch (error) {
      if (catalogCache && now - catalogCache.fetchedAt < CATALOG_STALE_MS) return catalogCache.pairs;
      throw error;
    } finally {
      catalogRequest = null;
    }
  })();
  return catalogRequest;
}

function preferredPairs(pairs: BinanceSpotPair[]) {
  const usdtBrlAvailable = pairs.some((pair) => pair.baseAsset === "USDT" && pair.quoteAsset === "BRL");
  const byAsset = new Map<string, BinanceSpotPair>();
  for (const pair of pairs) {
    if (pair.quoteAsset === "BRL") {
      byAsset.set(pair.baseAsset, pair);
      continue;
    }
    if (pair.quoteAsset === "USDT" && usdtBrlAvailable && !byAsset.has(pair.baseAsset)) {
      byAsset.set(pair.baseAsset, pair);
    }
  }
  return byAsset;
}

export async function searchBinanceAssets({
  query,
  fetcher = fetch,
}: {
  query: string;
  fetcher?: typeof fetch;
}): Promise<BinanceAssetSearchResult[]> {
  const normalizedQuery = normalizedAsset(query);
  if (!normalizedQuery) return [];
  const pairByAsset = preferredPairs(await getBinanceSpotCatalog({ fetcher }));
  return [...pairByAsset.values()]
    .filter((pair) => pair.baseAsset.includes(normalizedQuery))
    .sort((left, right) => {
      const relevance = (asset: string) =>
        asset === normalizedQuery ? 0 : asset.startsWith(normalizedQuery) ? 1 : 2;
      return relevance(left.baseAsset) - relevance(right.baseAsset)
        || left.baseAsset.localeCompare(right.baseAsset);
    })
    .slice(0, 12)
    .map((pair) => ({
      symbol: pair.baseAsset,
      name: pair.baseAsset,
      pair: pair.symbol,
      quoteAsset: pair.quoteAsset as "BRL" | "USDT",
      baseAssetPrecision: pair.baseAssetPrecision,
      logoUrl: null,
    }));
}

function chunked<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function requestPrices(symbols: string[], fetcher: typeof fetch, fetchedAt: number): Promise<Map<string, PriceCacheEntry>> {
  const url = new URL("/api/v3/ticker/price", BINANCE_MARKET_DATA_URL);
  url.searchParams.set("symbols", JSON.stringify(symbols));
  const payload = await binanceFetch(`${url.pathname}${url.search}`, { fetcher, timeoutMs: 15_000 });
  const parsed = priceResponseSchema.safeParse(payload);
  if (!parsed.success) throw new BinanceApiError("A Binance retornou cotações inválidas.", 502);
  const rows = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const prices = new Map<string, PriceCacheEntry>();
  for (const row of rows) {
    const price = new Decimal(row.price);
    if (!price.isFinite() || price.lte(0)) continue;
    prices.set(normalizedAsset(row.symbol), { price, fetchedAt });
  }
  return prices;
}

async function requestAvailablePrices(symbols: string[], fetcher: typeof fetch, fetchedAt: number): Promise<Map<string, PriceCacheEntry>> {
  try {
    return await requestPrices(symbols, fetcher, fetchedAt);
  } catch (error) {
    const recoverable = error instanceof BinanceApiError && (error.status === 400 || error.status === 404);
    if (!recoverable) throw error;
    if (symbols.length === 1) return new Map();
    const middle = Math.ceil(symbols.length / 2);
    const [left, right] = await Promise.all([
      requestAvailablePrices(symbols.slice(0, middle), fetcher, fetchedAt),
      requestAvailablePrices(symbols.slice(middle), fetcher, fetchedAt),
    ]);
    return new Map([...left, ...right]);
  }
}

async function fetchPairPrices(symbols: string[], fetcher: typeof fetch, now: number) {
  const normalizedSymbols = [...new Set(symbols.map(normalizedAsset).filter(Boolean))];
  const result = new Map<string, PriceCacheEntry>();
  const missing = normalizedSymbols.filter((symbol) => {
    const cached = priceCache.get(symbol);
    if (!cached || now - cached.fetchedAt >= QUOTE_FRESH_MS) return true;
    result.set(symbol, cached);
    return false;
  });
  for (const batch of chunked(missing, MAX_BATCH_SIZE)) {
    const key = batch.slice().sort().join(",");
    let request = priceRequests.get(key);
    if (!request) {
      request = requestAvailablePrices(batch, fetcher, now).finally(() => priceRequests.delete(key));
      priceRequests.set(key, request);
    }
    const prices = await request;
    for (const [symbol, entry] of prices) {
      priceCache.set(symbol, entry);
      result.set(symbol, entry);
    }
  }
  return result;
}

export async function fetchBinanceQuotes({
  assets,
  fetcher = fetch,
  now = Date.now(),
}: {
  assets: string[];
  fetcher?: typeof fetch;
  now?: number;
}): Promise<BinanceQuoteResult> {
  const requestedAssets = [...new Set(assets.map(normalizedAsset).filter(Boolean))];
  const pairByAsset = preferredPairs(await getBinanceSpotCatalog({ fetcher, now }));
  const selectedPairs = requestedAssets.flatMap((asset) => {
    const pair = pairByAsset.get(asset);
    return pair ? [pair] : [];
  });
  const needsUsdt = selectedPairs.some((pair) => pair.quoteAsset === "USDT");
  const requestedPairs = [
    ...selectedPairs.map((pair) => pair.symbol),
    ...(needsUsdt ? ["USDTBRL"] : []),
  ];
  const prices = await fetchPairPrices(requestedPairs, fetcher, now);
  const usdtBrl = prices.get("USDTBRL")?.price;
  const missing: string[] = [];
  const missingConversion: string[] = [];
  const quotes: BinanceQuote[] = [];
  for (const asset of requestedAssets) {
    const pair = pairByAsset.get(asset);
    if (!pair) {
      missing.push(asset);
      continue;
    }
    const price = prices.get(pair.symbol)?.price;
    if (!price) {
      missing.push(asset);
      continue;
    }
    if (pair.quoteAsset === "USDT" && !usdtBrl) {
      missingConversion.push(asset);
      continue;
    }
    quotes.push({
      requestedAsset: asset,
      symbol: asset,
      pair: pair.symbol,
      price: price.toNumber(),
      currency: pair.quoteAsset as "BRL" | "USDT",
      fxRateToBrl: pair.quoteAsset === "USDT" ? usdtBrl!.toNumber() : null,
      asOf: new Date(prices.get(pair.symbol)?.fetchedAt ?? now),
    });
  }
  return { quotes, missing, missingConversion };
}

export function resetBinanceCachesForTests() {
  catalogCache = null;
  catalogRequest = null;
  priceCache.clear();
  priceRequests.clear();
}
