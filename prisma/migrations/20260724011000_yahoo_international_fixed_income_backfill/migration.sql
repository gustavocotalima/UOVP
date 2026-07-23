-- International fixed-income market instruments are priced by Yahoo.
-- Preserve the current stored value until the unified refresh obtains both
-- an exact quote and a currency conversion to BRL.
UPDATE "AssetHolding" holding
SET "pricingSource" = 'MANUAL'::"PricingSource"
FROM "Asset" asset
WHERE holding."assetId" = asset."id"
  AND asset."investmentClass" = 'INTERNATIONAL_FIXED_INCOME'
  AND holding."pricingSource" = 'BRAPI'::"PricingSource";
