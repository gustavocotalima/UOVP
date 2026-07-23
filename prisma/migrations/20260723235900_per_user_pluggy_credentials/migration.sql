ALTER TABLE "UserPreference"
  ADD COLUMN "pluggyClientIdCiphertext" TEXT,
  ADD COLUMN "pluggyClientIdLastFour" TEXT,
  ADD COLUMN "pluggyClientSecretCiphertext" TEXT,
  ADD COLUMN "pluggyClientSecretLastFour" TEXT,
  ADD COLUMN "pluggyCredentialUpdatedAt" TIMESTAMP(3);
