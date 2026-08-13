CREATE TYPE "ContributionCurrency" AS ENUM ('BRL', 'USD');
CREATE TYPE "ContributionScope" AS ENUM ('ALL_ASSETS', 'USD_ONLY');

ALTER TABLE "ContributionSimulation"
ADD COLUMN "inputAmount" DECIMAL(20,2),
ADD COLUMN "inputCurrency" "ContributionCurrency" NOT NULL DEFAULT 'BRL',
ADD COLUMN "allocationScope" "ContributionScope" NOT NULL DEFAULT 'ALL_ASSETS',
ADD COLUMN "fxRateToBrl" DECIMAL(20,10),
ADD COLUMN "fxUpdatedAt" TIMESTAMP(3),
ADD COLUMN "fxSource" "FinancialFxSource";

UPDATE "ContributionSimulation"
SET "inputAmount" = "requestedAmount",
    "fxRateToBrl" = 1,
    "fxSource" = 'NATIVE';

ALTER TABLE "ContributionSimulation"
ALTER COLUMN "inputAmount" SET NOT NULL;

ALTER TABLE "ContributionSuggestion"
ADD COLUMN "nativeCurrency" TEXT,
ADD COLUMN "nativeUnitPrice" DECIMAL(30,10),
ADD COLUMN "nativeValue" DECIMAL(30,10),
ADD COLUMN "fxRateToBrl" DECIMAL(20,10),
ADD COLUMN "paidUnitPriceNative" DECIMAL(30,10),
ADD COLUMN "executionFxRateToBrl" DECIMAL(20,10);
