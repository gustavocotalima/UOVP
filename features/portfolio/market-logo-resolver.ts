import "server-only";

import { sharedCacheKey, withSharedCacheCoalescing } from "@/lib/shared-cache";
import {
  missingMetadataCanRetry,
  readMarketMetadata,
  saveMissingMarketMetadata,
  saveVerifiedMarketMetadata,
  type SharedMarketMetadata,
} from "./market-metadata";
import {
  normalizeBrapiSymbol,
  searchBrapiTickers,
  type BrapiTickerSearchResult,
} from "./brapi";
import { financialModelingPrepLogoUrl, usableBrapiLogoUrl } from "./market-logo";
import {
  normalizeYahooSymbol,
  searchYahooTickers,
  type YahooSearchKind,
  type YahooTickerSearchResult,
} from "./yahoo-finance";

function usableVerifiedMetadata(
  metadata: SharedMarketMetadata | undefined,
  failedUrls: Set<string>,
) {
  const logoUrl = metadata?.provider === "BRAPI"
    ? usableBrapiLogoUrl(metadata.logoUrl)
    : metadata?.logoUrl ?? null;
  return metadata?.status === "VERIFIED"
    && logoUrl
    && !failedUrls.has(logoUrl)
    ? metadata
    : null;
}

export async function persistExactBrapiSearchMetadata(
  query: string,
  results: BrapiTickerSearchResult[],
) {
  const symbol = normalizeBrapiSymbol(query);
  const exact = results.find((result) => result.symbol === symbol);
  if (!exact) return null;
  const existing = (await readMarketMetadata("BRAPI", [symbol])).get(symbol);
  if (existing?.status === "VERIFIED") return existing;
  const logoUrl = usableBrapiLogoUrl(exact.logoUrl);
  return logoUrl
    ? saveVerifiedMarketMetadata({
        provider: "BRAPI",
        symbol,
        name: exact.name,
        logoUrl,
        source: "SEARCH",
      })
    : saveMissingMarketMetadata({
        provider: "BRAPI",
        symbol,
        name: exact.name,
        source: "SEARCH",
      });
}

export async function persistExactYahooSearchMetadata(
  query: string,
  results: YahooTickerSearchResult[],
) {
  const symbol = normalizeYahooSymbol(query);
  const exact = results.find((result) => result.symbol === symbol);
  if (!exact) return null;
  const existing = (await readMarketMetadata("YAHOO", [symbol])).get(symbol);
  if (existing?.status === "VERIFIED") return existing;
  const logoUrl = exact.logoUrl ?? financialModelingPrepLogoUrl(symbol);
  return logoUrl
    ? saveVerifiedMarketMetadata({
        provider: "YAHOO",
        symbol,
        name: exact.name,
        logoUrl,
        source: "SEARCH",
      })
    : saveMissingMarketMetadata({
        provider: "YAHOO",
        symbol,
        name: exact.name,
        source: "SEARCH",
      });
}

export async function resolveBrapiLogo(
  ticker: string,
  failedLogoUrls: string[] = [],
) {
  const symbol = normalizeBrapiSymbol(ticker);
  const failedUrls = new Set(failedLogoUrls);
  const existing = (await readMarketMetadata("BRAPI", [symbol])).get(symbol);
  const usable = usableVerifiedMetadata(existing, failedUrls);
  if (usable) return usable;
  if (existing?.status === "MISSING" && !missingMetadataCanRetry(existing)) return existing;

  return withSharedCacheCoalescing({
    key: sharedCacheKey("market:logo-resolution:v2", "BRAPI", symbol),
    operation: async () => {
      const matches = await searchBrapiTickers({ query: symbol, cacheMode: "REFRESH" });
      const exact = matches.find((candidate) => candidate.symbol === symbol);
      const logoUrl = usableBrapiLogoUrl(exact?.logoUrl);
      if (exact && logoUrl && !failedUrls.has(logoUrl)) {
        return saveVerifiedMarketMetadata({
          provider: "BRAPI",
          symbol,
          name: exact.name,
          logoUrl,
          source: "CATALOG",
        });
      }
      return saveMissingMarketMetadata({
        provider: "BRAPI",
        symbol,
        name: exact?.name ?? existing?.name ?? null,
        source: "CATALOG",
      });
    },
    readAfterWait: async (lockStartedAt) => {
      const current = (await readMarketMetadata("BRAPI", [symbol])).get(symbol);
      const verified = usableVerifiedMetadata(current, failedUrls);
      if (verified) return verified;
      return current?.status === "MISSING"
        && new Date(current.lastAttemptAt).getTime() >= lockStartedAt
        ? current
        : null;
    },
  });
}

export async function resolveYahooLogo(
  ticker: string,
  kind: YahooSearchKind,
  failedLogoUrls: string[] = [],
) {
  const symbol = normalizeYahooSymbol(ticker);
  const failedUrls = new Set(failedLogoUrls);
  const existing = (await readMarketMetadata("YAHOO", [symbol])).get(symbol);
  const usable = usableVerifiedMetadata(existing, failedUrls);
  if (usable) return usable;
  if (existing?.status === "MISSING" && !missingMetadataCanRetry(existing)) return existing;

  return withSharedCacheCoalescing({
    key: sharedCacheKey("market:logo-resolution:v2", "YAHOO", symbol),
    operation: async () => {
      const matches = await searchYahooTickers({ query: symbol, kind, cacheMode: "REFRESH" });
      const exact = matches.find((candidate) => candidate.symbol === symbol);
      const candidates = [
        exact?.logoUrl ?? null,
        financialModelingPrepLogoUrl(symbol),
      ].filter((value): value is string => Boolean(value));
      const logoUrl = candidates.find((candidate) => !failedUrls.has(candidate)) ?? null;
      if (exact && logoUrl) {
        return saveVerifiedMarketMetadata({
          provider: "YAHOO",
          symbol,
          name: exact.name,
          logoUrl,
          source: "CATALOG",
        });
      }
      return saveMissingMarketMetadata({
        provider: "YAHOO",
        symbol,
        name: exact?.name ?? existing?.name ?? null,
        source: "CATALOG",
      });
    },
    readAfterWait: async (lockStartedAt) => {
      const current = (await readMarketMetadata("YAHOO", [symbol])).get(symbol);
      const verified = usableVerifiedMetadata(current, failedUrls);
      if (verified) return verified;
      return current?.status === "MISSING"
        && new Date(current.lastAttemptAt).getTime() >= lockStartedAt
        ? current
        : null;
    },
  });
}
