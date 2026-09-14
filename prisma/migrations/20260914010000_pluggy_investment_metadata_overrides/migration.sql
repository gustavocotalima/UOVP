CREATE TYPE "PluggyInvestmentMetadataOverrideField" AS ENUM (
  'PRODUCT_NAME',
  'ISSUER',
  'PRODUCT_TYPE',
  'RATE_TERMS',
  'PURCHASE_DATE',
  'MATURITY_DATE'
);

ALTER TABLE "PluggyInvestmentDiagramLink"
  ADD COLUMN "metadataOverrideFields" "PluggyInvestmentMetadataOverrideField"[] NOT NULL DEFAULT ARRAY[]::"PluggyInvestmentMetadataOverrideField"[],
  ADD COLUMN "overrideProductName" TEXT,
  ADD COLUMN "overrideIssuer" TEXT,
  ADD COLUMN "overrideCatalogItemId" INTEGER,
  ADD COLUMN "overrideCustomTypeName" TEXT,
  ADD COLUMN "overrideRateConvention" "RateConvention",
  ADD COLUMN "overrideBenchmark" TEXT,
  ADD COLUMN "overrideRateValue" DECIMAL(12, 6),
  ADD COLUMN "overridePurchaseDate" TIMESTAMP(3),
  ADD COLUMN "overrideMaturityDate" TIMESTAMP(3),
  ADD COLUMN "metadataOverrideUpdatedAt" TIMESTAMP(3);
