import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// Use the already-installed adapter's PostgreSQL driver for transactional DDL.
const { Client } = createRequire(require.resolve("@prisma/adapter-pg"))("pg");
const migration = readFileSync(new URL("../../prisma/migrations/20261029040000_pending_contributions_cleanup/migration.sql", import.meta.url), "utf8")
  .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");

describe("pending-only contribution migration", () => {
  it("preserves active and ambiguous purchases, folds partial cost and removes obsolete tables", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      const schema = `pending_migration_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
      await client.query(`
        CREATE TYPE "SimulationStatus" AS ENUM ('DRAFT', 'STALE', 'EXECUTED');
        CREATE TYPE "SuggestionExecutionStatus" AS ENUM ('PENDING', 'AWAITING_SYNC', 'EXECUTED');
        CREATE TYPE "ContributionCurrency" AS ENUM ('BRL', 'USD');
        CREATE TYPE "ContributionScope" AS ENUM ('ALL_ASSETS', 'BRL_ONLY', 'USD_ONLY');
        CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Portfolio" ("id" TEXT PRIMARY KEY, "userId" TEXT, "version" INT);
        CREATE TABLE "Asset" ("id" TEXT PRIMARY KEY, "portfolioId" TEXT, "instrumentType" TEXT);
        CREATE TABLE "AssetHolding" ("id" TEXT PRIMARY KEY, "assetId" TEXT, "positionSource" TEXT, "quantity" NUMERIC, "investedValue" NUMERIC);
        CREATE TABLE "PluggyInvestmentDiagramLink" ("id" TEXT PRIMARY KEY, "userId" TEXT);
        CREATE TABLE "PluggyInvestmentTransaction" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "PluggyContributionBatch" ("id" TEXT PRIMARY KEY, "linkId" TEXT, "holdingId" TEXT, "state" TEXT CHECK ("state" IN ('WAITING', 'CONFLICT', 'RESOLVED')), "currency" TEXT, "baselineCostNative" NUMERIC, "resolvedAt" TIMESTAMP);
        CREATE TABLE "ContributionSimulation" ("id" TEXT PRIMARY KEY, "userId" TEXT, "createdAt" TIMESTAMP);
        CREATE TABLE "ContributionSuggestion" (
          "id" TEXT CONSTRAINT "ContributionSuggestion_pkey" PRIMARY KEY,
          "simulationId" TEXT CONSTRAINT "ContributionSuggestion_simulationId_fkey" REFERENCES "ContributionSimulation"("id"),
          "assetId" TEXT CONSTRAINT "ContributionSuggestion_assetId_fkey" REFERENCES "Asset"("id"),
          "contributionBatchId" TEXT CONSTRAINT "ContributionSuggestion_contributionBatchId_fkey" REFERENCES "PluggyContributionBatch"("id"),
          "quantity" NUMERIC, "value" NUMERIC, "paidUnitPrice" NUMERIC, "paidUnitPriceNative" NUMERIC,
          "suggestionPercentage" NUMERIC, "totalAfterSuggestionPercentage" NUMERIC, "executed" BOOLEAN,
          "executionStatus" "SuggestionExecutionStatus", "confirmationReference" TEXT, "usesQuantityProjection" BOOLEAN,
          "syncResolution" TEXT, "nativeUnitPrice" NUMERIC, "awaitingSyncAt" TIMESTAMP
        );
        CREATE INDEX "ContributionSuggestion_assetId_idx" ON "ContributionSuggestion"("assetId");
        CREATE UNIQUE INDEX "ContributionSuggestion_one_awaiting_per_asset" ON "ContributionSuggestion"("assetId") WHERE false;
        CREATE TABLE "ContributionExternalBaseline" ("suggestionId" TEXT, "holdingId" TEXT, "quantity" NUMERIC, "providerValue" NUMERIC, "currency" TEXT, "fxRateToBrl" NUMERIC, "providerLatestTransactionAt" TIMESTAMP);
        CREATE FUNCTION "guard_contribution_suggestion_tenant"() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
        CREATE TRIGGER "ContributionSuggestion_tenant_guard" BEFORE INSERT ON "ContributionSuggestion" FOR EACH ROW EXECUTE FUNCTION "guard_contribution_suggestion_tenant"();
        CREATE FUNCTION "guard_expense_tenant"() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
        CREATE TABLE "BudgetTarget" (id TEXT); CREATE TABLE "Expense" (id TEXT); CREATE TABLE "BudgetMonth" (id TEXT);
        CREATE TABLE "RecurringExpense" (id TEXT); CREATE TABLE "FaqItem" (id TEXT); CREATE TABLE "FaqCategory" (id TEXT); CREATE TABLE "InvestorProfilePreset" (id TEXT);
        INSERT INTO "User" VALUES ('owner'); INSERT INTO "Portfolio" VALUES ('portfolio', 'owner', 3);
        INSERT INTO "Asset" VALUES ('units', 'portfolio', 'STOCK'), ('income', 'portfolio', 'FIXED_INCOME');
        INSERT INTO "AssetHolding" VALUES ('units-position', 'units', 'PLUGGY', 115, 1180), ('income-position', 'income', 'PLUGGY', 100, 1000);
        INSERT INTO "PluggyInvestmentDiagramLink" VALUES ('link', 'owner');
        INSERT INTO "PluggyInvestmentTransaction" VALUES ('provider-buy');
        INSERT INTO "ContributionSimulation" VALUES ('snapshot', 'owner', '2026-10-28 10:00:00');
        INSERT INTO "PluggyContributionBatch" VALUES ('batch', 'link', 'units-position', 'WAITING', 'BRL', 1000, NULL);
        INSERT INTO "ContributionSuggestion" ("id", "simulationId", "assetId", "contributionBatchId", "quantity", "value", "paidUnitPriceNative", "executionStatus", "confirmationReference", "usesQuantityProjection") VALUES
          ('synced', 'snapshot', 'units', 'batch', 10, 120, 12, 'EXECUTED', 'PLUGGY_TRANSACTION:provider-buy', true),
          ('pending', 'snapshot', 'units', 'batch', 5, 60, 12, 'AWAITING_SYNC', NULL, true),
          ('unused', 'snapshot', 'income', NULL, 20, 20, NULL, 'PENDING', NULL, false),
          ('review', 'snapshot', 'income', NULL, 50, 50, NULL, 'AWAITING_SYNC', NULL, false),
          ('review-orphan', 'snapshot', 'income', NULL, 25, 25, NULL, 'AWAITING_SYNC', NULL, true);
        UPDATE "ContributionSuggestion" SET "syncResolution" = 'NEEDS_REVIEW' WHERE "id" IN ('review', 'review-orphan');
        INSERT INTO "ContributionExternalBaseline" VALUES ('review', 'income-position', 100, 1000, 'BRL', 1, '2026-10-27');
      `);
      await client.query(migration);
      const pending = await client.query('SELECT "id", "userId", "holdingId", "quantity"::text, "needsReview", "baselines" FROM "PendingContribution" ORDER BY "id"');
      expect(pending.rows).toHaveLength(3);
      expect(pending.rows[0]).toMatchObject({ id: "pending", userId: "owner", holdingId: "units-position", quantity: "5" });
      expect(pending.rows[1]).toMatchObject({ id: "review", userId: "owner", holdingId: "income-position", needsReview: true,
        baselines: [expect.objectContaining({ quantity: "100", currency: "BRL" })] });
      expect(pending.rows[2]).toMatchObject({ id: "review-orphan", needsReview: true });
      expect((await client.query('SELECT "baselineCostNative"::text FROM "PluggyContributionBatch"')).rows).toEqual([{ baselineCostNative: "1120" }]);
      expect((await client.query('SELECT "quantity"::text, "investedValue"::text FROM "AssetHolding" WHERE "id" = \'units-position\'')).rows).toEqual([{ quantity: "115", investedValue: "1180" }]);
      expect((await client.query('SELECT "contributionMatched" FROM "PluggyInvestmentTransaction"')).rows).toEqual([{ contributionMatched: true }]);
      expect((await client.query(`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name IN
        ('ContributionSimulation','ContributionSuggestion','ContributionExternalBaseline','BudgetMonth','BudgetTarget','Expense','RecurringExpense','FaqCategory','FaqItem','InvestorProfilePreset')`)).rows).toEqual([{ count: 0 }]);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
