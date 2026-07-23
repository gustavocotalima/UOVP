ALTER TYPE "InstrumentType" ADD VALUE IF NOT EXISTS 'MUTUAL_FUND';
ALTER TYPE "PricingSource" ADD VALUE IF NOT EXISTS 'PLUGGY';

CREATE TYPE "PositionSource" AS ENUM ('MANUAL', 'PLUGGY');
CREATE TYPE "ClassificationSource" AS ENUM ('AUTO', 'EXISTING_OVERRIDE', 'USER_OVERRIDE');
CREATE TYPE "PluggyDiagramMappingStatus" AS ENUM ('MAPPED', 'NEEDS_REVIEW', 'EXCLUDED');
CREATE TYPE "SuggestionExecutionStatus" AS ENUM ('PENDING', 'AWAITING_SYNC', 'EXECUTED');

ALTER TABLE "UserPreference"
  ADD COLUMN "showSoldInvestments" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Asset"
  ADD COLUMN "instrumentSource" "ClassificationSource" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "exposureSource" "ClassificationSource" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "groupSource" "ClassificationSource" NOT NULL DEFAULT 'AUTO';

UPDATE "Asset"
SET "exposureSource" = 'EXISTING_OVERRIDE';

UPDATE "Asset"
SET
  "instrumentSource" = 'EXISTING_OVERRIDE',
  "groupSource" = CASE
    WHEN "fixedIncomeFamilyCode" IS NOT NULL THEN 'EXISTING_OVERRIDE'::"ClassificationSource"
    ELSE "groupSource"
  END
WHERE "instrumentType" = 'ETF';

UPDATE "Asset"
SET
  "instrumentType" = 'ETF',
  "investmentClass" = 'FIXED_INCOME',
  "fixedIncomeFamilyCode" = 'PUBLIC_TREASURY',
  "indexation" = 'OTHER',
  "instrumentSource" = 'EXISTING_OVERRIDE',
  "exposureSource" = 'EXISTING_OVERRIDE',
  "groupSource" = 'EXISTING_OVERRIDE'
WHERE UPPER("ticker") = 'AUPO11';

ALTER TABLE "AssetHolding"
  ADD COLUMN "positionSource" "PositionSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "providerCurrentValue" DECIMAL(30,2),
  ADD COLUMN "includedInTotals" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "supersededAt" TIMESTAMP(3);

ALTER TABLE "PluggyInvestment"
  ADD COLUMN "providerAvailable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "providerRemovedAt" TIMESTAMP(3);

ALTER TABLE "ContributionSuggestion"
  ADD COLUMN "executionStatus" "SuggestionExecutionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "awaitingSyncAt" TIMESTAMP(3),
  ADD COLUMN "baselineQuantity" DECIMAL(30,10),
  ADD COLUMN "baselineValue" DECIMAL(30,2);

UPDATE "ContributionSuggestion"
SET "executionStatus" = 'EXECUTED'
WHERE "executed" = true;

CREATE TABLE "PluggyInvestmentDiagramLink" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pluggyInvestmentDbId" TEXT NOT NULL,
  "assetHoldingId" TEXT,
  "status" "PluggyDiagramMappingStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "classificationSource" "ClassificationSource" NOT NULL DEFAULT 'AUTO',
  "suggestedInvestmentClass" "InvestmentClass",
  "suggestedInstrumentType" "InstrumentType",
  "suggestedFamilyCode" TEXT,
  "suggestedIndexation" "FixedIncomeIndexation",
  "reviewReason" TEXT,
  "lastReconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PluggyInvestmentDiagramLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluggyInvestmentDiagramLink_pluggyInvestmentDbId_key"
  ON "PluggyInvestmentDiagramLink"("pluggyInvestmentDbId");
CREATE UNIQUE INDEX "PluggyInvestmentDiagramLink_assetHoldingId_key"
  ON "PluggyInvestmentDiagramLink"("assetHoldingId");
CREATE INDEX "PluggyInvestmentDiagramLink_userId_status_idx"
  ON "PluggyInvestmentDiagramLink"("userId", "status");
CREATE INDEX "PluggyInvestmentDiagramLink_assetHoldingId_idx"
  ON "PluggyInvestmentDiagramLink"("assetHoldingId");

ALTER TABLE "PluggyInvestmentDiagramLink"
  ADD CONSTRAINT "PluggyInvestmentDiagramLink_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PluggyInvestmentDiagramLink"
  ADD CONSTRAINT "PluggyInvestmentDiagramLink_pluggyInvestmentDbId_fkey"
  FOREIGN KEY ("pluggyInvestmentDbId") REFERENCES "PluggyInvestment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PluggyInvestmentDiagramLink"
  ADD CONSTRAINT "PluggyInvestmentDiagramLink_assetHoldingId_fkey"
  FOREIGN KEY ("assetHoldingId") REFERENCES "AssetHolding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
