CREATE TYPE "FinanceAssignmentSource" AS ENUM (
  'UNASSIGNED',
  'PROVIDER_DEFAULT',
  'USER_RULE',
  'MANUAL'
);

CREATE TYPE "FinanceClassificationMatchType" AS ENUM (
  'MERCHANT_CNPJ',
  'MERCHANT_NAME',
  'COUNTERPARTY_NAME',
  'DESCRIPTION',
  'PROVIDER_CATEGORY'
);

ALTER TABLE "FinanceTransaction"
  ADD COLUMN "descriptionRaw" TEXT,
  ADD COLUMN "merchantBusinessName" TEXT,
  ADD COLUMN "merchantCnpj" TEXT,
  ADD COLUMN "merchantCategory" TEXT,
  ADD COLUMN "counterpartyName" TEXT,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "providerCategoryId" TEXT,
  ADD COLUMN "budgetCategorySource" "FinanceAssignmentSource" NOT NULL DEFAULT 'UNASSIGNED',
  ADD COLUMN "tagAssignmentSource" "FinanceAssignmentSource" NOT NULL DEFAULT 'UNASSIGNED',
  ADD COLUMN "internalTransferSource" "FinanceAssignmentSource" NOT NULL DEFAULT 'UNASSIGNED',
  ADD COLUMN "classificationRuleId" TEXT,
  ADD COLUMN "classifiedAt" TIMESTAMP(3);

ALTER TABLE "FinanceTag"
  ADD COLUMN "systemKey" TEXT;

ALTER TABLE "FinanceTransactionTag"
  ADD COLUMN "source" "FinanceAssignmentSource" NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "PluggyTransaction"
  ADD COLUMN "descriptionRaw" TEXT,
  ADD COLUMN "merchantBusinessName" TEXT,
  ADD COLUMN "merchantCnpj" TEXT,
  ADD COLUMN "merchantCategory" TEXT,
  ADD COLUMN "counterpartyName" TEXT,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "installmentNumber" INTEGER,
  ADD COLUMN "installmentTotal" INTEGER;

CREATE TABLE "FinanceClassificationRule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "matchType" "FinanceClassificationMatchType" NOT NULL,
  "matchValue" TEXT NOT NULL,
  "matchLabel" TEXT NOT NULL,
  "kind" "FinanceTransactionKind" NOT NULL,
  "assignsBudgetCategory" BOOLEAN NOT NULL DEFAULT false,
  "budgetCategory" "BudgetCategory",
  "assignsTags" BOOLEAN NOT NULL DEFAULT false,
  "assignsInternalTransfer" BOOLEAN NOT NULL DEFAULT false,
  "internalTransfer" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceClassificationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceClassificationRuleTag" (
  "ruleId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "FinanceClassificationRuleTag_pkey" PRIMARY KEY ("ruleId", "tagId")
);

CREATE UNIQUE INDEX "FinanceTag_userId_systemKey_key"
  ON "FinanceTag"("userId", "systemKey");
CREATE UNIQUE INDEX "FinanceClassificationRule_userId_matchType_matchValue_kind_key"
  ON "FinanceClassificationRule"("userId", "matchType", "matchValue", "kind");
CREATE INDEX "FinanceClassificationRule_userId_enabled_idx"
  ON "FinanceClassificationRule"("userId", "enabled");
CREATE INDEX "FinanceClassificationRuleTag_tagId_idx"
  ON "FinanceClassificationRuleTag"("tagId");
CREATE INDEX "FinanceTransaction_userId_budgetCategorySource_idx"
  ON "FinanceTransaction"("userId", "budgetCategorySource");
CREATE INDEX "FinanceTransaction_userId_tagAssignmentSource_idx"
  ON "FinanceTransaction"("userId", "tagAssignmentSource");
CREATE INDEX "FinanceTransaction_classificationRuleId_idx"
  ON "FinanceTransaction"("classificationRuleId");

ALTER TABLE "FinanceClassificationRule"
  ADD CONSTRAINT "FinanceClassificationRule_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceClassificationRuleTag"
  ADD CONSTRAINT "FinanceClassificationRuleTag_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "FinanceClassificationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceClassificationRuleTag"
  ADD CONSTRAINT "FinanceClassificationRuleTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "FinanceTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceTransaction"
  ADD CONSTRAINT "FinanceTransaction_classificationRuleId_fkey"
  FOREIGN KEY ("classificationRuleId") REFERENCES "FinanceClassificationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "FinanceTag"
