-- New funding policies require recalculation. Recorded/provider-pending
-- suggestions and their original policy metadata remain historical records.
UPDATE "ContributionSimulation" AS simulation
SET "status" = 'STALE'
WHERE simulation."status" = 'DRAFT'
  AND ((simulation."allocationMethod" = 'IMPROVED' AND simulation."calculationVersion" IS DISTINCT FROM '3')
    OR (simulation."allocationMethod" = 'CERRADO' AND simulation."calculationVersion" IS DISTINCT FROM '2'))
  AND NOT EXISTS (
    SELECT 1 FROM "ContributionSuggestion" AS suggestion
    WHERE suggestion."simulationId" = simulation."id"
      AND suggestion."executionStatus" IN ('EXECUTED', 'AWAITING_SYNC')
  );
