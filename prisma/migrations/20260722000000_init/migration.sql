CREATE TYPE "InvestmentClass" AS ENUM ('INTERNATIONAL_STOCKS', 'BRAZILIAN_STOCKS', 'REAL_ESTATE_FUNDS', 'REITS', 'CRYPTO', 'FIXED_INCOME', 'INTERNATIONAL_FIXED_INCOME');
CREATE TYPE "DiagramType" AS ENUM ('CERRADO', 'REAL_ESTATE');
CREATE TYPE "BudgetCategory" AS ENUM ('FIXED_COSTS', 'COMFORT', 'GOALS', 'PLEASURES', 'FINANCIAL_FREEDOM', 'KNOWLEDGE');
CREATE TYPE "BalanceSheetCategory" AS ENUM ('RECEIVABLES', 'INVESTMENTS', 'CASH', 'VALUE_LIABILITY', 'CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY');
CREATE TYPE "SimulationStatus" AS ENUM ('DRAFT', 'EXECUTED', 'STALE', 'CANCELLED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "emailVerified" TIMESTAMP(3),
  "image" TEXT,
  "passwordHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Account" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "sessionToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

CREATE TABLE "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

CREATE TABLE "UserPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "theme" TEXT NOT NULL DEFAULT 'system',
  "locale" TEXT NOT NULL DEFAULT 'pt-BR',
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

CREATE TABLE "Portfolio" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Portfolio_userId_key" ON "Portfolio"("userId");

CREATE TABLE "Asset" (
  "id" TEXT NOT NULL,
  "portfolioId" TEXT NOT NULL,
  "investmentClass" "InvestmentClass" NOT NULL,
  "ticker" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "quantity" DECIMAL(30,10) NOT NULL,
  "unitPrice" DECIMAL(30,10) NOT NULL,
  "manualValue" DECIMAL(30,10),
  "fractional" BOOLEAN NOT NULL DEFAULT false,
  "score" INTEGER NOT NULL DEFAULT 0,
  "priceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Asset_portfolioId_investmentClass_ticker_key" ON "Asset"("portfolioId", "investmentClass", "ticker");
CREATE INDEX "Asset_portfolioId_investmentClass_idx" ON "Asset"("portfolioId", "investmentClass");

CREATE TABLE "InvestmentTarget" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "investmentClass" "InvestmentClass" NOT NULL,
  "percentage" DECIMAL(5,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvestmentTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InvestmentTarget_userId_investmentClass_key" ON "InvestmentTarget"("userId", "investmentClass");
CREATE INDEX "InvestmentTarget_userId_idx" ON "InvestmentTarget"("userId");

CREATE TABLE "InvestorProfilePreset" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "targets" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvestorProfilePreset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InvestorProfilePreset_slug_key" ON "InvestorProfilePreset"("slug");

CREATE TABLE "DiagramQuestion" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "type" "DiagramType" NOT NULL,
  "text" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagramQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DiagramQuestion_userId_type_sortOrder_idx" ON "DiagramQuestion"("userId", "type", "sortOrder");

CREATE TABLE "AssetQuestionAnswer" (
  "id" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "answer" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetQuestionAnswer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssetQuestionAnswer_assetId_questionId_key" ON "AssetQuestionAnswer"("assetId", "questionId");
CREATE INDEX "AssetQuestionAnswer_questionId_idx" ON "AssetQuestionAnswer"("questionId");

CREATE TABLE "BudgetMonth" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "income" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BudgetMonth_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetMonth_userId_year_month_key" ON "BudgetMonth"("userId", "year", "month");
CREATE INDEX "BudgetMonth_userId_year_month_idx" ON "BudgetMonth"("userId", "year", "month");

CREATE TABLE "BudgetTarget" (
  "id" TEXT NOT NULL,
  "budgetMonthId" TEXT NOT NULL,
  "category" "BudgetCategory" NOT NULL,
  "percentage" DECIMAL(5,2) NOT NULL,
  CONSTRAINT "BudgetTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetTarget_budgetMonthId_category_key" ON "BudgetTarget"("budgetMonthId", "category");

CREATE TABLE "RecurringExpense" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "category" "BudgetCategory" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecurringExpense_userId_active_idx" ON "RecurringExpense"("userId", "active");

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL,
  "budgetMonthId" TEXT NOT NULL,
  "recurringExpenseId" TEXT,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "category" "BudgetCategory" NOT NULL,
  "spentAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Expense_budgetMonthId_recurringExpenseId_key" ON "Expense"("budgetMonthId", "recurringExpenseId");
CREATE INDEX "Expense_budgetMonthId_category_idx" ON "Expense"("budgetMonthId", "category");

CREATE TABLE "BalanceSheetEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" "BalanceSheetCategory" NOT NULL,
  "name" TEXT NOT NULL,
  "value" DECIMAL(20,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BalanceSheetEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BalanceSheetEntry_userId_category_idx" ON "BalanceSheetEntry"("userId", "category");

CREATE TABLE "ContributionSimulation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "portfolioVersion" INTEGER NOT NULL,
  "requestedAmount" DECIMAL(20,2) NOT NULL,
  "unallocatedAmount" DECIMAL(20,2) NOT NULL,
  "status" "SimulationStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt" TIMESTAMP(3),
  CONSTRAINT "ContributionSimulation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContributionSimulation_userId_createdAt_idx" ON "ContributionSimulation"("userId", "createdAt");

CREATE TABLE "ContributionSuggestion" (
  "id" TEXT NOT NULL,
  "simulationId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "quantity" DECIMAL(30,10) NOT NULL,
  "value" DECIMAL(30,10) NOT NULL,
  "suggestionPercentage" DECIMAL(12,8) NOT NULL,
  "totalAfterSuggestionPercentage" DECIMAL(12,8) NOT NULL,
  "executed" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ContributionSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContributionSuggestion_simulationId_assetId_key" ON "ContributionSuggestion"("simulationId", "assetId");
CREATE INDEX "ContributionSuggestion_assetId_idx" ON "ContributionSuggestion"("assetId");

CREATE TABLE "FaqCategory" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "FaqCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FaqCategory_slug_key" ON "FaqCategory"("slug");

CREATE TABLE "FaqItem" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "FaqItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FaqItem_categoryId_sortOrder_idx" ON "FaqItem"("categoryId", "sortOrder");

ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvestmentTarget" ADD CONSTRAINT "InvestmentTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagramQuestion" ADD CONSTRAINT "DiagramQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetQuestionAnswer" ADD CONSTRAINT "AssetQuestionAnswer_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetQuestionAnswer" ADD CONSTRAINT "AssetQuestionAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "DiagramQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetMonth" ADD CONSTRAINT "BudgetMonth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetTarget" ADD CONSTRAINT "BudgetTarget_budgetMonthId_fkey" FOREIGN KEY ("budgetMonthId") REFERENCES "BudgetMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_budgetMonthId_fkey" FOREIGN KEY ("budgetMonthId") REFERENCES "BudgetMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringExpenseId_fkey" FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BalanceSheetEntry" ADD CONSTRAINT "BalanceSheetEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributionSimulation" ADD CONSTRAINT "ContributionSimulation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributionSuggestion" ADD CONSTRAINT "ContributionSuggestion_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "ContributionSimulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContributionSuggestion" ADD CONSTRAINT "ContributionSuggestion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaqItem" ADD CONSTRAINT "FaqItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FaqCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