SET "systemKey" = CASE "name"
  WHEN 'Alimentação' THEN 'FOOD'
  WHEN 'Contas de Casa' THEN 'HOME'
  WHEN 'Educação' THEN 'EDUCATION'
  WHEN 'Lazer' THEN 'LEISURE'
  WHEN 'Transporte' THEN 'TRANSPORT'
  WHEN 'Vestuário' THEN 'CLOTHING'
END
WHERE "name" IN (
  'Alimentação',
  'Contas de Casa',
  'Educação',
  'Lazer',
  'Transporte',
  'Vestuário'
);

UPDATE "FinanceTransaction"
SET "budgetCategorySource" = 'MANUAL'
WHERE "budgetCategory" IS NOT NULL;

UPDATE "FinanceTransaction"
SET "tagAssignmentSource" = 'MANUAL'
WHERE EXISTS (
  SELECT 1
  FROM "FinanceTransactionTag" transaction_tag
  WHERE transaction_tag."transactionId" = "FinanceTransaction"."id"
);

UPDATE "FinanceTransaction"
SET "internalTransferSource" = 'MANUAL'
WHERE "internalTransfer" = true;

UPDATE "FinanceTransaction" finance_transaction
SET
  "descriptionRaw" = pluggy_transaction."descriptionRaw",
  "merchantBusinessName" = pluggy_transaction."merchantBusinessName",
  "merchantCnpj" = pluggy_transaction."merchantCnpj",
  "merchantCategory" = pluggy_transaction."merchantCategory",
  "counterpartyName" = pluggy_transaction."counterpartyName",
  "paymentMethod" = pluggy_transaction."paymentMethod",
  "providerCategoryId" = pluggy_transaction."categoryId",
  "installmentNumber" = COALESCE(pluggy_transaction."installmentNumber", finance_transaction."installmentNumber"),
  "installmentTotal" = COALESCE(pluggy_transaction."installmentTotal", finance_transaction."installmentTotal")
FROM "PluggyTransaction" pluggy_transaction
WHERE finance_transaction."source" = 'PLUGGY'
  AND finance_transaction."externalId" = pluggy_transaction."pluggyTransactionId";

UPDATE "FinanceTransaction"
SET
  "internalTransfer" = true,
  "internalTransferSource" = 'PROVIDER_DEFAULT',
  "classifiedAt" = CURRENT_TIMESTAMP
WHERE "source" = 'PLUGGY'
  AND "internalTransferSource" = 'UNASSIGNED'
  AND (
    UPPER(COALESCE("providerCategory", '')) LIKE 'SAME PERSON TRANSFER%'
    OR UPPER(COALESCE("providerCategory", '')) LIKE 'CREDIT CARD PAYMENT%'
  );

