ALTER TYPE "PricingSource" ADD VALUE IF NOT EXISTS 'YAHOO';

ALTER TABLE "AssetHolding"
  ADD COLUMN "marketExchange" TEXT,
  ADD COLUMN "marketQuoteType" TEXT,
  ADD COLUMN "marketSector" TEXT,
  ADD COLUMN "marketIndustry" TEXT,
  ADD COLUMN "fxRateToBrl" DECIMAL(20, 10),
  ADD COLUMN "fxUpdatedAt" TIMESTAMP(3);

-- International positions were previously manual or accidentally routed through
-- brapi. They remain valued with their stored data until an exact Yahoo quote
-- and exchange rate are obtained by the unified refresh.
UPDATE "AssetHolding" holding
SET "pricingSource" = 'MANUAL'::"PricingSource"
FROM "Asset" asset
WHERE holding."assetId" = asset."id"
  AND asset."investmentClass" IN ('INTERNATIONAL_STOCKS', 'REITS')
  AND holding."pricingSource" = 'BRAPI'::"PricingSource";
