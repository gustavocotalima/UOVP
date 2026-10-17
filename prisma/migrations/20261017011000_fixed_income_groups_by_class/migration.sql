-- A national and an international account may use the same family/indexation.
-- Preserve every existing group; uniqueness applies within its investment class.
DROP INDEX "Asset_unique_fixed_income_group";
DROP INDEX "Asset_fixed_income_parent_group_key";
CREATE UNIQUE INDEX "Asset_unique_fixed_income_group"
ON "Asset" ("portfolioId", "investmentClass", "fixedIncomeFamilyCode", "indexation")
WHERE "instrumentType" = 'FIXED_INCOME'
  AND "fixedIncomeFamilyCode" IS NOT NULL
  AND "indexation" IS NOT NULL;
