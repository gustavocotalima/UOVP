CREATE TYPE "MarketMetadataProvider" AS ENUM ('BRAPI', 'YAHOO');
CREATE TYPE "MarketMetadataStatus" AS ENUM ('VERIFIED', 'MISSING');
CREATE TYPE "MarketMetadataSource" AS ENUM ('EXISTING', 'CATALOG', 'SEARCH');

CREATE TABLE "MarketAssetMetadata" (
    "id" TEXT NOT NULL,
    "provider" "MarketMetadataProvider" NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "logoUrl" TEXT,
    "status" "MarketMetadataStatus" NOT NULL,
    "source" "MarketMetadataSource" NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketAssetMetadata_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketAssetMetadata_provider_symbol_key"
ON "MarketAssetMetadata"("provider", "symbol");

CREATE INDEX "MarketAssetMetadata_status_lastAttemptAt_idx"
ON "MarketAssetMetadata"("status", "lastAttemptAt");

-- Reuse specific URLs already validated in users' portfolios. A browser failure can
-- still replace one of these records later with an exact catalog result.
INSERT INTO "MarketAssetMetadata" (
    "id",
    "provider",
    "symbol",
    "name",
    "logoUrl",
    "status",
    "source",
    "resolvedAt",
    "lastAttemptAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'existing_' || md5(candidate."provider"::text || ':' || candidate."symbol"),
    candidate."provider",
    candidate."symbol",
    candidate."name",
    candidate."logoUrl",
    'VERIFIED'::"MarketMetadataStatus",
    'EXISTING'::"MarketMetadataSource",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (source."provider", source."symbol")
        source."provider",
        source."symbol",
        source."name",
        source."logoUrl"
    FROM (
        SELECT
            CASE
                WHEN holding."pricingSource" = 'BRAPI' THEN 'BRAPI'::"MarketMetadataProvider"
                ELSE 'YAHOO'::"MarketMetadataProvider"
            END AS "provider",
            CASE
                WHEN holding."pricingSource" = 'BRAPI' THEN
                    upper(regexp_replace(
                        regexp_replace(COALESCE(holding."ticker", asset."ticker"), '\.SA$', '', 'i'),
                        '([0-9])F$',
                        '\1'
                    ))
                ELSE upper(COALESCE(holding."ticker", asset."ticker"))
            END AS "symbol",
            asset."name" AS "name",
            holding."logoUrl" AS "logoUrl",
            holding."updatedAt" AS "updatedAt"
        FROM "AssetHolding" AS holding
        INNER JOIN "Asset" AS asset ON asset."id" = holding."assetId"
        WHERE holding."pricingSource" IN ('BRAPI', 'YAHOO')
          AND holding."logoUrl" ~ '^https?://'
          AND lower(holding."logoUrl") <> 'https://icons.brapi.dev/icons/brapi.svg'
    ) AS source
    ORDER BY source."provider", source."symbol", source."updatedAt" DESC
) AS candidate
ON CONFLICT ("provider", "symbol") DO NOTHING;
