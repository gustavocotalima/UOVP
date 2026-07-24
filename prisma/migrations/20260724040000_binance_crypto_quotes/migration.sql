ALTER TYPE "PricingSource" ADD VALUE IF NOT EXISTS 'BINANCE';

ALTER TABLE "AssetHolding"
  ADD COLUMN "providerSymbol" TEXT;

CREATE INDEX "AssetHolding_pricingSource_providerSymbol_idx"
  ON "AssetHolding"("pricingSource", "providerSymbol");
