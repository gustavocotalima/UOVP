CREATE TYPE "AllocationMethod" AS ENUM ('IMPROVED', 'CERRADO');
ALTER TABLE "UserPreference" ADD COLUMN "allocationMethod" "AllocationMethod" NOT NULL DEFAULT 'IMPROVED';
ALTER TABLE "ContributionSimulation"
  ADD COLUMN "allocationMethod" "AllocationMethod",
  ADD COLUMN "calculationVersion" TEXT,
  ADD COLUMN "calculationDetails" JSONB,
  ALTER COLUMN "requestedAmount" TYPE DECIMAL(32,12),
  ALTER COLUMN "unallocatedAmount" TYPE DECIMAL(32,12);
-- Historical records are not relabelled. Keep executed/awaiting-sync entries;
-- only their outstanding executable drafts must be recalculated.
UPDATE "ContributionSimulation" SET "status" = 'STALE' WHERE "status" = 'DRAFT';
