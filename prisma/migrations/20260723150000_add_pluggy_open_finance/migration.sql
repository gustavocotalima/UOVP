-- Open Finance data is isolated by user and provider identifiers.
CREATE TABLE "PluggyItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pluggyItemId" TEXT NOT NULL,
    "connectorId" INTEGER,
    "connectorName" TEXT NOT NULL,
    "connectorImageUrl" TEXT,
    "connectorPrimaryColor" TEXT,
    "status" TEXT NOT NULL,
    "executionStatus" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "consentExpiresAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "syncPending" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluggyItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PluggyAccount" (
    "id" TEXT NOT NULL,
    "pluggyItemDbId" TEXT NOT NULL,
    "pluggyAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "name" TEXT NOT NULL,
    "marketingName" TEXT,
    "numberLastFour" TEXT,
    "balance" DECIMAL(30,2) NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
    "providerCreatedAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluggyAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PluggyTransaction" (
    "id" TEXT NOT NULL,
    "pluggyAccountDbId" TEXT NOT NULL,
    "pluggyTransactionId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(30,2) NOT NULL,
    "amountInAccountCurrency" DECIMAL(30,2),
    "balance" DECIMAL(30,2),
    "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT,
    "status" TEXT,
    "category" TEXT,
    "categoryId" TEXT,
    "operationType" TEXT,
    "merchantName" TEXT,
    "providerCreatedAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluggyTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PluggyInvestment" (
    "id" TEXT NOT NULL,
    "pluggyItemDbId" TEXT NOT NULL,
    "pluggyInvestmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isin" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "balance" DECIMAL(30,2) NOT NULL DEFAULT 0,
    "value" DECIMAL(30,10),
    "quantity" DECIMAL(30,10),
    "amount" DECIMAL(30,2),
    "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
    "institutionName" TEXT,
    "issuer" TEXT,
    "rate" DECIMAL(20,8),
    "rateType" TEXT,
    "fixedAnnualRate" DECIMAL(20,8),
    "purchaseDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "issueDate" TIMESTAMP(3),
    "status" TEXT,
    "providerCreatedAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluggyInvestment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PluggyItem_pluggyItemId_key" ON "PluggyItem"("pluggyItemId");
CREATE INDEX "PluggyItem_userId_status_idx" ON "PluggyItem"("userId", "status");
CREATE INDEX "PluggyItem_userId_syncPending_idx" ON "PluggyItem"("userId", "syncPending");
CREATE UNIQUE INDEX "PluggyAccount_pluggyAccountId_key" ON "PluggyAccount"("pluggyAccountId");
CREATE INDEX "PluggyAccount_pluggyItemDbId_type_idx" ON "PluggyAccount"("pluggyItemDbId", "type");
CREATE UNIQUE INDEX "PluggyTransaction_pluggyTransactionId_key" ON "PluggyTransaction"("pluggyTransactionId");
CREATE INDEX "PluggyTransaction_pluggyAccountDbId_date_idx" ON "PluggyTransaction"("pluggyAccountDbId", "date");
CREATE INDEX "PluggyTransaction_category_idx" ON "PluggyTransaction"("category");
CREATE UNIQUE INDEX "PluggyInvestment_pluggyInvestmentId_key" ON "PluggyInvestment"("pluggyInvestmentId");
CREATE INDEX "PluggyInvestment_pluggyItemDbId_type_idx" ON "PluggyInvestment"("pluggyItemDbId", "type");
CREATE INDEX "PluggyInvestment_code_idx" ON "PluggyInvestment"("code");

ALTER TABLE "PluggyItem"
  ADD CONSTRAINT "PluggyItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PluggyAccount"
  ADD CONSTRAINT "PluggyAccount_pluggyItemDbId_fkey"
  FOREIGN KEY ("pluggyItemDbId") REFERENCES "PluggyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PluggyTransaction"
  ADD CONSTRAINT "PluggyTransaction_pluggyAccountDbId_fkey"
  FOREIGN KEY ("pluggyAccountDbId") REFERENCES "PluggyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PluggyInvestment"
  ADD CONSTRAINT "PluggyInvestment_pluggyItemDbId_fkey"
  FOREIGN KEY ("pluggyItemDbId") REFERENCES "PluggyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
