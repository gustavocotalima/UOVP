ALTER TABLE "UserPreference"
  ADD COLUMN "brapiApiKeyCiphertext" TEXT,
  ADD COLUMN "brapiApiKeyLastFour" TEXT,
  ADD COLUMN "brapiApiKeyUpdatedAt" TIMESTAMP(3);