UPDATE "FinanceTransaction"
SET
  "budgetCategory" = CASE
    WHEN UPPER(COALESCE("providerCategory", '')) SIMILAR TO '%(INVESTMENT|PENSION|FIXED INCOME|MUTUAL FUND|VARIABLE INCOME|MARGIN|PROCEEDS INTERESTS AND DIVIDENDS|TAXES ON INVESTMENTS)%'
      THEN 'FINANCIAL_FREEDOM'::"BudgetCategory"
    WHEN UPPER(COALESCE("providerCategory", '')) SIMILAR TO '%(EDUCATION|ONLINE COURSE|UNIVERSITY|SCHOOL|KINDERGARTEN|BOOKSTORE)%'
      THEN 'KNOWLEDGE'::"BudgetCategory"
    WHEN UPPER(COALESCE("providerCategory", '')) SIMILAR TO '%(FOOD DELIVERY|EATING OUT|LEISURE|GAMBLING|TRAVEL|AIRPORT|AIRLINES|ACCOMMODATION|MILEAGE|BUS TICKET|STADIUM|MUSEUM|CINEMA|THEATER|CONCERT|DIGITAL SERVICE|GAMING|VIDEO STREAMING|MUSIC STREAMING)%'
      THEN 'PLEASURES'::"BudgetCategory"
    WHEN UPPER(COALESCE("providerCategory", '')) SIMILAR TO '%(SHOPPING|TRANSPORTATION|AUTOMOTIVE|GAS STATION|PARKING|TOLL|CAR RENTAL|BICYCLE|TAXI|RIDE HAILING|VEHICLE OWNERSHIP|VEHICLE MAINTENANCE|TRAFFIC TICKET|WELLNESS|FITNESS|CLOTHING|ELECTRONICS|SPORTS GOOD|PET SUPPLIES)%'
      THEN 'COMFORT'::"BudgetCategory"
    WHEN UPPER(COALESCE("providerCategory", '')) SIMILAR TO '%(HOUSING|RENT|HOUSEWARE|UTILIT|WATER|ELECTRICITY|GAS|TELECOMMUNICATION|INTERNET|MOBILE|HEALTHCARE|DENTIST|PHARMACY|OPTOMETRY|HOSPITAL|INSURANCE|BANK FEE|ACCOUNT FEE|WIRE TRANSFER FEE|ATM FEE|CREDIT CARD FEE|LEGAL OBLIGATION|LOAN|FINANCING|URBAN LAND AND BUILDING TAX|INCOME TAX|TAX ON FINANCIAL OPERATIONS|TAXES|GROCERIES|SERVICES)%'
      THEN 'FIXED_COSTS'::"BudgetCategory"
    ELSE NULL
  END,
  "budgetCategorySource" = CASE
    WHEN UPPER(COALESCE("providerCategory", '')) SIMILAR TO '%(INVESTMENT|PENSION|FIXED INCOME|MUTUAL FUND|VARIABLE INCOME|MARGIN|PROCEEDS INTERESTS AND DIVIDENDS|TAXES ON INVESTMENTS|EDUCATION|ONLINE COURSE|UNIVERSITY|SCHOOL|KINDERGARTEN|BOOKSTORE|FOOD DELIVERY|EATING OUT|LEISURE|GAMBLING|TRAVEL|AIRPORT|AIRLINES|ACCOMMODATION|MILEAGE|BUS TICKET|STADIUM|MUSEUM|CINEMA|THEATER|CONCERT|DIGITAL SERVICE|GAMING|VIDEO STREAMING|MUSIC STREAMING|SHOPPING|TRANSPORTATION|AUTOMOTIVE|GAS STATION|PARKING|TOLL|CAR RENTAL|BICYCLE|TAXI|RIDE HAILING|VEHICLE OWNERSHIP|VEHICLE MAINTENANCE|TRAFFIC TICKET|WELLNESS|FITNESS|CLOTHING|ELECTRONICS|SPORTS GOOD|PET SUPPLIES|HOUSING|RENT|HOUSEWARE|UTILIT|WATER|ELECTRICITY|GAS|TELECOMMUNICATION|INTERNET|MOBILE|HEALTHCARE|DENTIST|PHARMACY|OPTOMETRY|HOSPITAL|INSURANCE|BANK FEE|ACCOUNT FEE|WIRE TRANSFER FEE|ATM FEE|CREDIT CARD FEE|LEGAL OBLIGATION|LOAN|FINANCING|URBAN LAND AND BUILDING TAX|INCOME TAX|TAX ON FINANCIAL OPERATIONS|TAXES|GROCERIES|SERVICES)%'
      THEN 'PROVIDER_DEFAULT'::"FinanceAssignmentSource"
    ELSE 'UNASSIGNED'::"FinanceAssignmentSource"
  END,
  "classifiedAt" = CURRENT_TIMESTAMP
WHERE "source" = 'PLUGGY'
  AND "kind" = 'EXPENSE'
  AND "budgetCategorySource" = 'UNASSIGNED'
  AND "internalTransfer" = false;

INSERT INTO "FinanceTransactionTag" ("transactionId", "tagId", "source")
SELECT transaction_row."id", tag."id", 'PROVIDER_DEFAULT'::"FinanceAssignmentSource"
FROM "FinanceTransaction" transaction_row
JOIN "FinanceTag" tag ON tag."userId" = transaction_row."userId"
WHERE transaction_row."source" = 'PLUGGY'
  AND transaction_row."kind" = 'EXPENSE'
  AND transaction_row."tagAssignmentSource" = 'UNASSIGNED'
  AND transaction_row."internalTransfer" = false
  AND (
    (tag."systemKey" = 'FOOD' AND UPPER(COALESCE(transaction_row."providerCategory", '')) SIMILAR TO '%(GROCERIES|FOOD DELIVERY|EATING OUT)%')
    OR (tag."systemKey" = 'HOME' AND UPPER(COALESCE(transaction_row."providerCategory", '')) SIMILAR TO '%(HOUSING|RENT|HOUSEWARE|UTILIT|WATER|ELECTRICITY|GAS|TELECOMMUNICATION|INTERNET|MOBILE|HOME INSURANCE)%')
    OR (tag."systemKey" = 'EDUCATION' AND UPPER(COALESCE(transaction_row."providerCategory", '')) SIMILAR TO '%(EDUCATION|ONLINE COURSE|UNIVERSITY|SCHOOL|KINDERGARTEN|BOOKSTORE)%')
    OR (tag."systemKey" = 'LEISURE' AND UPPER(COALESCE(transaction_row."providerCategory", '')) SIMILAR TO '%(LEISURE|GAMBLING|TRAVEL|AIRPORT|AIRLINES|ACCOMMODATION|MILEAGE|BUS TICKET|STADIUM|MUSEUM|CINEMA|THEATER|CONCERT|DIGITAL SERVICE|GAMING|VIDEO STREAMING|MUSIC STREAMING)%')
    OR (tag."systemKey" = 'TRANSPORT' AND UPPER(COALESCE(transaction_row."providerCategory", '')) SIMILAR TO '%(TRANSPORTATION|AUTOMOTIVE|GAS STATION|PARKING|TOLL|CAR RENTAL|BICYCLE|TAXI|RIDE HAILING|VEHICLE)%')
    OR (tag."systemKey" = 'CLOTHING' AND UPPER(COALESCE(transaction_row."providerCategory", '')) LIKE '%CLOTHING%')
  )
