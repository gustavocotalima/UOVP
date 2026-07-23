UPDATE "Asset"
SET
  "fixedIncomeFamilyCode" = 'PUBLIC_TREASURY',
  "indexation" = 'OTHER',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "ticker" = 'AUPO11'
  AND "instrumentType" = 'ETF'
  AND "investmentClass" IN ('FIXED_INCOME', 'INTERNATIONAL_FIXED_INCOME')
  AND "fixedIncomeFamilyCode" IS NULL;
