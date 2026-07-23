CREATE TYPE "InstrumentType" AS ENUM ('STOCK', 'ETF', 'REAL_ESTATE_FUND', 'REIT', 'CRYPTO', 'FIXED_INCOME');
CREATE TYPE "PricingSource" AS ENUM ('MANUAL', 'BRAPI');
CREATE TYPE "FixedIncomeIndexation" AS ENUM ('PRE_FIXED', 'POST_FIXED', 'INFLATION', 'OTHER');
CREATE TYPE "RateConvention" AS ENUM ('FIXED_ANNUAL', 'PERCENT_OF_INDEXER', 'INDEXER_PLUS', 'OTHER');

CREATE TABLE "FixedIncomeFamily" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shortCode" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FixedIncomeFamily_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "AssetCatalogItem" (
  "id" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "taxPF" TEXT NOT NULL,
  "taxPJ" TEXT NOT NULL,
  "howToBuy" TEXT NOT NULL,
  "costs" TEXT NOT NULL,
  "risks" TEXT NOT NULL,
  "guarantees" TEXT NOT NULL,
  "familyCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TEMP TABLE "AssetMigrationBackup" (
  "id" TEXT NOT NULL,
  "sourceAssetId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetMigrationBackup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssetMigrationBackup_sourceAssetId_key" UNIQUE ("sourceAssetId")
) ON COMMIT DROP;

CREATE INDEX "AssetCatalogItem_category_idx" ON "AssetCatalogItem"("category");
CREATE INDEX "AssetCatalogItem_familyCode_idx" ON "AssetCatalogItem"("familyCode");

INSERT INTO "AssetMigrationBackup" ("id", "sourceAssetId", "payload")
SELECT
  'asset-backup-' || "id",
  "id",
  jsonb_build_object(
    'portfolioId', "portfolioId",
    'investmentClass', "investmentClass"::text,
    'ticker', "ticker",
    'name', "name",
    'logoUrl', "logoUrl",
    'currency', "currency",
    'quantity', "quantity"::text,
    'unitPrice', "unitPrice"::text,
    'manualValue', "manualValue"::text,
    'fractional', "fractional",
    'score', "score",
    'priceUpdatedAt', "priceUpdatedAt",
    'createdAt', "createdAt",
    'updatedAt', "updatedAt"
  )
FROM "Asset";

ALTER TABLE "Asset" ADD COLUMN "instrumentType" "InstrumentType";
ALTER TABLE "Asset" ADD COLUMN "fixedIncomeFamilyCode" TEXT;
ALTER TABLE "Asset" ADD COLUMN "indexation" "FixedIncomeIndexation";

UPDATE "Asset"
SET "instrumentType" = CASE
  WHEN "ticker" IN ('AUPO11', 'AUVP11') THEN 'ETF'::"InstrumentType"
  WHEN "investmentClass" = 'REAL_ESTATE_FUNDS' THEN 'REAL_ESTATE_FUND'::"InstrumentType"
  WHEN "investmentClass" = 'REITS' THEN 'REIT'::"InstrumentType"
  WHEN "investmentClass" = 'CRYPTO' THEN 'CRYPTO'::"InstrumentType"
  WHEN "investmentClass" IN ('FIXED_INCOME', 'INTERNATIONAL_FIXED_INCOME') THEN 'FIXED_INCOME'::"InstrumentType"
  ELSE 'STOCK'::"InstrumentType"
END;

ALTER TABLE "Asset" ALTER COLUMN "instrumentType" SET NOT NULL;

