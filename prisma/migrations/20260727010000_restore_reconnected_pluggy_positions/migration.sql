-- Pluggy can reuse investment IDs after a connection is removed and then
-- connected again. Restore only active positions excluded by removing the
-- previous connection. Explicit user exclusions and positions kept as manual
-- remain untouched.
UPDATE "Portfolio" portfolio
SET
  "version" = portfolio."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "Asset" asset
  JOIN "AssetHolding" holding ON holding."assetId" = asset."id"
  JOIN "PluggyInvestmentDiagramLink" link ON link."assetHoldingId" = holding."id"
  JOIN "PluggyInvestment" investment ON investment."id" = link."pluggyInvestmentDbId"
  JOIN "PluggyItem" item ON item."id" = investment."pluggyItemDbId"
  WHERE asset."portfolioId" = portfolio."id"
    AND link."status" = 'EXCLUDED'
    AND link."reviewReason" = 'Posição removida do diagrama após a desconexão da instituição.'
    AND investment."status" = 'ACTIVE'
    AND investment."providerAvailable" = true
    AND item."status" <> 'DELETED'
);

UPDATE "ContributionSimulation" simulation
SET "status" = 'STALE'
WHERE simulation."status" = 'DRAFT'
  AND EXISTS (
    SELECT 1
    FROM "PluggyInvestmentDiagramLink" link
    JOIN "PluggyInvestment" investment ON investment."id" = link."pluggyInvestmentDbId"
    JOIN "PluggyItem" item ON item."id" = investment."pluggyItemDbId"
    WHERE link."userId" = simulation."userId"
      AND link."status" = 'EXCLUDED'
      AND link."reviewReason" = 'Posição removida do diagrama após a desconexão da instituição.'
      AND investment."status" = 'ACTIVE'
      AND investment."providerAvailable" = true
      AND item."status" <> 'DELETED'
  );

UPDATE "AssetHolding" holding
SET
  "quantity" = COALESCE(investment."quantity", 0),
  "currentValue" = CASE
    WHEN holding."pricingSource" = 'PLUGGY' THEN investment."balance"
    ELSE holding."currentValue"
  END,
  "providerCurrentValue" = investment."balance",
  "includedInTotals" = true,
  "positionSource" = 'PLUGGY',
  "supersededAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "PluggyInvestmentDiagramLink" link
JOIN "PluggyInvestment" investment ON investment."id" = link."pluggyInvestmentDbId"
JOIN "PluggyItem" item ON item."id" = investment."pluggyItemDbId"
WHERE link."assetHoldingId" = holding."id"
  AND link."status" = 'EXCLUDED'
  AND link."reviewReason" = 'Posição removida do diagrama após a desconexão da instituição.'
  AND investment."status" = 'ACTIVE'
  AND investment."providerAvailable" = true
  AND item."status" <> 'DELETED';

UPDATE "PluggyInvestmentDiagramLink" link
SET
  "status" = 'MAPPED',
  "reviewReason" = NULL,
  "lastReconciledAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "PluggyInvestment" investment
JOIN "PluggyItem" item ON item."id" = investment."pluggyItemDbId"
WHERE investment."id" = link."pluggyInvestmentDbId"
  AND link."status" = 'EXCLUDED'
  AND link."reviewReason" = 'Posição removida do diagrama após a desconexão da instituição.'
  AND investment."status" = 'ACTIVE'
  AND investment."providerAvailable" = true
  AND item."status" <> 'DELETED';
