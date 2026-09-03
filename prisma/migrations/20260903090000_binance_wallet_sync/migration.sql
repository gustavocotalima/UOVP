ALTER TYPE "PositionSource" ADD VALUE IF NOT EXISTS 'BINANCE';

CREATE TYPE "BinanceWalletAssetStatus" AS ENUM ('AVAILABLE', 'NEEDS_REVIEW', 'TRACKED', 'IGNORED');

CREATE TABLE "BinanceConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "apiKeyCiphertext" TEXT NOT NULL,
  "apiKeyLastFour" TEXT NOT NULL,
  "apiSecretCiphertext" TEXT NOT NULL,
  "credentialUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  "ipRestricted" BOOLEAN NOT NULL DEFAULT false,
  "readEnabled" BOOLEAN NOT NULL DEFAULT true,
  "tradingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "withdrawalsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "permissionWarning" BOOLEAN NOT NULL DEFAULT false,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "syncPending" BOOLEAN NOT NULL DEFAULT true,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BinanceConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BinanceWalletAsset" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "name" TEXT,
  "status" "BinanceWalletAssetStatus" NOT NULL DEFAULT 'AVAILABLE',
  "spotQuantity" DECIMAL(30,10) NOT NULL DEFAULT 0,
  "fundingQuantity" DECIMAL(30,10) NOT NULL DEFAULT 0,
  "earnFlexibleQuantity" DECIMAL(30,10) NOT NULL DEFAULT 0,
  "earnLockedQuantity" DECIMAL(30,10) NOT NULL DEFAULT 0,
  "btcValuation" DECIMAL(30,12),
  "spotUpdatedAt" TIMESTAMP(3),
  "fundingUpdatedAt" TIMESTAMP(3),
  "earnFlexibleUpdatedAt" TIMESTAMP(3),
  "earnLockedUpdatedAt" TIMESTAMP(3),
  "holdingId" TEXT,
  "lastSeenAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BinanceWalletAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BinanceConnection_userId_key" ON "BinanceConnection"("userId");
CREATE INDEX "BinanceConnection_syncPending_lastSyncAt_idx" ON "BinanceConnection"("syncPending", "lastSyncAt");
CREATE UNIQUE INDEX "BinanceWalletAsset_holdingId_key" ON "BinanceWalletAsset"("holdingId");
CREATE UNIQUE INDEX "BinanceWalletAsset_connectionId_symbol_key" ON "BinanceWalletAsset"("connectionId", "symbol");
CREATE INDEX "BinanceWalletAsset_connectionId_status_idx" ON "BinanceWalletAsset"("connectionId", "status");

ALTER TABLE "BinanceConnection"
  ADD CONSTRAINT "BinanceConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BinanceWalletAsset"
  ADD CONSTRAINT "BinanceWalletAsset_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "BinanceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BinanceWalletAsset"
  ADD CONSTRAINT "BinanceWalletAsset_holdingId_fkey"
  FOREIGN KEY ("holdingId") REFERENCES "AssetHolding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