CREATE TABLE "AssetHolding" (
  "id" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "catalogItemId" INTEGER,
  "customTypeName" TEXT,
  "issuer" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "pricingSource" "PricingSource" NOT NULL,
  "ticker" TEXT,
  "brapiAssetType" TEXT,
  "brapiSubType" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "quantity" DECIMAL(30,10) NOT NULL DEFAULT 0,
  "unitPrice" DECIMAL(30,10) NOT NULL DEFAULT 0,
  "investedValue" DECIMAL(30,2),
  "currentValue" DECIMAL(30,2),
  "fractional" BOOLEAN NOT NULL DEFAULT false,
  "rateConvention" "RateConvention",
  "benchmark" TEXT,
  "rateValue" DECIMAL(12,6),
  "purchaseDate" TIMESTAMP(3),
  "maturityDate" TIMESTAMP(3),
  "logoUrl" TEXT,
  "priceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetHolding_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AssetHolding" (
  "id", "assetId", "issuer", "productName", "pricingSource", "ticker", "currency",
  "quantity", "unitPrice", "investedValue", "currentValue", "fractional", "logoUrl",
  "priceUpdatedAt", "createdAt", "updatedAt"
)
SELECT
  'holding-' || "id",
  "id",
  "name",
  "name",
  CASE
    WHEN "investmentClass" IN ('BRAZILIAN_STOCKS', 'REAL_ESTATE_FUNDS') OR "ticker" IN ('AUPO11', 'AUVP11')
      THEN 'BRAPI'::"PricingSource"
    ELSE 'MANUAL'::"PricingSource"
  END,
  "ticker",
  "currency",
  "quantity",
  "unitPrice",
  COALESCE("manualValue", "quantity" * "unitPrice"),
  CASE WHEN "ticker" = 'AUPO11' THEN COALESCE("manualValue", "quantity" * "unitPrice") ELSE "manualValue" END,
  CASE WHEN "ticker" = 'AUPO11' THEN true ELSE "fractional" END,
  "logoUrl",
  "priceUpdatedAt",
  "createdAt",
  "updatedAt"
FROM "Asset"
WHERE "investmentClass" NOT IN ('FIXED_INCOME', 'INTERNATIONAL_FIXED_INCOME') OR "ticker" = 'AUPO11';

UPDATE "ContributionSimulation"
SET "status" = 'STALE'
WHERE "id" IN (
  SELECT DISTINCT suggestion."simulationId"
  FROM "ContributionSuggestion" suggestion
  JOIN "Asset" asset ON asset."id" = suggestion."assetId"
  WHERE asset."investmentClass" IN ('FIXED_INCOME', 'INTERNATIONAL_FIXED_INCOME')
    AND asset."ticker" <> 'AUPO11'
);

DELETE FROM "ContributionSuggestion"
WHERE "assetId" IN (
  SELECT "id" FROM "Asset"
  WHERE "investmentClass" IN ('FIXED_INCOME', 'INTERNATIONAL_FIXED_INCOME')
    AND "ticker" <> 'AUPO11'
);

DELETE FROM "Asset"
WHERE "investmentClass" IN ('FIXED_INCOME', 'INTERNATIONAL_FIXED_INCOME')
  AND "ticker" <> 'AUPO11';

ALTER TABLE "Asset" DROP COLUMN "logoUrl";
ALTER TABLE "Asset" DROP COLUMN "currency";
ALTER TABLE "Asset" DROP COLUMN "quantity";
ALTER TABLE "Asset" DROP COLUMN "unitPrice";
ALTER TABLE "Asset" DROP COLUMN "manualValue";
ALTER TABLE "Asset" DROP COLUMN "fractional";
ALTER TABLE "Asset" DROP COLUMN "priceUpdatedAt";

CREATE INDEX "Asset_portfolioId_instrumentType_idx" ON "Asset"("portfolioId", "instrumentType");
CREATE UNIQUE INDEX "Asset_portfolioId_fixedIncomeFamilyCode_indexation_key" ON "Asset"("portfolioId", "fixedIncomeFamilyCode", "indexation");
CREATE INDEX "AssetHolding_assetId_idx" ON "AssetHolding"("assetId");
CREATE INDEX "AssetHolding_pricingSource_ticker_idx" ON "AssetHolding"("pricingSource", "ticker");
CREATE INDEX "AssetHolding_catalogItemId_idx" ON "AssetHolding"("catalogItemId");

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_fixedIncomeFamilyCode_fkey" FOREIGN KEY ("fixedIncomeFamilyCode") REFERENCES "FixedIncomeFamily"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetCatalogItem" ADD CONSTRAINT "AssetCatalogItem_familyCode_fkey" FOREIGN KEY ("familyCode") REFERENCES "FixedIncomeFamily"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetHolding" ADD CONSTRAINT "AssetHolding_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetHolding" ADD CONSTRAINT "AssetHolding_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "AssetCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE IF EXISTS "AssetMigrationBackup";
