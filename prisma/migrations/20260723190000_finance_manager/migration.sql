CREATE TYPE "FinancialDataSource" AS ENUM ('PLUGGY', 'MANUAL');
CREATE TYPE "FinancialAccountType" AS ENUM ('BANK_ACCOUNT', 'CREDIT_CARD');
CREATE TYPE "FinanceTransactionKind" AS ENUM ('INCOME', 'EXPENSE');

CREATE TABLE "FinanceProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "monthlyIncome" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "financialMonthStart" INTEGER NOT NULL DEFAULT 1,
  "objectives" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" "BudgetCategory" NOT NULL,
  "percentage" DECIMAL(5,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceGoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" "FinancialDataSource" NOT NULL,
  "externalId" TEXT,
  "providerItemId" TEXT,
  "type" "FinancialAccountType" NOT NULL,
  "subtype" TEXT,
  "name" TEXT NOT NULL,
  "institutionName" TEXT,
  "institutionImageUrl" TEXT,
  "accountNumber" TEXT,
  "agency" TEXT,
  "numberLastFour" TEXT,
  "bankCode" TEXT,
  "brand" TEXT,
  "balance" DECIMAL(30,2) NOT NULL DEFAULT 0,
  "creditLimit" DECIMAL(30,2),
  "availableCredit" DECIMAL(30,2),
  "dueDay" INTEGER,
  "closingDay" INTEGER,
  "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "providerUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "source" "FinancialDataSource" NOT NULL,
  "externalId" TEXT,
  "kind" "FinanceTransactionKind" NOT NULL,
  "description" TEXT NOT NULL,
  "merchantName" TEXT,
  "amount" DECIMAL(30,2) NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
  "date" TIMESTAMP(3) NOT NULL,
  "referenceYear" INTEGER NOT NULL,
  "referenceMonth" INTEGER NOT NULL,
  "budgetCategory" "BudgetCategory",
  "providerCategory" TEXT,
  "status" TEXT,
  "operationType" TEXT,
  "note" TEXT,
  "ignored" BOOLEAN NOT NULL DEFAULT false,
  "internalTransfer" BOOLEAN NOT NULL DEFAULT false,
  "deleted" BOOLEAN NOT NULL DEFAULT false,
  "installmentNumber" INTEGER,
  "installmentTotal" INTEGER,
  "providerUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceTag" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#3b82f6',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceTransactionTag" (
  "transactionId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "FinanceTransactionTag_pkey" PRIMARY KEY ("transactionId", "tagId")
);

CREATE UNIQUE INDEX "FinanceProfile_userId_key" ON "FinanceProfile"("userId");
CREATE UNIQUE INDEX "FinanceGoal_userId_category_key" ON "FinanceGoal"("userId", "category");
CREATE INDEX "FinanceGoal_userId_idx" ON "FinanceGoal"("userId");
CREATE UNIQUE INDEX "FinancialAccount_externalId_key" ON "FinancialAccount"("externalId");
CREATE INDEX "FinancialAccount_userId_type_sortOrder_idx" ON "FinancialAccount"("userId", "type", "sortOrder");
CREATE INDEX "FinancialAccount_userId_active_idx" ON "FinancialAccount"("userId", "active");
CREATE INDEX "FinancialAccount_userId_providerItemId_idx" ON "FinancialAccount"("userId", "providerItemId");
CREATE UNIQUE INDEX "FinanceTransaction_externalId_key" ON "FinanceTransaction"("externalId");
CREATE INDEX "FinanceTransaction_userId_referenceYear_referenceMonth_idx" ON "FinanceTransaction"("userId", "referenceYear", "referenceMonth");
CREATE INDEX "FinanceTransaction_userId_date_idx" ON "FinanceTransaction"("userId", "date");
CREATE INDEX "FinanceTransaction_accountId_date_idx" ON "FinanceTransaction"("accountId", "date");
CREATE INDEX "FinanceTransaction_userId_budgetCategory_idx" ON "FinanceTransaction"("userId", "budgetCategory");
CREATE UNIQUE INDEX "FinanceTag_userId_name_key" ON "FinanceTag"("userId", "name");
CREATE INDEX "FinanceTag_userId_name_idx" ON "FinanceTag"("userId", "name");
CREATE INDEX "FinanceTransactionTag_tagId_idx" ON "FinanceTransactionTag"("tagId");

