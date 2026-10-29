-- Deploy with the previous application stopped; this migration removes its tables.
BEGIN;
ALTER TABLE "PluggyInvestmentTransaction" ADD COLUMN "contributionMatched" BOOLEAN NOT NULL DEFAULT false;
UPDATE "PluggyInvestmentTransaction" t SET "contributionMatched" = true
WHERE EXISTS (SELECT 1 FROM "ContributionSuggestion" s WHERE s."confirmationReference" = 'PLUGGY_TRANSACTION:' || t."id");

-- Fold confirmed purchases into each active batch before removing their rows.
UPDATE "PluggyContributionBatch" b SET "baselineCostNative" = CASE
  WHEN b."baselineCostNative" IS NULL OR EXISTS (
    SELECT 1 FROM "ContributionSuggestion" s WHERE s."contributionBatchId" = b."id" AND s."executionStatus" = 'EXECUTED'
    AND COALESCE(s."paidUnitPriceNative", CASE WHEN b."currency" = 'BRL' THEN s."paidUnitPrice" END) IS NULL
  ) THEN NULL ELSE b."baselineCostNative" + COALESCE((
    SELECT SUM(s."quantity" * COALESCE(s."paidUnitPriceNative", CASE WHEN b."currency" = 'BRL' THEN s."paidUnitPrice" END))
    FROM "ContributionSuggestion" s WHERE s."contributionBatchId" = b."id" AND s."executionStatus" = 'EXECUTED'
  ), 0) END
WHERE b."state" IN ('WAITING', 'CONFLICT');

DROP TRIGGER "ContributionSuggestion_tenant_guard" ON "ContributionSuggestion";
DROP FUNCTION "guard_contribution_suggestion_tenant"();
ALTER TABLE "ContributionSuggestion" ADD COLUMN "userId" TEXT, ADD COLUMN "holdingId" TEXT,
  ADD COLUMN "baselines" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ContributionSuggestion" s SET "userId" = p."userId", "awaitingSyncAt" = COALESCE(s."awaitingSyncAt", p."createdAt"),
  "holdingId" = (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(x."holdingId") END FROM "ContributionExternalBaseline" x WHERE x."suggestionId" = s."id"),
  "baselines" = COALESCE((SELECT jsonb_agg(jsonb_build_object('holdingId', x."holdingId", 'quantity', x."quantity"::text,
    'providerValue', x."providerValue"::text, 'currency', x."currency", 'fxRateToBrl', x."fxRateToBrl"::text,
    'providerLatestTransactionAt', x."providerLatestTransactionAt" AT TIME ZONE 'UTC')) FROM "ContributionExternalBaseline" x WHERE x."suggestionId" = s."id"), '[]'),
  "needsReview" = COALESCE(s."syncResolution" = 'NEEDS_REVIEW', false)
FROM "ContributionSimulation" p
WHERE p."id" = s."simulationId";
UPDATE "ContributionSuggestion" s SET "holdingId" = b."holdingId"
FROM "PluggyContributionBatch" b WHERE b."id" = s."contributionBatchId";
UPDATE "ContributionSuggestion" s SET "contributionBatchId" = NULL, "needsReview" = true FROM "PluggyContributionBatch" b WHERE b."id" = s."contributionBatchId" AND b."state" = 'RESOLVED';
-- Never infer a temporary quantity for an old purchase without an active batch.
UPDATE "ContributionSuggestion" s SET "needsReview" = true
FROM "Asset" a WHERE a."id" = s."assetId" AND s."contributionBatchId" IS NULL
AND a."instrumentType" <> 'FIXED_INCOME'
AND EXISTS (SELECT 1 FROM "AssetHolding" h WHERE h."assetId" = a."id" AND h."positionSource" = 'PLUGGY');
DELETE FROM "ContributionSuggestion" WHERE "executionStatus" <> 'AWAITING_SYNC';
DROP TABLE "ContributionExternalBaseline";
DROP INDEX "ContributionSuggestion_one_awaiting_per_asset";
ALTER TABLE "ContributionSuggestion" DROP CONSTRAINT "ContributionSuggestion_simulationId_fkey",
  DROP CONSTRAINT "ContributionSuggestion_contributionBatchId_fkey", DROP CONSTRAINT "ContributionSuggestion_assetId_fkey",
  DROP COLUMN "simulationId", DROP COLUMN "suggestionPercentage", DROP COLUMN "totalAfterSuggestionPercentage",
  DROP COLUMN "executed", DROP COLUMN "executionStatus", DROP COLUMN "confirmationReference", DROP COLUMN "usesQuantityProjection",
  DROP COLUMN "syncResolution", DROP COLUMN "nativeUnitPrice";
