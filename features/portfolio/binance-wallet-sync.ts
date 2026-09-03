import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { anonymizedUserId, logIntegrationRefresh } from "@/lib/integration-observability";
import { shouldSyncBinanceConnection } from "@/lib/automatic-refresh-policy";
import {
  OperationInProgressError,
  withUserOperationLease,
  type UserOperationLeaseContext,
} from "@/lib/operation-security";
import { bumpPortfolioAndInvalidateDrafts } from "./invalidation";
import { fetchBinanceQuotes, type BinanceQuote } from "./binance";
import { BinancePrivateClient, type BinanceWalletKind, type BinanceWalletSnapshot } from "./binance-wallet-client";
import { requireBinanceCredentials } from "./binance-wallet-credentials";

const FIAT_ASSETS = new Set([
  "AED", "ARS", "AUD", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CZK", "EUR", "GBP",
  "HKD", "HUF", "IDR", "INR", "JPY", "KES", "KZT", "MXN", "NGN", "NZD", "PEN", "PHP",
  "PLN", "RON", "RUB", "SAR", "THB", "TRY", "UAH", "UGX", "USD", "VND", "ZAR",
]);

const BUCKET_FIELD: Record<BinanceWalletKind, "spotQuantity" | "fundingQuantity" | "earnFlexibleQuantity" | "earnLockedQuantity"> = {
  SPOT: "spotQuantity",
  FUNDING: "fundingQuantity",
  EARN_FLEXIBLE: "earnFlexibleQuantity",
  EARN_LOCKED: "earnLockedQuantity",
};

const BUCKET_UPDATED_AT_FIELD: Record<BinanceWalletKind, "spotUpdatedAt" | "fundingUpdatedAt" | "earnFlexibleUpdatedAt" | "earnLockedUpdatedAt"> = {
  SPOT: "spotUpdatedAt",
  FUNDING: "fundingUpdatedAt",
  EARN_FLEXIBLE: "earnFlexibleUpdatedAt",
  EARN_LOCKED: "earnLockedUpdatedAt",
};

export type BinanceWalletSyncResult = {
  status: "SKIPPED" | "UPDATED" | "PARTIAL" | "FAILED";
  changed: boolean;
  reason: "AUTOMATIC_STALE" | "MANUAL" | null;
  discovered: number;
  tracked: number;
  failedWallets: BinanceWalletKind[];
  message: string | null;
};

export function binanceDiscoveryStatus(
  existingStatus: "AVAILABLE" | "NEEDS_REVIEW" | "TRACKED" | "IGNORED" | null,
  hasManualPosition: boolean,
) {
  if (existingStatus === "TRACKED" || existingStatus === "IGNORED") return existingStatus;
  return hasManualPosition ? "NEEDS_REVIEW" : "AVAILABLE";
}

function cleanSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function quantityOf(asset: {
  spotQuantity: Prisma.Decimal;
  fundingQuantity: Prisma.Decimal;
  earnFlexibleQuantity: Prisma.Decimal;
  earnLockedQuantity: Prisma.Decimal;
}) {
  return new Decimal(asset.spotQuantity.toString())
    .add(asset.fundingQuantity.toString())
    .add(asset.earnFlexibleQuantity.toString())
    .add(asset.earnLockedQuantity.toString());
}

function quoteUnitPriceBrl(quote: BinanceQuote) {
  return new Decimal(quote.price).mul(quote.fxRateToBrl ?? 1);
}

async function reconcileBinanceContributions(tx: Prisma.TransactionClient, userId: string) {
  const suggestions = await tx.contributionSuggestion.findMany({
    where: {
      executionStatus: "AWAITING_SYNC",
      simulation: { userId },
      externalBaselines: { some: { holding: { positionSource: "BINANCE" } } },
    },
    include: {
      externalBaselines: { include: { holding: true } },
    },
  });
  for (const suggestion of suggestions) {
    const increase = suggestion.externalBaselines.reduce((total, baseline) => {
      if (baseline.holding.positionSource !== "BINANCE") return total;
      return total.add(Prisma.Decimal.max(0, baseline.holding.quantity.sub(baseline.quantity)));
    }, new Prisma.Decimal(0));
    if (increase.lt(suggestion.quantity.mul("0.999999"))) continue;
    const confirmationReference = `BINANCE_POSITION:${suggestion.id}:${increase.toString()}`;
    const claimed = await tx.contributionSuggestion.updateMany({
      where: { id: suggestion.id, executionStatus: "AWAITING_SYNC" },
      data: { executed: true, executionStatus: "EXECUTED", confirmationReference },
    });
    if (!claimed.count) continue;
    const remaining = await tx.contributionSuggestion.count({
      where: { simulationId: suggestion.simulationId, executed: false },
    });
    if (!remaining) {
      await tx.contributionSimulation.update({
        where: { id: suggestion.simulationId },
        data: { status: "EXECUTED", executedAt: new Date() },
      });
    }
  }
}

