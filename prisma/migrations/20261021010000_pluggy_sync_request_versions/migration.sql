ALTER TABLE "PluggyItem"
  ADD COLUMN "syncRequestedVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "syncProcessedVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PluggyItem" ADD CONSTRAINT "PluggyItem_sync_versions_check"
  CHECK ("syncProcessedVersion" >= 0
    AND "syncRequestedVersion" >= "syncProcessedVersion");