ALTER TABLE "ContributionSuggestion" ALTER COLUMN "userId" SET NOT NULL,
  ALTER COLUMN "awaitingSyncAt" SET NOT NULL, ALTER COLUMN "awaitingSyncAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ContributionSuggestion" RENAME TO "PendingContribution";
ALTER TABLE "PendingContribution" RENAME CONSTRAINT "ContributionSuggestion_pkey" TO "PendingContribution_pkey";
ALTER INDEX "ContributionSuggestion_assetId_idx" RENAME TO "PendingContribution_assetId_idx";
ALTER TABLE "PendingContribution" ADD CONSTRAINT "PendingContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PendingContribution_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PendingContribution_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "AssetHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PendingContribution_contributionBatchId_fkey" FOREIGN KEY ("contributionBatchId") REFERENCES "PluggyContributionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "PendingContribution_userId_awaitingSyncAt_idx" ON "PendingContribution"("userId", "awaitingSyncAt");
CREATE INDEX "PendingContribution_contributionBatchId_idx" ON "PendingContribution"("contributionBatchId");
CREATE UNIQUE INDEX "PendingContribution_one_unprojected_per_asset" ON "PendingContribution"("assetId") WHERE "contributionBatchId" IS NULL AND NOT "needsReview";
DELETE FROM "PluggyContributionBatch" b WHERE b."state" = 'RESOLVED' OR NOT EXISTS (SELECT 1 FROM "PendingContribution" p WHERE p."contributionBatchId" = b."id");
ALTER TABLE "PluggyContributionBatch" DROP COLUMN "resolvedAt", DROP CONSTRAINT "PluggyContributionBatch_state_check";
ALTER TABLE "PluggyContributionBatch" ADD CONSTRAINT "PluggyContributionBatch_state_check" CHECK ("state" IN ('WAITING', 'CONFLICT'));
DROP TABLE "ContributionSimulation";
ALTER TABLE "Portfolio" DROP COLUMN "version";
DROP TYPE "SimulationStatus";
DROP TYPE "SuggestionExecutionStatus";
DROP TYPE "ContributionCurrency";
DROP TYPE "ContributionScope";

CREATE FUNCTION "guard_pending_contribution_tenant"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Asset" a JOIN "Portfolio" p ON p."id" = a."portfolioId" WHERE a."id" = NEW."assetId" AND p."userId" = NEW."userId")
 OR (NEW."holdingId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AssetHolding" h WHERE h."id" = NEW."holdingId" AND h."assetId" = NEW."assetId"))
 OR (NEW."contributionBatchId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PluggyContributionBatch" b JOIN "PluggyInvestmentDiagramLink" l ON l."id" = b."linkId" WHERE b."id" = NEW."contributionBatchId" AND l."userId" = NEW."userId" AND b."holdingId" = NEW."holdingId"))
 THEN RAISE EXCEPTION 'PendingContribution cannot cross tenant boundaries'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "PendingContribution_tenant_guard" BEFORE INSERT OR UPDATE OF "userId", "assetId", "holdingId", "contributionBatchId" ON "PendingContribution" FOR EACH ROW EXECUTE FUNCTION "guard_pending_contribution_tenant"();

DROP TABLE "BudgetTarget", "Expense", "BudgetMonth", "RecurringExpense", "FaqItem", "FaqCategory", "InvestorProfilePreset";
DROP FUNCTION "guard_expense_tenant"();
COMMIT;
