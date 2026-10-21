ALTER TABLE "AssetHolding" ADD COLUMN "investedValueCurrency" TEXT;

-- Provider purchase costs belong to the investment's currency, which can
-- differ from the market quote currency stored on the holding.
UPDATE "AssetHolding" holding
SET "investedValueCurrency" = UPPER(TRIM(investment."currencyCode"))
FROM "PluggyInvestmentDiagramLink" link
JOIN "PluggyInvestment" investment ON investment."id" = link."pluggyInvestmentDbId"
WHERE link."assetHoldingId" = holding."id"
  AND holding."positionSource" = 'PLUGGY'
  AND holding."investedValue" IS NOT NULL
  AND TRIM(investment."currencyCode") <> '';

UPDATE "AssetHolding"
SET "investedValueCurrency" = 'BRL'
WHERE "investedValueCurrency" IS NULL
  AND "investedValue" IS NOT NULL
  AND UPPER(TRIM("currency")) = 'BRL'
  AND "positionSource" <> 'PLUGGY';

-- Foreign MANUAL rows can include positions converted from Pluggy after a
-- disconnection. Their historical cost unit is not provable: leave it unknown.
