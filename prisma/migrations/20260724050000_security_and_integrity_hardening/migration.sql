CREATE TYPE "PluggyDisconnectionResolution" AS ENUM ('PENDING', 'KEEP_MANUAL', 'REMOVE');

ALTER TABLE "PluggyItem"
ADD COLUMN "disconnectedAt" TIMESTAMP(3),
ADD COLUMN "disconnectionResolution" "PluggyDisconnectionResolution";

ALTER TABLE "ContributionSuggestion"
ADD COLUMN "confirmationReference" TEXT;

ALTER TABLE "UserPreference"
ADD COLUMN "pluggyWebhookSecretCiphertext" TEXT,
ADD COLUMN "pluggyWebhookSecretLastFour" TEXT,
ADD COLUMN "pluggyWebhookSecretUpdatedAt" TIMESTAMP(3);

CREATE TABLE "PluggyWebhookEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "itemId" TEXT,
  "processingStartedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PluggyWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserOperationLease" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "lockedUntil" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserOperationLease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluggyWebhookEvent_userId_eventId_key"
ON "PluggyWebhookEvent"("userId", "eventId");
CREATE INDEX "PluggyWebhookEvent_processedAt_idx" ON "PluggyWebhookEvent"("processedAt");
CREATE INDEX "PluggyWebhookEvent_itemId_idx" ON "PluggyWebhookEvent"("itemId");
CREATE UNIQUE INDEX "UserOperationLease_userId_operation_key" ON "UserOperationLease"("userId", "operation");
CREATE INDEX "UserOperationLease_lockedUntil_idx" ON "UserOperationLease"("lockedUntil");
CREATE UNIQUE INDEX "ContributionSuggestion_confirmationReference_key"
ON "ContributionSuggestion"("confirmationReference");
CREATE INDEX "PluggyItem_userId_disconnectionResolution_idx"
ON "PluggyItem"("userId", "disconnectionResolution");

ALTER TABLE "PluggyWebhookEvent"
ADD CONSTRAINT "PluggyWebhookEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

WITH ranked AS (
  SELECT
    suggestion."id",
    suggestion."simulationId",
    ROW_NUMBER() OVER (
      PARTITION BY suggestion."assetId"
      ORDER BY suggestion."awaitingSyncAt" DESC NULLS LAST, suggestion."id" DESC
    ) AS position
  FROM "ContributionSuggestion" suggestion
  WHERE suggestion."executionStatus" = 'AWAITING_SYNC'
)
UPDATE "ContributionSimulation" simulation
SET "status" = 'STALE'
WHERE simulation."id" IN (
  SELECT ranked."simulationId"
  FROM ranked
  WHERE ranked.position > 1
);

WITH ranked AS (
  SELECT
    suggestion."id",
    ROW_NUMBER() OVER (
      PARTITION BY suggestion."assetId"
      ORDER BY suggestion."awaitingSyncAt" DESC NULLS LAST, suggestion."id" DESC
    ) AS position
  FROM "ContributionSuggestion" suggestion
  WHERE suggestion."executionStatus" = 'AWAITING_SYNC'
)
UPDATE "ContributionSuggestion" suggestion
SET
  "executionStatus" = 'PENDING',
  "awaitingSyncAt" = NULL,
  "baselineQuantity" = NULL,
  "baselineValue" = NULL
WHERE suggestion."id" IN (
  SELECT ranked."id"
  FROM ranked
  WHERE ranked.position > 1
);

CREATE UNIQUE INDEX "ContributionSuggestion_one_awaiting_per_asset"
ON "ContributionSuggestion"("assetId")
WHERE "executionStatus" = 'AWAITING_SYNC';
