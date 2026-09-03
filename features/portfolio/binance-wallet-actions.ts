"use server";

import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/current-user";
import { assertUserOperationRateLimit } from "@/lib/operation-security";
import { prisma } from "@/lib/prisma";
import { allowsFractionalUnits } from "./fractional-assets";
import { bumpPortfolioAndInvalidateDrafts } from "./invalidation";
import { fetchBinanceQuotes, type BinanceQuote } from "./binance";
import { BinancePrivateClient } from "./binance-wallet-client";
import {
  getBinanceConnectionStatus,
  storeBinanceCredentials,
} from "./binance-wallet-credentials";
import { syncBinanceWalletForUser } from "./binance-wallet-sync";

const credentialsSchema = z.object({
  apiKey: z.string().trim().min(8).max(512),
  apiSecret: z.string().trim().min(8).max(512),
});

const resolutionSchema = z.object({
  walletAssetId: z.string().cuid(),
  resolution: z.enum(["ADD", "REPLACE_MANUAL", "KEEP_BOTH", "IGNORE"]),
});

const disconnectSchema = z.enum(["KEEP_MANUAL", "REMOVE"]);

function revalidateBinancePaths() {
  ["/configuracoes", "/carteira", "/home"].forEach((path) => revalidatePath(path));
}

function quoteFields(quote: BinanceQuote) {
  return {
    pricingSource: "BINANCE" as const,
    unitPrice: new Prisma.Decimal(String(quote.price)),
    currency: quote.currency,
    fxRateToBrl: quote.fxRateToBrl == null ? null : new Prisma.Decimal(String(quote.fxRateToBrl)),
    fxUpdatedAt: quote.fxRateToBrl == null ? null : quote.asOf,
    providerSymbol: quote.pair,
    marketExchange: "BINANCE",
    marketQuoteType: "SPOT",
    priceUpdatedAt: quote.asOf,
    currentValue: null,
    providerCurrentValue: null,
  };
}

export async function saveBinanceConnectionAction(input: { apiKey: string; apiSecret: string }) {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({ userId, operation: "binance-connect", limit: 5, windowMs: 15 * 60_000 });
  const credentials = credentialsSchema.parse(input);
  const client = new BinancePrivateClient(credentials);
  const permissions = await client.permissions();
  if (!permissions.readEnabled) throw new Error("A chave da Binance precisa permitir leitura da conta.");
  await storeBinanceCredentials(userId, credentials, permissions);
  const sync = await syncBinanceWalletForUser(userId, { reason: "MANUAL" });
  revalidateBinancePaths();
  return { connection: await getBinanceConnectionStatus(userId), sync };
}

export async function syncBinanceWalletAction() {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({ userId, operation: "binance-sync", limit: 12, windowMs: 15 * 60_000 });
  const sync = await syncBinanceWalletForUser(userId, { reason: "MANUAL" });
  revalidateBinancePaths();
  return { connection: await getBinanceConnectionStatus(userId), sync };
}