async function persistSnapshot({
  userId,
  snapshot,
  lease,
}: {
  userId: string;
  snapshot: BinanceWalletSnapshot;
  lease: UserOperationLeaseContext;
}) {
  const connection = await prisma.binanceConnection.findUnique({ where: { userId } });
  if (!connection) throw new Error("Conexão Binance não encontrada.");
  const now = new Date();
  const successful = snapshot.buckets.filter((bucket) => bucket.ok);
  const failedWallets = snapshot.buckets.filter((bucket) => !bucket.ok).map((bucket) => bucket.kind);
  const incomingSymbols = [...new Set(successful.flatMap((bucket) =>
    bucket.balances.map((balance) => cleanSymbol(balance.symbol)).filter((symbol) => symbol && !FIAT_ASSETS.has(symbol)),
  ))];
  const [existingRows, manualAssets] = await Promise.all([
    prisma.binanceWalletAsset.findMany({ where: { connectionId: connection.id } }),
    prisma.asset.findMany({
      where: {
        portfolio: { userId },
        investmentClass: "CRYPTO",
        holdings: { some: { positionSource: "MANUAL", includedInTotals: true } },
      },
      select: { ticker: true },
    }),
  ]);
  const manualSymbols = new Set(manualAssets.map((asset) => cleanSymbol(asset.ticker)));
  const symbols = [...new Set([...existingRows.map((asset) => asset.symbol), ...incomingSymbols])];
  const existingBySymbol = new Map(existingRows.map((asset) => [asset.symbol, asset]));
  const allWalletsSucceeded = failedWallets.length === 0;
  let discovered = 0;

  await lease.runFencedTransaction(async (tx) => {
    for (const symbol of symbols) {
      if (FIAT_ASSETS.has(symbol)) continue;
      const existing = existingBySymbol.get(symbol);
      const data: Prisma.BinanceWalletAssetUncheckedCreateInput = {
        id: existing?.id,
        connectionId: connection.id,
        symbol,
        name: existing?.name ?? null,
        status: binanceDiscoveryStatus(existing?.status ?? null, manualSymbols.has(symbol)),
        spotQuantity: existing?.spotQuantity ?? 0,
        fundingQuantity: existing?.fundingQuantity ?? 0,
        earnFlexibleQuantity: existing?.earnFlexibleQuantity ?? 0,
        earnLockedQuantity: existing?.earnLockedQuantity ?? 0,
        btcValuation: existing?.btcValuation ?? null,
        spotUpdatedAt: existing?.spotUpdatedAt ?? null,
        fundingUpdatedAt: existing?.fundingUpdatedAt ?? null,
        earnFlexibleUpdatedAt: existing?.earnFlexibleUpdatedAt ?? null,
        earnLockedUpdatedAt: existing?.earnLockedUpdatedAt ?? null,
        holdingId: existing?.holdingId ?? null,
        lastSeenAt: existing?.lastSeenAt ?? null,
        lastSyncAt: now,
      };
      let seen = false;
      for (const bucket of successful) {
        const balance = bucket.balances.find((candidate) => cleanSymbol(candidate.symbol) === symbol);
        data[BUCKET_FIELD[bucket.kind]] = new Prisma.Decimal(balance?.quantity ?? 0);
        data[BUCKET_UPDATED_AT_FIELD[bucket.kind]] = now;
        if (balance) {
          seen = true;
          if (!data.name && balance.name) data.name = balance.name;
        }
      }
      const total = new Decimal(data.spotQuantity?.toString() ?? 0)
        .add(data.fundingQuantity?.toString() ?? 0)
        .add(data.earnFlexibleQuantity?.toString() ?? 0)
        .add(data.earnLockedQuantity?.toString() ?? 0);
      if (seen || total.gt(0)) data.lastSeenAt = now;
      if (snapshot.valuationsComplete && allWalletsSucceeded) {
        const btcValuation = snapshot.totalBtcValuations[symbol];
        data.btcValuation = btcValuation && new Decimal(btcValuation).gt(0)
          ? new Prisma.Decimal(btcValuation)
          : null;
      }
      if (!existing && total.gt(0)) discovered += 1;
      await tx.binanceWalletAsset.upsert({
        where: { connectionId_symbol: { connectionId: connection.id, symbol } },
        create: data,
        update: {
          name: data.name,
          status: data.status,
          spotQuantity: data.spotQuantity,
          fundingQuantity: data.fundingQuantity,
          earnFlexibleQuantity: data.earnFlexibleQuantity,
          earnLockedQuantity: data.earnLockedQuantity,
          btcValuation: data.btcValuation,
          spotUpdatedAt: data.spotUpdatedAt,
          fundingUpdatedAt: data.fundingUpdatedAt,
          earnFlexibleUpdatedAt: data.earnFlexibleUpdatedAt,
          earnLockedUpdatedAt: data.earnLockedUpdatedAt,
          lastSeenAt: data.lastSeenAt,
          lastSyncAt: now,
        },
      });
    }
    await tx.binanceConnection.update({
      where: { id: connection.id },
      data: {
        status: failedWallets.length ? "PARTIAL" : "CONNECTED",
        lastAttemptAt: now,
        lastSyncAt: failedWallets.length ? connection.lastSyncAt : now,
        syncPending: failedWallets.length > 0,
        lastError: failedWallets.length ? `Falha ao consultar: ${failedWallets.join(", ")}.` : null,
      },
    });
  }, { timeout: 120_000 });

  const walletRows = await prisma.binanceWalletAsset.findMany({
    where: { connectionId: connection.id },
  });
  let quotesResolved = true;
  let quotes: Awaited<ReturnType<typeof fetchBinanceQuotes>> = { quotes: [], missing: [], missingConversion: [] };
  if (walletRows.length) {
    try {
      quotes = await fetchBinanceQuotes({ assets: [...walletRows.map((asset) => asset.symbol), "BTC"] });
    } catch {
      quotesResolved = false;
    }
  }
  const quoteBySymbol = new Map(quotes.quotes.map((quote) => [quote.requestedAsset, quote]));
  const btcQuote = quoteBySymbol.get("BTC");
  const trackedRows = walletRows.filter((asset) => asset.status === "TRACKED" && asset.holdingId);
  let changed = discovered > 0;
  const portfolio = await prisma.portfolio.findUnique({ where: { userId } });

  if (walletRows.length) {
    await lease.runFencedTransaction(async (tx) => {
      for (const walletAsset of walletRows) {
        const quantity = quantityOf(walletAsset);
        const quote = quoteBySymbol.get(walletAsset.symbol);
        const supportsBtcValuation = Boolean(btcQuote && walletAsset.btcValuation && quantity.gt(0));
        if (quotesResolved) {
          await tx.binanceWalletAsset.update({
            where: { id: walletAsset.id },
            data: quote
              ? { valuationSupported: true, valuationMethod: "DIRECT", valuationError: null }
              : supportsBtcValuation
                ? { valuationSupported: true, valuationMethod: "BTC", valuationError: null }
                : { valuationSupported: false, valuationMethod: null, valuationError: "Sem cotação suportada pela Binance." },
          });
        }
        if (walletAsset.status !== "TRACKED" || !walletAsset.holdingId) continue;
        const holding = await tx.assetHolding.findUnique({ where: { id: walletAsset.holdingId } });
        if (!holding) continue;
        const update: Prisma.AssetHoldingUpdateInput = { quantity: new Prisma.Decimal(quantity.toString()) };
        if (quote) {
          update.pricingSource = "BINANCE";
          update.unitPrice = new Prisma.Decimal(String(quote.price));
          update.currency = quote.currency;
          update.fxRateToBrl = quote.fxRateToBrl == null ? null : new Prisma.Decimal(String(quote.fxRateToBrl));
          update.fxUpdatedAt = quote.fxRateToBrl == null ? null : quote.asOf;
          update.providerSymbol = quote.pair;
          update.marketQuoteType = "SPOT";
          update.priceUpdatedAt = quote.asOf;
          update.currentValue = null;
          update.providerCurrentValue = null;
        } else if (supportsBtcValuation && btcQuote && walletAsset.btcValuation) {
          const totalBrl = new Decimal(walletAsset.btcValuation.toString()).mul(quoteUnitPriceBrl(btcQuote));
          update.pricingSource = "BINANCE";
          update.unitPrice = new Prisma.Decimal(totalBrl.div(quantity).toString());
          update.currency = "BRL";
          update.fxRateToBrl = null;
          update.fxUpdatedAt = null;
          update.providerSymbol = null;
          update.marketQuoteType = "BTC_VALUATION";
          update.priceUpdatedAt = btcQuote.asOf;
          update.currentValue = null;
          update.providerCurrentValue = null;
        }
        if (!holding.quantity.eq(new Prisma.Decimal(quantity.toString()))) changed = true;
        await tx.assetHolding.update({ where: { id: holding.id }, data: update });
      }
      await reconcileBinanceContributions(tx, userId);
      if (changed && portfolio) await bumpPortfolioAndInvalidateDrafts(tx, portfolio.id, userId);
    }, { timeout: 120_000 });
  }

  return { changed, discovered, tracked: trackedRows.length, failedWallets };
}

