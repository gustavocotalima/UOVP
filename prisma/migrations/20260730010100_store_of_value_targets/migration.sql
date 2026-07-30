INSERT INTO "InvestmentTarget" (
  "id",
  "userId",
  "investmentClass",
  "percentage",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('store_of_value_', MD5("User"."id")),
  "User"."id",
  'STORE_OF_VALUE'::"InvestmentClass",
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("userId", "investmentClass") DO NOTHING;

UPDATE "InvestorProfilePreset"
SET
  "targets" = "targets" || '{"STORE_OF_VALUE": 0}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE NOT ("targets" ? 'STORE_OF_VALUE');