export async function resolveBinanceWalletAssetAction(input: {
  walletAssetId: string;
  resolution: "ADD" | "REPLACE_MANUAL" | "KEEP_BOTH" | "IGNORE";
}) {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({ userId, operation: "binance-track", limit: 60, windowMs: 15 * 60_000 });
  const parsed = resolutionSchema.parse(input);
  const walletAsset = await prisma.binanceWalletAsset.findFirst({
    where: { id: parsed.walletAssetId, connection: { userId } },
    include: { holding: { include: { asset: true } } },
  });
  if (!walletAsset) throw new Error("Ativo da Binance não encontrado.");
  if (walletAsset.valuationSupported === false && parsed.resolution !== "IGNORE") {
    throw new Error(walletAsset.valuationError ?? "Sem cotação suportada pela Binance.");
  }

  if (parsed.resolution === "IGNORE") {
    await prisma.$transaction(async (tx) => {
      if (walletAsset.holdingId) {
        await tx.assetHolding.update({
          where: { id: walletAsset.holdingId },
          data: { includedInTotals: false, supersededAt: new Date() },
        });
      }
      await tx.binanceWalletAsset.update({ where: { id: walletAsset.id }, data: { status: "IGNORED" } });
      const portfolio = await tx.portfolio.findUnique({ where: { userId } });
      if (portfolio) await bumpPortfolioAndInvalidateDrafts(tx, portfolio.id, userId);
    });
    revalidateBinancePaths();
    return getBinanceConnectionStatus(userId);
  }

  const portfolio = await prisma.portfolio.upsert({ where: { userId }, update: {}, create: { userId } });
  const matchingAsset = await prisma.asset.findFirst({
    where: { portfolioId: portfolio.id, investmentClass: "CRYPTO", ticker: walletAsset.symbol },
    include: { holdings: true },
  });
  const matchingManual = matchingAsset?.holdings.filter((holding) =>
    holding.positionSource === "MANUAL" && holding.includedInTotals,
  ) ?? [];
  if (matchingManual.length && parsed.resolution === "ADD") {
    throw new Error("Escolha como conciliar este saldo com a posição manual existente.");
  }
  if (!matchingManual.length && ["REPLACE_MANUAL", "KEEP_BOTH"].includes(parsed.resolution)) {
    throw new Error("Não existe posição manual para conciliar.");
  }

  const quantity = new Decimal(walletAsset.spotQuantity.toString())
    .add(walletAsset.fundingQuantity.toString())
    .add(walletAsset.earnFlexibleQuantity.toString())
    .add(walletAsset.earnLockedQuantity.toString());
  const quoteResult = await fetchBinanceQuotes({ assets: [walletAsset.symbol, "BTC"] });
  const quote = quoteResult.quotes.find((candidate) => candidate.requestedAsset === walletAsset.symbol);
  const btcQuote = quoteResult.quotes.find((candidate) => candidate.requestedAsset === "BTC");
  let marketFields: ReturnType<typeof quoteFields> | {
    pricingSource: "BINANCE";
    unitPrice: Prisma.Decimal;
    currency: "BRL";
    fxRateToBrl: null;
    fxUpdatedAt: null;
    providerSymbol: null;
    marketExchange: string;
    marketQuoteType: string;
    priceUpdatedAt: Date;
    currentValue: null;
    providerCurrentValue: null;
  };
  if (quote) {
    marketFields = quoteFields(quote);
  } else if (btcQuote && walletAsset.btcValuation && quantity.gt(0)) {
    const btcBrl = new Decimal(btcQuote.price).mul(btcQuote.fxRateToBrl ?? 1);
    marketFields = {
      pricingSource: "BINANCE",
      unitPrice: new Prisma.Decimal(new Decimal(walletAsset.btcValuation.toString()).mul(btcBrl).div(quantity).toString()),
      currency: "BRL",
      fxRateToBrl: null,
      fxUpdatedAt: null,
      providerSymbol: null,
      marketExchange: "BINANCE",
      marketQuoteType: "BTC_VALUATION",
      priceUpdatedAt: btcQuote.asOf,
      currentValue: null,
      providerCurrentValue: null,
    };
  } else {
    throw new Error(`${walletAsset.symbol} ainda não possui uma cotação compatível para ser acompanhado.`);
  }

  await prisma.$transaction(async (tx) => {
    const asset = matchingAsset ?? await tx.asset.create({
      data: {
        portfolioId: portfolio.id,
        investmentClass: "CRYPTO",
        instrumentType: "CRYPTO",
        ticker: walletAsset.symbol,
        name: walletAsset.name ?? walletAsset.symbol,
        score: 0,
      },
      include: { holdings: true },
    });
    if (parsed.resolution === "REPLACE_MANUAL") {
      await tx.assetHolding.updateMany({
        where: { assetId: asset.id, positionSource: "MANUAL", includedInTotals: true },
        data: { includedInTotals: false, supersededAt: new Date() },
      });
    }
    const holdingData = {
      assetId: asset.id,
      issuer: "Binance",
      productName: `${walletAsset.symbol} · Binance`,
      positionSource: "BINANCE" as const,
      ticker: walletAsset.symbol,
      quantity: new Prisma.Decimal(quantity.toString()),
      includedInTotals: true,
      supersededAt: null,
      fractional: allowsFractionalUnits({ instrumentType: "CRYPTO", investmentClass: "CRYPTO", pricingSource: "BINANCE" }),
      ...marketFields,
    };
    const holding = walletAsset.holdingId
      ? await tx.assetHolding.update({ where: { id: walletAsset.holdingId }, data: holdingData })
      : await tx.assetHolding.create({ data: holdingData });
    await tx.binanceWalletAsset.update({
      where: { id: walletAsset.id },
      data: { status: "TRACKED", holdingId: holding.id },
    });
    await bumpPortfolioAndInvalidateDrafts(tx, portfolio.id, userId);
  });
  revalidateBinancePaths();
  return getBinanceConnectionStatus(userId);
}

export async function disconnectBinanceAction(resolution: "KEEP_MANUAL" | "REMOVE") {
  const userId = await requireUserId();
  const parsed = disconnectSchema.parse(resolution);
  await assertUserOperationRateLimit({ userId, operation: "binance-disconnect", limit: 5, windowMs: 15 * 60_000 });
  await prisma.$transaction(async (tx) => {
    const connection = await tx.binanceConnection.findUnique({
      where: { userId },
      include: { walletAssets: { where: { holdingId: { not: null } } } },
    });
    if (!connection) return;
    const holdingIds = connection.walletAssets.flatMap((asset) => asset.holdingId ? [asset.holdingId] : []);
    const holdings = holdingIds.length
      ? await tx.assetHolding.findMany({ where: { id: { in: holdingIds } }, select: { assetId: true } })
      : [];
    const assetIds = [...new Set(holdings.map((holding) => holding.assetId))];
    await tx.binanceWalletAsset.updateMany({ where: { connectionId: connection.id }, data: { holdingId: null } });
    if (parsed === "KEEP_MANUAL" && holdingIds.length) {
      await tx.assetHolding.updateMany({
        where: { id: { in: holdingIds } },
        data: { positionSource: "MANUAL", includedInTotals: true, supersededAt: null },
      });
    } else if (holdingIds.length) {
      await tx.assetHolding.deleteMany({ where: { id: { in: holdingIds } } });
      for (const assetId of assetIds) {
        const remaining = await tx.assetHolding.count({ where: { assetId } });
        const suggestions = await tx.contributionSuggestion.count({ where: { assetId } });
        if (!remaining && !suggestions) await tx.asset.delete({ where: { id: assetId } });
      }
    }
    await tx.binanceConnection.delete({ where: { id: connection.id } });
    const portfolio = await tx.portfolio.findUnique({ where: { userId } });
    if (portfolio) await bumpPortfolioAndInvalidateDrafts(tx, portfolio.id, userId);
  });
  revalidateBinancePaths();
}
