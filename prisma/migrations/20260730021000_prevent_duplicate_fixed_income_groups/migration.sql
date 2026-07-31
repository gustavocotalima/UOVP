CREATE UNIQUE INDEX "Asset_unique_fixed_income_group"
ON "Asset" ("portfolioId", "fixedIncomeFamilyCode", "indexation")
WHERE "instrumentType" = 'FIXED_INCOME'
  AND "fixedIncomeFamilyCode" IS NOT NULL
  AND "indexation" IS NOT NULL;
