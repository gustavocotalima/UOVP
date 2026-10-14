ALTER TYPE "PluggyInvestmentMetadataOverrideField" ADD VALUE 'QUANTITY';

ALTER TABLE "PluggyInvestmentDiagramLink"
ADD COLUMN "overrideQuantity" DECIMAL(30,10);