ON CONFLICT ("transactionId", "tagId") DO NOTHING;

UPDATE "FinanceTransaction" transaction_row
SET
  "tagAssignmentSource" = 'PROVIDER_DEFAULT',
  "classifiedAt" = CURRENT_TIMESTAMP
WHERE transaction_row."source" = 'PLUGGY'
  AND transaction_row."tagAssignmentSource" = 'UNASSIGNED'
  AND EXISTS (
    SELECT 1
    FROM "FinanceTransactionTag" transaction_tag
    WHERE transaction_tag."transactionId" = transaction_row."id"
      AND transaction_tag."source" = 'PROVIDER_DEFAULT'
  );

UPDATE "FinanceTransaction"
SET "classifiedAt" = COALESCE("classifiedAt", CURRENT_TIMESTAMP)
WHERE "source" = 'PLUGGY';

CREATE OR REPLACE FUNCTION "guard_finance_transaction_tag_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_user_id TEXT;
  tag_user_id TEXT;
BEGIN
  SELECT transaction."userId"
    INTO transaction_user_id
    FROM "FinanceTransaction" transaction
   WHERE transaction."id" = NEW."transactionId";

  SELECT tag."userId"
    INTO tag_user_id
    FROM "FinanceTag" tag
   WHERE tag."id" = NEW."tagId";

  IF transaction_user_id IS NULL OR tag_user_id IS NULL OR transaction_user_id <> tag_user_id THEN
    RAISE EXCEPTION 'FinanceTransactionTag cannot cross tenant boundaries';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "FinanceTransactionTag_tenant_guard" ON "FinanceTransactionTag";
CREATE TRIGGER "FinanceTransactionTag_tenant_guard"
BEFORE INSERT OR UPDATE OF "transactionId", "tagId"
ON "FinanceTransactionTag"
FOR EACH ROW
EXECUTE FUNCTION "guard_finance_transaction_tag_tenant"();

CREATE OR REPLACE FUNCTION "guard_finance_rule_tag_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  rule_user_id TEXT;
  tag_user_id TEXT;
BEGIN
  SELECT rule."userId"
    INTO rule_user_id
    FROM "FinanceClassificationRule" rule
   WHERE rule."id" = NEW."ruleId";

  SELECT tag."userId"
    INTO tag_user_id
    FROM "FinanceTag" tag
   WHERE tag."id" = NEW."tagId";

  IF rule_user_id IS NULL OR tag_user_id IS NULL OR rule_user_id <> tag_user_id THEN
    RAISE EXCEPTION 'FinanceClassificationRuleTag cannot cross tenant boundaries';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinanceClassificationRuleTag_tenant_guard"
BEFORE INSERT OR UPDATE OF "ruleId", "tagId"
ON "FinanceClassificationRuleTag"
FOR EACH ROW
EXECUTE FUNCTION "guard_finance_rule_tag_tenant"();

CREATE OR REPLACE FUNCTION "guard_finance_transaction_rule_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  rule_user_id TEXT;
BEGIN
  IF NEW."classificationRuleId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT rule."userId"
    INTO rule_user_id
    FROM "FinanceClassificationRule" rule
   WHERE rule."id" = NEW."classificationRuleId";

  IF rule_user_id IS NULL OR rule_user_id <> NEW."userId" THEN
    RAISE EXCEPTION 'FinanceTransaction classification rule cannot cross tenant boundaries';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinanceTransaction_classification_rule_tenant_guard"
BEFORE INSERT OR UPDATE OF "classificationRuleId", "userId"
ON "FinanceTransaction"
FOR EACH ROW
EXECUTE FUNCTION "guard_finance_transaction_rule_tenant"();