ALTER TABLE "FinanceProfile"
  ADD CONSTRAINT "FinanceProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceGoal"
  ADD CONSTRAINT "FinanceGoal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialAccount"
  ADD CONSTRAINT "FinancialAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceTransaction"
  ADD CONSTRAINT "FinanceTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceTransaction"
  ADD CONSTRAINT "FinanceTransaction_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceTag"
  ADD CONSTRAINT "FinanceTag_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceTransactionTag"
  ADD CONSTRAINT "FinanceTransactionTag_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "FinanceTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceTransactionTag"
  ADD CONSTRAINT "FinanceTransactionTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "FinanceTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "FinanceProfile" ("id", "userId", "monthlyIncome", "financialMonthStart", "createdAt", "updatedAt")
SELECT 'finance-profile-' || "id", "id", 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User";

INSERT INTO "FinanceGoal" ("id", "userId", "category", "percentage", "createdAt", "updatedAt")
SELECT 'finance-goal-fixed-' || "id", "id", 'FIXED_COSTS'::"BudgetCategory", 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-goal-comfort-' || "id", "id", 'COMFORT'::"BudgetCategory", 15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-goal-goals-' || "id", "id", 'GOALS'::"BudgetCategory", 15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-goal-pleasures-' || "id", "id", 'PLEASURES'::"BudgetCategory", 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-goal-freedom-' || "id", "id", 'FINANCIAL_FREEDOM'::"BudgetCategory", 25, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-goal-knowledge-' || "id", "id", 'KNOWLEDGE'::"BudgetCategory", 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User";

INSERT INTO "FinanceTag" ("id", "userId", "name", "color", "createdAt", "updatedAt")
SELECT 'finance-tag-food-' || "id", "id", 'Alimentação', '#ef4444', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-tag-home-' || "id", "id", 'Contas de Casa', '#f59e0b', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-tag-education-' || "id", "id", 'Educação', '#3b82f6', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-tag-leisure-' || "id", "id", 'Lazer', '#a855f7', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-tag-transport-' || "id", "id", 'Transporte', '#14b8a6', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User"
UNION ALL
SELECT 'finance-tag-clothes-' || "id", "id", 'Vestuário', '#ec4899', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User";

INSERT INTO "FinancialAccount" (
  "id", "userId", "source", "externalId", "providerItemId", "type", "subtype", "name",
  "institutionName", "institutionImageUrl", "numberLastFour", "balance",
  "currencyCode", "sortOrder", "providerUpdatedAt", "createdAt", "updatedAt"
)
SELECT
  pa."id",
  pi."userId",
  'PLUGGY'::"FinancialDataSource",
  pa."pluggyAccountId",
  pi."pluggyItemId",
  CASE WHEN pa."type" = 'CREDIT' THEN 'CREDIT_CARD'::"FinancialAccountType" ELSE 'BANK_ACCOUNT'::"FinancialAccountType" END,
  pa."subtype",
  COALESCE(pa."marketingName", pa."name"),
  COALESCE(pi."institutionName", pi."connectorName"),
  pi."connectorImageUrl",
  pa."numberLastFour",
  pa."balance",
  pa."currencyCode",
  ROW_NUMBER() OVER (PARTITION BY pi."userId", pa."type" ORDER BY COALESCE(pa."marketingName", pa."name")) - 1,
  pa."providerUpdatedAt",
  pa."createdAt",
  pa."updatedAt"
FROM "PluggyAccount" pa
JOIN "PluggyItem" pi ON pi."id" = pa."pluggyItemDbId";

INSERT INTO "FinanceTransaction" (
  "id", "userId", "accountId", "source", "externalId", "kind", "description",
  "merchantName", "amount", "currencyCode", "date", "referenceYear", "referenceMonth",
  "providerCategory", "status", "operationType", "providerUpdatedAt", "createdAt", "updatedAt"
)
SELECT
  pt."id",
  pi."userId",
  pa."id",
  'PLUGGY'::"FinancialDataSource",
  pt."pluggyTransactionId",
  CASE WHEN pt."amount" >= 0 THEN 'INCOME'::"FinanceTransactionKind" ELSE 'EXPENSE'::"FinanceTransactionKind" END,
  pt."description",
  pt."merchantName",
  pt."amount",
  pt."currencyCode",
  pt."date",
  EXTRACT(YEAR FROM pt."date")::INTEGER,
  EXTRACT(MONTH FROM pt."date")::INTEGER,
  pt."category",
  pt."status",
  pt."operationType",
  pt."providerUpdatedAt",
  pt."createdAt",
  pt."updatedAt"
FROM "PluggyTransaction" pt
JOIN "PluggyAccount" pa ON pa."id" = pt."pluggyAccountDbId"
JOIN "PluggyItem" pi ON pi."id" = pa."pluggyItemDbId";
