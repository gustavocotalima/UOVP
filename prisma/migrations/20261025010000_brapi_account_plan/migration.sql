CREATE TYPE "BrapiPlan" AS ENUM ('FREE', 'STARTUP', 'PRO');

ALTER TABLE "UserPreference"
  ADD COLUMN "brapiPlan" "BrapiPlan" NOT NULL DEFAULT 'FREE';
