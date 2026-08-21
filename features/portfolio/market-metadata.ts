import "server-only";

import {
  MarketMetadataProvider,
  MarketMetadataSource,
  MarketMetadataStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getSharedCacheMany,
  setSharedCacheMany,
  sharedCacheKey,
} from "@/lib/shared-cache";

const MISSING_RETRY_MS = 24 * 60 * 60 * 1_000;
const MISSING_CACHE_SECONDS = MISSING_RETRY_MS / 1_000;

const cachedMetadataSchema = z.object({
  provider: z.enum(["BRAPI", "YAHOO"]),
  symbol: z.string().min(1),
  name: z.string().nullable(),
  logoUrl: z.string().url().nullable(),
  status: z.enum(["VERIFIED", "MISSING"]),
  source: z.enum(["EXISTING", "CATALOG", "SEARCH"]),
  resolvedAt: z.string().datetime().nullable(),
  lastAttemptAt: z.string().datetime(),
});

export type SharedMarketMetadata = z.infer<typeof cachedMetadataSchema>;

function metadataCacheKey(provider: MarketMetadataProvider, symbol: string) {
  return sharedCacheKey("market:metadata:v2", provider, symbol);
}

function serializeMetadata(metadata: {
  provider: MarketMetadataProvider;
  symbol: string;
  name: string | null;
  logoUrl: string | null;
  status: MarketMetadataStatus;
  source: MarketMetadataSource;
  resolvedAt: Date | null;
  lastAttemptAt: Date;
}): SharedMarketMetadata {
  return {
    provider: metadata.provider,
    symbol: metadata.symbol,
    name: metadata.name,
    logoUrl: metadata.logoUrl,
    status: metadata.status,
    source: metadata.source,
    resolvedAt: metadata.resolvedAt?.toISOString() ?? null,
    lastAttemptAt: metadata.lastAttemptAt.toISOString(),
  };
}

async function cacheMetadata(records: SharedMarketMetadata[]) {
  await setSharedCacheMany(records.map((record) => ({
    key: metadataCacheKey(record.provider, record.symbol),
    value: record,
    ttlSeconds: record.status === "MISSING" ? MISSING_CACHE_SECONDS : undefined,
  })));
}

export async function readMarketMetadata(
  provider: MarketMetadataProvider,
  symbols: string[],
) {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (!uniqueSymbols.length) return new Map<string, SharedMarketMetadata>();

  const keysBySymbol = new Map(uniqueSymbols.map((symbol) => [
    symbol,
    metadataCacheKey(provider, symbol),
  ]));
  const cached = await getSharedCacheMany(
    [...keysBySymbol.values()],
    (value) => {
      const parsed = cachedMetadataSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    },
  );
  const result = new Map<string, SharedMarketMetadata>();
  for (const symbol of uniqueSymbols) {
    const hit = cached.get(keysBySymbol.get(symbol)!);
    if (hit) result.set(symbol, hit.value);
  }

  const missingSymbols = uniqueSymbols.filter((symbol) => !result.has(symbol));
  if (!missingSymbols.length) return result;
  const stored = await prisma.marketAssetMetadata.findMany({
    where: { provider, symbol: { in: missingSymbols } },
  });
  const serialized = stored.map(serializeMetadata);
  for (const record of serialized) result.set(record.symbol, record);
  await cacheMetadata(serialized);
  return result;
}

export function missingMetadataCanRetry(
  metadata: SharedMarketMetadata,
  now = new Date(),
) {
  return metadata.status === "MISSING"
    && now.getTime() - new Date(metadata.lastAttemptAt).getTime() >= MISSING_RETRY_MS;
}

export async function saveVerifiedMarketMetadata({
  provider,
  symbol,
  name,
  logoUrl,
  source,
}: {
  provider: MarketMetadataProvider;
  symbol: string;
  name: string | null;
  logoUrl: string;
  source: MarketMetadataSource;
}) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const now = new Date();
  const stored = await prisma.marketAssetMetadata.upsert({
    where: { provider_symbol: { provider, symbol: normalizedSymbol } },
    update: {
      name,
      logoUrl,
      status: "VERIFIED",
      source,
      resolvedAt: now,
      lastAttemptAt: now,
    },
    create: {
      provider,
      symbol: normalizedSymbol,
      name,
      logoUrl,
      status: "VERIFIED",
      source,
      resolvedAt: now,
      lastAttemptAt: now,
    },
  });
  const result = serializeMetadata(stored);
  await cacheMetadata([result]);
  return result;
}

export async function saveMissingMarketMetadata({
  provider,
  symbol,
  name,
  source,
}: {
  provider: MarketMetadataProvider;
  symbol: string;
  name: string | null;
  source: MarketMetadataSource;
}) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const now = new Date();
  const stored = await prisma.marketAssetMetadata.upsert({
    where: { provider_symbol: { provider, symbol: normalizedSymbol } },
    update: {
      name,
      logoUrl: null,
      status: "MISSING",
      source,
      resolvedAt: null,
      lastAttemptAt: now,
    },
    create: {
      provider,
      symbol: normalizedSymbol,
      name,
      logoUrl: null,
      status: "MISSING",
      source,
      resolvedAt: null,
      lastAttemptAt: now,
    },
  });
  const result = serializeMetadata(stored);
  await cacheMetadata([result]);
  return result;
}
