CREATE TYPE "PluggyInvestmentSource" AS ENUM (
    'INVESTMENTS_API',
    'ACCOUNT_RESERVED_BALANCE',
    'ACCOUNT_AUTOMATIC_BALANCE'
);

ALTER TABLE "PluggyInvestment"
ADD COLUMN "source" "PluggyInvestmentSource" NOT NULL DEFAULT 'INVESTMENTS_API',
ADD COLUMN "pluggyAccountDbId" TEXT,
ADD COLUMN "providerReference" TEXT;

CREATE INDEX "PluggyInvestment_pluggyAccountDbId_source_idx"
ON "PluggyInvestment"("pluggyAccountDbId", "source");

CREATE UNIQUE INDEX "PluggyInvestment_pluggyAccountDbId_source_providerReference_key"
ON "PluggyInvestment"("pluggyAccountDbId", "source", "providerReference");

ALTER TABLE "PluggyInvestment"
ADD CONSTRAINT "PluggyInvestment_pluggyAccountDbId_fkey"
FOREIGN KEY ("pluggyAccountDbId") REFERENCES "PluggyAccount"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
