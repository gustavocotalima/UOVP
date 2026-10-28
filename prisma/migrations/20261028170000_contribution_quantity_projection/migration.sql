ALTER TABLE "ContributionSuggestion"
  ADD COLUMN "usesQuantityProjection" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contributionBatchId" TEXT,
  ADD COLUMN "expectedQuantityAfter" DECIMAL(30,10),
  ADD COLUMN "syncResolution" TEXT;

CREATE TABLE "PluggyContributionBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "linkId" TEXT NOT NULL REFERENCES "PluggyInvestmentDiagramLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "holdingId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'WAITING' CHECK ("state" IN ('WAITING', 'CONFLICT', 'RESOLVED')),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "startingQuantity" DECIMAL(30,10) NOT NULL,
  "providerBaselineQuantity" DECIMAL(30,10) NOT NULL,
  "expectedQuantity" DECIMAL(30,10) NOT NULL,
  "acknowledgedQuantity" DECIMAL(30,10) NOT NULL,
  "observedQuantity" DECIMAL(30,10),
  "providerUpdatedAt" TIMESTAMP(3),
  "baselineCostNative" DECIMAL(30,10),
  "currency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3)
);
CREATE INDEX "PluggyContributionBatch_linkId_state_idx" ON "PluggyContributionBatch"("linkId", "state");
CREATE UNIQUE INDEX "PluggyContributionBatch_one_active_per_link" ON "PluggyContributionBatch"("linkId") WHERE "state" IN ('WAITING', 'CONFLICT');
ALTER TABLE "ContributionSuggestion" ADD CONSTRAINT "ContributionSuggestion_contributionBatchId_fkey"
  FOREIGN KEY ("contributionBatchId") REFERENCES "PluggyContributionBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ContributionSuggestion_contributionBatchId_executionStatus_idx" ON "ContributionSuggestion"("contributionBatchId", "executionStatus");
DROP INDEX "ContributionSuggestion_one_awaiting_per_asset";
CREATE UNIQUE INDEX "ContributionSuggestion_one_awaiting_per_asset" ON "ContributionSuggestion"("assetId")
  WHERE "executionStatus" = 'AWAITING_SYNC' AND NOT "usesQuantityProjection";

-- Legacy awaiting entries are initialized by reconciliation only after their
-- current provider position and destination have been checked. Never blindly
-- add historical contributions to positions that may already include them.
