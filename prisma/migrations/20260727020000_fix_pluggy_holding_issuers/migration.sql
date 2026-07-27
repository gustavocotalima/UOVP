UPDATE "AssetHolding" AS holding
SET
  "issuer" = COALESCE(
    CASE
      WHEN REGEXP_REPLACE(LOWER(TRIM(investment."issuer")), '\s+', '', 'g')
        NOT IN ('', 'pluggy', 'meupluggy')
      THEN TRIM(investment."issuer")
    END,
    CASE
      WHEN REGEXP_REPLACE(LOWER(TRIM(investment."institutionName")), '\s+', '', 'g')
        NOT IN ('', 'pluggy', 'meupluggy')
      THEN TRIM(investment."institutionName")
    END,
    CASE
      WHEN REGEXP_REPLACE(LOWER(TRIM(item."institutionName")), '\s+', '', 'g')
        NOT IN ('', 'pluggy', 'meupluggy')
      THEN TRIM(item."institutionName")
    END,
    CASE
      WHEN REGEXP_REPLACE(LOWER(TRIM(item."connectorName")), '\s+', '', 'g')
        NOT IN ('', 'pluggy', 'meupluggy')
      THEN TRIM(item."connectorName")
    END,
    'Instituição'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "PluggyInvestmentDiagramLink" AS link
JOIN "PluggyInvestment" AS investment
  ON investment."id" = link."pluggyInvestmentDbId"
JOIN "PluggyItem" AS item
  ON item."id" = investment."pluggyItemDbId"
WHERE link."assetHoldingId" = holding."id"
  AND REGEXP_REPLACE(LOWER(TRIM(holding."issuer")), '\s+', '', 'g')
    IN ('', 'pluggy', 'meupluggy');