export async function syncBinanceWalletForUser(
  userId: string,
  { reason = "MANUAL" }: { reason?: "AUTOMATIC_STALE" | "MANUAL" } = {},
): Promise<BinanceWalletSyncResult> {
  const startedAt = Date.now();
  try {
    return await withUserOperationLease({
      userId,
      operation: "binance-wallet-sync",
      leaseMs: 5 * 60_000,
      action: async (lease) => {
        const connection = await prisma.binanceConnection.findUnique({ where: { userId } });
        if (!connection) {
          return { status: "SKIPPED", changed: false, reason: null, discovered: 0, tracked: 0, failedWallets: [], message: null };
        }
        await prisma.binanceConnection.update({ where: { id: connection.id }, data: { lastAttemptAt: new Date() } });
        try {
          const credentials = await requireBinanceCredentials(userId);
          const client = new BinancePrivateClient(credentials);
          const snapshot = await client.walletSnapshot();
          const persisted = await persistSnapshot({ userId, snapshot, lease });
          logIntegrationRefresh({
            event: "binance-wallet-sync",
            user: anonymizedUserId(userId),
            reason,
            status: persisted.failedWallets.length ? "PARTIAL" : "UPDATED",
            discovered: persisted.discovered,
            tracked: persisted.tracked,
            failedWallets: persisted.failedWallets,
            durationMs: Date.now() - startedAt,
          });
          return {
            status: persisted.failedWallets.length ? "PARTIAL" : "UPDATED",
            ...persisted,
            reason,
            message: persisted.failedWallets.length
              ? `Algumas carteiras da Binance não puderam ser sincronizadas: ${persisted.failedWallets.join(", ")}.`
              : persisted.discovered
                ? `${persisted.discovered} novo(s) ativo(s) da Binance aguardam sua seleção.`
                : null,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Não foi possível sincronizar a Binance.";
          await prisma.binanceConnection.update({
            where: { id: connection.id },
            data: { status: "ERROR", syncPending: true, lastError: message, lastAttemptAt: new Date() },
          }).catch(() => undefined);
          logIntegrationRefresh({
            event: "binance-wallet-sync",
            user: anonymizedUserId(userId),
            reason,
            status: "FAILED",
            durationMs: Date.now() - startedAt,
          });
          throw error;
        }
      },
    });
  } catch (error) {
    if (error instanceof OperationInProgressError) {
      return { status: "SKIPPED", changed: false, reason, discovered: 0, tracked: 0, failedWallets: [], message: null };
    }
    return {
      status: "FAILED",
      changed: false,
      reason,
      discovered: 0,
      tracked: 0,
      failedWallets: [],
      message: error instanceof Error ? error.message : "Não foi possível sincronizar a Binance.",
    };
  }
}

export async function syncStaleBinanceWalletForUser(userId: string): Promise<BinanceWalletSyncResult> {
  const connection = await prisma.binanceConnection.findUnique({
    where: { userId },
    select: { syncPending: true, lastSyncAt: true },
  });
  if (!shouldSyncBinanceConnection(connection)) {
    return { status: "SKIPPED", changed: false, reason: null, discovered: 0, tracked: 0, failedWallets: [], message: null };
  }
  return syncBinanceWalletForUser(userId, { reason: "AUTOMATIC_STALE" });
}
