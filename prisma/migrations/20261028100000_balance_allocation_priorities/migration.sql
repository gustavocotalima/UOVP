-- Recalculate unexecuted v1 Improved drafts. Preserve recorded/provider-pending
-- contributions and their original calculation metadata.
UPDATE "ContributionSimulation" AS simulation
SET "status" = 'STALE'
WHERE simulation."allocationMethod" = 'IMPROVED'
  AND simulation."status" = 'DRAFT'
  AND simulation."calculationVersion" IS DISTINCT FROM '2'
  AND NOT EXISTS (
    SELECT 1 FROM "ContributionSuggestion" AS suggestion
    WHERE suggestion."simulationId" = simulation."id"
      AND suggestion."executionStatus" IN ('EXECUTED', 'AWAITING_SYNC')
  );
