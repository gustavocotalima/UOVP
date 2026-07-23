DROP INDEX IF EXISTS "Asset_portfolioId_fixedIncomeFamilyCode_indexation_key";

INSERT INTO "FixedIncomeFamily" ("code", "name", "shortCode", "sortOrder", "createdAt", "updatedAt")
VALUES ('PUBLIC_TREASURY', 'Tesouro Direto', 'TESOURO', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "shortCode" = EXCLUDED."shortCode",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE TEMP TABLE "_TreasuryAssetMerge" ON COMMIT DROP AS
SELECT
  "id" AS "assetId",
  FIRST_VALUE("id") OVER (
    PARTITION BY "portfolioId", "indexation"
    ORDER BY "createdAt", "id"
  ) AS "survivorId"
FROM "Asset"
WHERE "instrumentType" = 'FIXED_INCOME'
  AND "fixedIncomeFamilyCode" IN ('TREASURY_IPCA', 'TREASURY_SELIC', 'TREASURY_FIXED', 'TREASURY_RENDA', 'TREASURY_EDUCA');

UPDATE "ContributionSimulation"
SET "status" = 'STALE'
WHERE "id" IN (
  SELECT DISTINCT suggestion."simulationId"
  FROM "ContributionSuggestion" suggestion
  JOIN "_TreasuryAssetMerge" merge ON merge."assetId" = suggestion."assetId"
  WHERE merge."assetId" <> merge."survivorId"
);

DELETE FROM "ContributionSuggestion"
WHERE "assetId" IN (
  SELECT "assetId" FROM "_TreasuryAssetMerge" WHERE "assetId" <> "survivorId"
);

UPDATE "AssetHolding" holding
SET "assetId" = merge."survivorId"
FROM "_TreasuryAssetMerge" merge
WHERE holding."assetId" = merge."assetId"
  AND merge."assetId" <> merge."survivorId";

DELETE FROM "Asset" asset
USING "_TreasuryAssetMerge" merge
WHERE asset."id" = merge."assetId"
  AND merge."assetId" <> merge."survivorId";

UPDATE "Asset"
SET
  "fixedIncomeFamilyCode" = 'PUBLIC_TREASURY',
  "ticker" = CASE "indexation"
    WHEN 'PRE_FIXED' THEN 'TESOURO-PRE'
    WHEN 'POST_FIXED' THEN 'TESOURO-POS'
    WHEN 'INFLATION' THEN 'TESOURO-INFLACAO'
    ELSE 'TESOURO-OUTRO'
  END,
  "name" = CASE "indexation"
    WHEN 'PRE_FIXED' THEN 'Tesouro Direto · Pré-fixado'
    WHEN 'POST_FIXED' THEN 'Tesouro Direto · Pós-fixado'
    WHEN 'INFLATION' THEN 'Tesouro Direto · Inflação'
    ELSE 'Tesouro Direto · Outro / híbrido'
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "fixedIncomeFamilyCode" IN ('TREASURY_IPCA', 'TREASURY_SELIC', 'TREASURY_FIXED', 'TREASURY_RENDA', 'TREASURY_EDUCA');

UPDATE "AssetCatalogItem"
SET "familyCode" = 'PUBLIC_TREASURY', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (1, 2, 3, 4, 15, 16, 17);

DELETE FROM "FixedIncomeFamily"
WHERE "code" IN ('TREASURY_IPCA', 'TREASURY_SELIC', 'TREASURY_FIXED', 'TREASURY_RENDA', 'TREASURY_EDUCA');

CREATE INDEX "Asset_portfolioId_fixedIncomeFamilyCode_indexation_idx"
ON "Asset"("portfolioId", "fixedIncomeFamilyCode", "indexation");

CREATE UNIQUE INDEX "Asset_fixed_income_parent_group_key"
ON "Asset"("portfolioId", "fixedIncomeFamilyCode", "indexation")
WHERE "instrumentType" = 'FIXED_INCOME'
  AND "fixedIncomeFamilyCode" IS NOT NULL
  AND "indexation" IS NOT NULL;
