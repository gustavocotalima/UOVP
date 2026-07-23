-- Legacy market assets already had authoritative quantity and unit-price values.
-- Keep manual current-value fallbacks only for AUPO11, whose old row was a
-- fixed-income aggregate and did not contain a usable ETF quantity.
UPDATE "AssetHolding" holding
SET "currentValue" = NULL
FROM "Asset" asset
WHERE holding."assetId" = asset."id"
  AND holding."pricingSource" = 'BRAPI'
  AND asset."ticker" <> 'AUPO11';

UPDATE "AssetHolding" holding
SET "fractional" = false
FROM "Asset" asset
WHERE holding."assetId" = asset."id"
  AND asset."instrumentType" = 'ETF';
