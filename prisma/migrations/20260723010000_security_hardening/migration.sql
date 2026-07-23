ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "AuthRateLimit" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "lastAttemptAt" TIMESTAMP(3) NOT NULL,
  "blockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthRateLimit_scope_key_key"
ON "AuthRateLimit"("scope", "key");

CREATE INDEX IF NOT EXISTS "AuthRateLimit_blockedUntil_idx"
ON "AuthRateLimit"("blockedUntil");

CREATE INDEX IF NOT EXISTS "AuthRateLimit_updatedAt_idx"
ON "AuthRateLimit"("updatedAt");

DROP TABLE IF EXISTS "AssetMigrationBackup";

CREATE OR REPLACE FUNCTION "guard_asset_question_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  asset_user_id TEXT;
  question_user_id TEXT;
BEGIN
  SELECT portfolio."userId"
    INTO asset_user_id
    FROM "Asset" asset
    JOIN "Portfolio" portfolio ON portfolio."id" = asset."portfolioId"
   WHERE asset."id" = NEW."assetId";

  SELECT question."userId"
    INTO question_user_id
    FROM "DiagramQuestion" question
   WHERE question."id" = NEW."questionId";

  IF asset_user_id IS NULL THEN
    RAISE EXCEPTION 'AssetQuestionAnswer references an invalid asset';
  END IF;

  IF question_user_id IS NOT NULL AND question_user_id <> asset_user_id THEN
    RAISE EXCEPTION 'AssetQuestionAnswer cannot cross tenant boundaries';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "AssetQuestionAnswer_tenant_guard" ON "AssetQuestionAnswer";
CREATE TRIGGER "AssetQuestionAnswer_tenant_guard"
BEFORE INSERT OR UPDATE OF "assetId", "questionId"
ON "AssetQuestionAnswer"
FOR EACH ROW
EXECUTE FUNCTION "guard_asset_question_tenant"();

CREATE OR REPLACE FUNCTION "guard_contribution_suggestion_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  simulation_user_id TEXT;
  asset_user_id TEXT;
BEGIN
  SELECT simulation."userId"
    INTO simulation_user_id
    FROM "ContributionSimulation" simulation
   WHERE simulation."id" = NEW."simulationId";

  SELECT portfolio."userId"
    INTO asset_user_id
    FROM "Asset" asset
    JOIN "Portfolio" portfolio ON portfolio."id" = asset."portfolioId"
   WHERE asset."id" = NEW."assetId";

  IF simulation_user_id IS NULL OR asset_user_id IS NULL OR simulation_user_id <> asset_user_id THEN
    RAISE EXCEPTION 'ContributionSuggestion cannot cross tenant boundaries';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ContributionSuggestion_tenant_guard" ON "ContributionSuggestion";
CREATE TRIGGER "ContributionSuggestion_tenant_guard"
BEFORE INSERT OR UPDATE OF "simulationId", "assetId"
ON "ContributionSuggestion"
FOR EACH ROW
EXECUTE FUNCTION "guard_contribution_suggestion_tenant"();

CREATE OR REPLACE FUNCTION "guard_expense_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  budget_user_id TEXT;
  recurring_user_id TEXT;
BEGIN
  IF NEW."recurringExpenseId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT budget."userId"
    INTO budget_user_id
    FROM "BudgetMonth" budget
   WHERE budget."id" = NEW."budgetMonthId";

  SELECT recurring."userId"
    INTO recurring_user_id
    FROM "RecurringExpense" recurring
   WHERE recurring."id" = NEW."recurringExpenseId";

  IF budget_user_id IS NULL OR recurring_user_id IS NULL OR budget_user_id <> recurring_user_id THEN
    RAISE EXCEPTION 'Expense cannot cross tenant boundaries';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Expense_tenant_guard" ON "Expense";
CREATE TRIGGER "Expense_tenant_guard"
BEFORE INSERT OR UPDATE OF "budgetMonthId", "recurringExpenseId"
ON "Expense"
FOR EACH ROW
EXECUTE FUNCTION "guard_expense_tenant"();
