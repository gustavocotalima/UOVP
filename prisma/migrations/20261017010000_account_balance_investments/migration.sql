ALTER TYPE "PricingSource" ADD VALUE 'ACCOUNT_BALANCE';
ALTER TYPE "PositionSource" ADD VALUE 'ACCOUNT_BALANCE';

CREATE TABLE "AccountInvestmentLink" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" "PluggyDiagramMappingStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "classifiedCurrency" TEXT,
  "assetHoldingId" TEXT,
  "distinctAutomaticBalance" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountInvestmentLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountInvestmentLink_accountId_key" ON "AccountInvestmentLink"("accountId");
CREATE UNIQUE INDEX "AccountInvestmentLink_assetHoldingId_key" ON "AccountInvestmentLink"("assetHoldingId");
ALTER TABLE "AccountInvestmentLink" ADD CONSTRAINT "AccountInvestmentLink_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountInvestmentLink" ADD CONSTRAINT "AccountInvestmentLink_assetHoldingId_fkey"
  FOREIGN KEY ("assetHoldingId") REFERENCES "AssetHolding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
