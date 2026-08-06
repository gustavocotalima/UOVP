-- Existing balances are authoritative. Historical transactions start detached
-- from those balances so future edits and deletions cannot reverse them.
ALTER TABLE "FinancialAccount"
ADD COLUMN "balanceSnapshotAt" TIMESTAMP(3);

ALTER TABLE "FinanceTransaction"
ADD COLUMN "balanceApplied" BOOLEAN NOT NULL DEFAULT false;

UPDATE "FinancialAccount"
SET "balanceSnapshotAt" = CURRENT_TIMESTAMP
WHERE "source" = 'MANUAL';
