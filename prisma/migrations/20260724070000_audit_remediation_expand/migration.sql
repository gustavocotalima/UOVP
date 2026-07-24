DO $$
DECLARE
  user_count BIGINT;
  transaction_count BIGINT;
  foreign_transaction_count BIGINT;
  holding_count BIGINT;
  question_count BIGINT;
  awaiting_suggestion_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM "User";
  SELECT COUNT(*) INTO transaction_count FROM "FinanceTransaction";
  SELECT COUNT(*) INTO foreign_transaction_count
  FROM "FinanceTransaction"
  WHERE UPPER(COALESCE("currencyCode", 'BRL')) <> 'BRL';
  SELECT COUNT(*) INTO holding_count FROM "AssetHolding";
  SELECT COUNT(*) INTO question_count FROM "DiagramQuestion";
  SELECT COUNT(*) INTO awaiting_suggestion_count
  FROM "ContributionSuggestion"
  WHERE "executionStatus" = 'AWAITING_SYNC';

  RAISE NOTICE
    'audit remediation snapshot users=% transactions=% foreign_transactions=% holdings=% questions=% awaiting_suggestions=%',
    user_count,
    transaction_count,
    foreign_transaction_count,
    holding_count,
    question_count,
    awaiting_suggestion_count;
END $$;

CREATE TYPE "FinancialFxSource" AS ENUM ('NATIVE', 'PLUGGY', 'YAHOO', 'MANUAL');
CREATE TYPE "PluggyRecordLifecycle" AS ENUM ('ACTIVE', 'DELETION_PENDING', 'KEPT_MANUAL', 'REMOVED');

ALTER TABLE "UserPreference"
ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

ALTER TABLE "FinancialAccount"
ADD COLUMN "balanceBrl" DECIMAL(30,2),
ADD COLUMN "balanceFxRateToBrl" DECIMAL(20,10),
ADD COLUMN "balanceFxRateDate" DATE,
ADD COLUMN "balanceFxSource" "FinancialFxSource";

ALTER TABLE "FinanceTransaction"
ADD COLUMN "reportingAmountBrl" DECIMAL(30,2),
ADD COLUMN "fxRateToBrl" DECIMAL(20,10),
ADD COLUMN "fxRateDate" DATE,
ADD COLUMN "fxSource" "FinancialFxSource",
ADD COLUMN "providerLifecycle" "PluggyRecordLifecycle",
ADD COLUMN "providerDeletedAt" TIMESTAMP(3);

ALTER TABLE "PluggyTransaction"
ADD COLUMN "providerAvailable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "providerRemovedAt" TIMESTAMP(3);

ALTER TABLE "DiagramQuestion"
ADD COLUMN "templateKey" TEXT;

CREATE TABLE "RegistrationInvite" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "usedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RegistrationInvite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RegistrationInvite_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RegistrationInvite_usedByUserId_fkey"
    FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RegistrationInvite_tokenHash_key"
ON "RegistrationInvite"("tokenHash");
CREATE UNIQUE INDEX "RegistrationInvite_usedByUserId_key"
ON "RegistrationInvite"("usedByUserId");
CREATE INDEX "RegistrationInvite_email_expiresAt_idx"
ON "RegistrationInvite"("email", "expiresAt");
CREATE INDEX "RegistrationInvite_createdByUserId_createdAt_idx"
ON "RegistrationInvite"("createdByUserId", "createdAt");

