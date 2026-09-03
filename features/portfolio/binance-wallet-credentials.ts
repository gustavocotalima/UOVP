import { prisma } from "@/lib/prisma";
import { decryptCredential, encryptCredential } from "@/lib/credential-cipher";
import Decimal from "decimal.js";
import type { BinanceApiPermissions, BinancePrivateCredentials } from "./binance-wallet-client";

export type BinanceWalletAssetStatusDto = "AVAILABLE" | "NEEDS_REVIEW" | "TRACKED" | "IGNORED";

export type BinanceWalletAssetDto = {
  id: string;
  symbol: string;
  name: string | null;
  status: BinanceWalletAssetStatusDto;
  spotQuantity: string;
  fundingQuantity: string;
  earnFlexibleQuantity: string;
  earnLockedQuantity: string;
  totalQuantity: string;
  btcValuation: string | null;
  valuationSupported: boolean | null;
  valuationMethod: string | null;
  valuationError: string | null;
  holdingId: string | null;
  lastSeenAt: string | null;
};

export type BinanceConnectionStatus = {
  configured: boolean;
  apiKeyLastFour: string | null;
  updatedAt: string | null;
  status: string | null;
  ipRestricted: boolean;
  readEnabled: boolean;
  tradingEnabled: boolean;
  withdrawalsEnabled: boolean;
  permissionWarning: boolean;
  lastAttemptAt: string | null;
  lastSyncAt: string | null;
  syncPending: boolean;
  lastError: string | null;
  assets: BinanceWalletAssetDto[];
};

function totalQuantity(asset: {
  spotQuantity: { toString(): string };
  fundingQuantity: { toString(): string };
  earnFlexibleQuantity: { toString(): string };
  earnLockedQuantity: { toString(): string };
}) {
  return new Decimal(asset.spotQuantity.toString())
    .add(asset.fundingQuantity.toString())
    .add(asset.earnFlexibleQuantity.toString())
    .add(asset.earnLockedQuantity.toString())
    .toString();
}

export async function getBinanceConnectionStatus(userId: string): Promise<BinanceConnectionStatus> {
  const connection = await prisma.binanceConnection.findUnique({
    where: { userId },
    include: { walletAssets: { orderBy: { symbol: "asc" } } },
  });
  if (!connection) {
    return {
      configured: false,
      apiKeyLastFour: null,
      updatedAt: null,
      status: null,
      ipRestricted: false,
      readEnabled: false,
      tradingEnabled: false,
      withdrawalsEnabled: false,
      permissionWarning: false,
      lastAttemptAt: null,
      lastSyncAt: null,
      syncPending: false,
      lastError: null,
      assets: [],
    };
  }
  return {
    configured: true,
    apiKeyLastFour: connection.apiKeyLastFour,
    updatedAt: connection.credentialUpdatedAt.toISOString(),
    status: connection.status,
    ipRestricted: connection.ipRestricted,
    readEnabled: connection.readEnabled,
    tradingEnabled: connection.tradingEnabled,
    withdrawalsEnabled: connection.withdrawalsEnabled,
    permissionWarning: connection.permissionWarning,
    lastAttemptAt: connection.lastAttemptAt?.toISOString() ?? null,
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
    syncPending: connection.syncPending,
    lastError: connection.lastError,
    assets: connection.walletAssets.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      status: asset.status,
      spotQuantity: asset.spotQuantity.toString(),
      fundingQuantity: asset.fundingQuantity.toString(),
      earnFlexibleQuantity: asset.earnFlexibleQuantity.toString(),
      earnLockedQuantity: asset.earnLockedQuantity.toString(),
      totalQuantity: totalQuantity(asset),
      btcValuation: asset.btcValuation?.toString() ?? null,
      valuationSupported: asset.valuationSupported,
      valuationMethod: asset.valuationMethod,
      valuationError: asset.valuationError,
      holdingId: asset.holdingId,
      lastSeenAt: asset.lastSeenAt?.toISOString() ?? null,
    })),
  };
}

export async function requireBinanceCredentials(userId: string): Promise<BinancePrivateCredentials> {
  const connection = await prisma.binanceConnection.findUnique({ where: { userId } });
  if (!connection) throw new Error("Conecte sua carteira da Binance em Configurações.");
  const apiKey = decryptCredential(connection.apiKeyCiphertext, { userId, type: "binance-api-key" });
  const apiSecret = decryptCredential(connection.apiSecretCiphertext, { userId, type: "binance-api-secret" });
  if (apiKey.needsRotation || apiSecret.needsRotation) {
    await prisma.binanceConnection.updateMany({
      where: {
        id: connection.id,
        apiKeyCiphertext: connection.apiKeyCiphertext,
        apiSecretCiphertext: connection.apiSecretCiphertext,
      },
      data: {
        apiKeyCiphertext: encryptCredential(apiKey.value, { userId, type: "binance-api-key" }),
        apiSecretCiphertext: encryptCredential(apiSecret.value, { userId, type: "binance-api-secret" }),
        credentialUpdatedAt: new Date(),
      },
    });
  }
  return { apiKey: apiKey.value, apiSecret: apiSecret.value };
}

export async function storeBinanceCredentials(
  userId: string,
  credentials: BinancePrivateCredentials,
  permissions: BinanceApiPermissions,
) {
  const now = new Date();
  return prisma.binanceConnection.upsert({
    where: { userId },
    update: {
      apiKeyCiphertext: encryptCredential(credentials.apiKey, { userId, type: "binance-api-key" }),
      apiKeyLastFour: credentials.apiKey.slice(-4),
      apiSecretCiphertext: encryptCredential(credentials.apiSecret, { userId, type: "binance-api-secret" }),
      credentialUpdatedAt: now,
      status: "CONNECTED",
      ipRestricted: permissions.ipRestricted,
      readEnabled: permissions.readEnabled,
      tradingEnabled: permissions.tradingEnabled,
      withdrawalsEnabled: permissions.withdrawalsEnabled,
      permissionWarning: permissions.warning,
      syncPending: true,
      lastError: null,
    },
    create: {
      userId,
      apiKeyCiphertext: encryptCredential(credentials.apiKey, { userId, type: "binance-api-key" }),
      apiKeyLastFour: credentials.apiKey.slice(-4),
      apiSecretCiphertext: encryptCredential(credentials.apiSecret, { userId, type: "binance-api-secret" }),
      credentialUpdatedAt: now,
      status: "CONNECTED",
      ipRestricted: permissions.ipRestricted,
      readEnabled: permissions.readEnabled,
      tradingEnabled: permissions.tradingEnabled,
      withdrawalsEnabled: permissions.withdrawalsEnabled,
      permissionWarning: permissions.warning,
      syncPending: true,
    },
  });
}
