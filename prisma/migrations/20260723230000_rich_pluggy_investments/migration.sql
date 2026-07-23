ALTER TABLE "PluggyInvestment"
  ADD COLUMN "taxes" DECIMAL(30, 2),
  ADD COLUMN "taxes2" DECIMAL(30, 2),
  ADD COLUMN "amountProfit" DECIMAL(30, 2),
  ADD COLUMN "amountWithdrawal" DECIMAL(30, 2),
  ADD COLUMN "amountOriginal" DECIMAL(30, 2),
  ADD COLUMN "lastMonthRate" DECIMAL(20, 8),
  ADD COLUMN "annualRate" DECIMAL(20, 8),
  ADD COLUMN "lastTwelveMonthsRate" DECIMAL(20, 8),
  ADD COLUMN "quotaDate" TIMESTAMP(3),
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "number" TEXT,
  ADD COLUMN "institutionNumber" TEXT,
  ADD COLUMN "insurerName" TEXT,
  ADD COLUMN "insurerCnpj" TEXT,
  ADD COLUMN "issuerCnpj" TEXT,
  ADD COLUMN "gracePeriodDate" TIMESTAMP(3),
  ADD COLUMN "metadata" JSONB;

CREATE TABLE "PluggyInvestmentTransaction" (
  "id" TEXT NOT NULL,
  "pluggyInvestmentDbId" TEXT NOT NULL,
  "pluggyInvestmentTransactionId" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL,
  "movementType" TEXT,
  "quantity" DECIMAL(30, 10),
  "value" DECIMAL(30, 10),
  "amount" DECIMAL(30, 2),
  "netAmount" DECIMAL(30, 2),
  "agreedRate" DECIMAL(20, 8),
  "brokerageNumber" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "tradeDate" TIMESTAMP(3),
  "expenses" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PluggyInvestmentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluggyInvestmentTransaction_pluggyInvestmentTransactionId_key"
  ON "PluggyInvestmentTransaction"("pluggyInvestmentTransactionId");

CREATE INDEX "PluggyInvestmentTransaction_pluggyInvestmentDbId_date_idx"
  ON "PluggyInvestmentTransaction"("pluggyInvestmentDbId", "date");

CREATE INDEX "PluggyInvestmentTransaction_type_idx"
  ON "PluggyInvestmentTransaction"("type");

ALTER TABLE "PluggyInvestmentTransaction"
  ADD CONSTRAINT "PluggyInvestmentTransaction_pluggyInvestmentDbId_fkey"
  FOREIGN KEY ("pluggyInvestmentDbId") REFERENCES "PluggyInvestment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

