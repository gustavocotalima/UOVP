ALTER TABLE "BinanceWalletAsset"
  ADD COLUMN "valuationSupported" BOOLEAN,
  ADD COLUMN "valuationMethod" TEXT,
  ADD COLUMN "valuationError" TEXT;
