CREATE TYPE "MarketRegion" AS ENUM ('BRAZIL', 'INTERNATIONAL');

ALTER TABLE "Asset"
ADD COLUMN "marketRegion" "MarketRegion";

ALTER TABLE "PluggyInvestmentDiagramLink"
ADD COLUMN "suggestedMarketRegion" "MarketRegion";