CREATE TABLE "HistoricalFxRate" (
  "id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "rateDate" DATE NOT NULL,
  "rateToBrl" DECIMAL(20,10) NOT NULL,
  "source" "FinancialFxSource" NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HistoricalFxRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HistoricalFxRate_currency_rateDate_source_key"
ON "HistoricalFxRate"("currency", "rateDate", "source");
CREATE INDEX "HistoricalFxRate_currency_rateDate_idx"
ON "HistoricalFxRate"("currency", "rateDate");

CREATE TABLE "ContributionExternalBaseline" (
  "id" TEXT NOT NULL,
  "suggestionId" TEXT NOT NULL,
  "holdingId" TEXT NOT NULL,
  "quantity" DECIMAL(30,10) NOT NULL,
  "providerValue" DECIMAL(30,2),
  "currency" TEXT NOT NULL,
  "fxRateToBrl" DECIMAL(20,10),
  "providerLatestTransactionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContributionExternalBaseline_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContributionExternalBaseline_suggestionId_fkey"
    FOREIGN KEY ("suggestionId") REFERENCES "ContributionSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContributionExternalBaseline_holdingId_fkey"
    FOREIGN KEY ("holdingId") REFERENCES "AssetHolding"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContributionExternalBaseline_suggestionId_holdingId_key"
ON "ContributionExternalBaseline"("suggestionId", "holdingId");
CREATE INDEX "ContributionExternalBaseline_holdingId_idx"
ON "ContributionExternalBaseline"("holdingId");

UPDATE "FinancialAccount"
SET
  "balanceBrl" = "balance",
  "balanceFxRateToBrl" = 1,
  "balanceFxRateDate" = CURRENT_DATE,
  "balanceFxSource" = 'NATIVE'
WHERE UPPER(COALESCE("currencyCode", 'BRL')) = 'BRL';

UPDATE "FinanceTransaction"
SET
  "reportingAmountBrl" = "amount",
  "fxRateToBrl" = 1,
  "fxRateDate" = "date"::date,
  "fxSource" = CASE
    WHEN "originalCurrencyCode" IS NOT NULL
      AND UPPER("originalCurrencyCode") <> 'BRL'
    THEN 'PLUGGY'::"FinancialFxSource"
    ELSE 'NATIVE'::"FinancialFxSource"
  END,
  "providerLifecycle" = CASE
    WHEN "source" = 'PLUGGY'
    THEN 'ACTIVE'::"PluggyRecordLifecycle"
    ELSE NULL
  END
WHERE UPPER(COALESCE("currencyCode", 'BRL')) = 'BRL';

UPDATE "FinanceTransaction"
SET "providerLifecycle" = 'ACTIVE'
WHERE "source" = 'PLUGGY' AND "providerLifecycle" IS NULL;

UPDATE "DiagramQuestion"
SET "templateKey" = CASE
  WHEN "type" = 'CERRADO' AND "criterion" = 'ROE' THEN 'CERRADO_ROE'
  WHEN "type" = 'CERRADO' AND "criterion" = 'CAGR' THEN 'CERRADO_CAGR'
  WHEN "type" = 'CERRADO' AND "criterion" = 'DIVIDENDOS' THEN 'CERRADO_DIVIDENDOS'
  WHEN "type" = 'CERRADO' AND "criterion" = 'TECNOLOGIA E PESQUISA' THEN 'CERRADO_TECNOLOGIA_E_PESQUISA'
  WHEN "type" = 'CERRADO' AND "criterion" = 'TEMPO DE MERCADO' THEN 'CERRADO_TEMPO_DE_MERCADO'
  WHEN "type" = 'CERRADO' AND "criterion" = 'VANTAGENS COMPETITIVAS' THEN 'CERRADO_VANTAGENS_COMPETITIVAS'
  WHEN "type" = 'CERRADO' AND "criterion" = 'PERENIDADE' THEN 'CERRADO_PERENIDADE'
  WHEN "type" = 'CERRADO' AND "criterion" = 'TAMANHO' THEN 'CERRADO_TAMANHO'
  WHEN "type" = 'CERRADO' AND "criterion" = 'GOVERNANÇA' THEN 'CERRADO_GOVERNANCA'
  WHEN "type" = 'CERRADO' AND "criterion" = 'INDEPENDÊNCIA' THEN 'CERRADO_INDEPENDENCIA'
  WHEN "type" = 'CERRADO' AND "criterion" = 'POUCO ENDIVIDADA' THEN 'CERRADO_POUCO_ENDIVIDADA'
  WHEN "type" = 'REAL_ESTATE' AND "criterion" = 'Localização' THEN 'REAL_ESTATE_LOCALIZACAO'
  WHEN "type" = 'REAL_ESTATE' AND "criterion" = 'Propriedades' THEN 'REAL_ESTATE_PROPRIEDADES'
  WHEN "type" = 'REAL_ESTATE' AND "criterion" = 'P/VP' THEN 'REAL_ESTATE_P_VP'
  WHEN "type" = 'REAL_ESTATE' AND "criterion" = 'Dividendos' THEN 'REAL_ESTATE_DIVIDENDOS'
  WHEN "type" = 'REAL_ESTATE' AND "criterion" = 'Dependência' THEN 'REAL_ESTATE_DEPENDENCIA'
  WHEN "type" = 'REAL_ESTATE' AND "criterion" = 'Setor' THEN 'REAL_ESTATE_SETOR'
  WHEN "type" = 'REAL_ESTATE' AND "criterion" = 'Vacancia' THEN 'REAL_ESTATE_VACANCIA'
  ELSE 'DEFAULT-' || md5("type"::text || '|' || COALESCE("criterion", '') || '|' || "text")
END
WHERE "userId" IS NULL AND "isDefault" = true;

WITH matched_questions AS (
  SELECT
    user_question."id",
    default_question."templateKey",
    ROW_NUMBER() OVER (
      PARTITION BY user_question."userId", default_question."templateKey"
      ORDER BY user_question."createdAt", user_question."id"
    ) AS match_rank
  FROM "DiagramQuestion" user_question
  JOIN "DiagramQuestion" default_question
    ON default_question."userId" IS NULL
    AND default_question."isDefault" = true
    AND default_question."type" = user_question."type"
    AND default_question."criterion" = user_question."criterion"
    AND default_question."text" = user_question."text"
  WHERE user_question."userId" IS NOT NULL
)
UPDATE "DiagramQuestion" question
SET "templateKey" = matched_questions."templateKey"
FROM matched_questions
WHERE question."id" = matched_questions."id"
  AND matched_questions.match_rank = 1;

CREATE UNIQUE INDEX "DiagramQuestion_userId_templateKey_key"
ON "DiagramQuestion"("userId", "templateKey");

INSERT INTO "ContributionExternalBaseline" (
  "id",
  "suggestionId",
  "holdingId",
  "quantity",
  "providerValue",
  "currency",
  "fxRateToBrl",
  "providerLatestTransactionAt",
  "createdAt"
)
SELECT
  CONCAT('legacy-', suggestion."id", '-', holding."id"),
  suggestion."id",
  holding."id",
  holding."quantity",
  COALESCE(
    holding."providerCurrentValue",
    holding."currentValue",
    holding."quantity" * holding."unitPrice"
  ),
  holding."currency",
  CASE
    WHEN UPPER(holding."currency") = 'BRL' THEN 1
    ELSE holding."fxRateToBrl"
  END,
  (
    SELECT MAX(movement."date")
    FROM "PluggyInvestmentDiagramLink" link
    JOIN "PluggyInvestmentTransaction" movement
      ON movement."pluggyInvestmentDbId" = link."pluggyInvestmentDbId"
    WHERE link."assetHoldingId" = holding."id"
  ),
  CURRENT_TIMESTAMP
FROM "ContributionSuggestion" suggestion
JOIN "AssetHolding" holding
  ON holding."assetId" = suggestion."assetId"
  AND holding."positionSource" = 'PLUGGY'
  AND holding."includedInTotals" = true
WHERE suggestion."executionStatus" = 'AWAITING_SYNC'
ON CONFLICT ("suggestionId", "holdingId") DO NOTHING;

UPDATE "ContributionSimulation" simulation
SET "status" = 'STALE'
WHERE EXISTS (
  SELECT 1
  FROM "ContributionSuggestion" suggestion
  WHERE suggestion."simulationId" = simulation."id"
    AND suggestion."executionStatus" = 'AWAITING_SYNC'
    AND (
      NOT EXISTS (
        SELECT 1
        FROM "ContributionExternalBaseline" baseline
        WHERE baseline."suggestionId" = suggestion."id"
      )
      OR EXISTS (
        SELECT 1
        FROM "ContributionExternalBaseline" baseline
        WHERE baseline."suggestionId" = suggestion."id"
          AND UPPER(baseline."currency") <> 'BRL'
          AND baseline."fxRateToBrl" IS NULL
      )
    )
);

CREATE INDEX "FinanceTransaction_userId_deleted_referenceYear_referenceMonth_date_idx"
ON "FinanceTransaction"("userId", "deleted", "referenceYear", "referenceMonth", "date");
CREATE INDEX "FinanceTransaction_userId_providerLifecycle_date_idx"
ON "FinanceTransaction"("userId", "providerLifecycle", "date");
CREATE INDEX "PluggyTransaction_pluggyAccountDbId_providerAvailable_date_idx"
ON "PluggyTransaction"("pluggyAccountDbId", "providerAvailable", "date");
