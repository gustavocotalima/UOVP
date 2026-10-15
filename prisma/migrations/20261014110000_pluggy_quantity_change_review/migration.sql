ALTER TABLE "PluggyInvestmentDiagramLink"
  ADD COLUMN "overrideQuantityProviderQuantity" DECIMAL(30,10),
  ADD COLUMN "overrideQuantityAcknowledgedAt" TIMESTAMP(3);

-- Existing corrections start watching from the latest saved provider snapshot.
-- Neither the correction nor the effective holding is changed.
UPDATE "PluggyInvestmentDiagramLink" AS link
SET "overrideQuantityProviderQuantity" = investment."quantity",
    "overrideQuantityAcknowledgedAt" = CURRENT_TIMESTAMP
FROM "PluggyInvestment" AS investment
WHERE link."pluggyInvestmentDbId" = investment."id"
  AND 'QUANTITY' = ANY(link."metadataOverrideFields")
  AND link."overrideQuantity" IS NOT NULL;
