-- Seed only users who already have transactions matching the requested prefixes.
INSERT INTO "FinanceClassificationRule" (
  "id",
  "userId",
  "matchType",
  "matchValue",
  "matchLabel",
  "kind",
  "assignsBudgetCategory",
  "budgetCategory",
  "assignsTags",
  "assignsInternalTransfer",
  "internalTransfer",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('prefix_credit_fund_', MD5("User"."id")),
  "User"."id",
  'DESCRIPTION_PREFIX',
  'CREDITO RESGATE FUNDO',
  'CREDITO RESGATE FUNDO…',
  'INCOME',
  true,
  'FINANCIAL_FREEDOM',
  false,
  false,
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE EXISTS (
  SELECT 1
  FROM "FinanceTransaction"
  WHERE "FinanceTransaction"."userId" = "User"."id"
    AND "FinanceTransaction"."source" = 'PLUGGY'
    AND "FinanceTransaction"."kind" = 'INCOME'
    AND UPPER(COALESCE(NULLIF("FinanceTransaction"."descriptionRaw", ''), "FinanceTransaction"."description"))
      LIKE 'CREDITO RESGATE FUNDO%'
)
ON CONFLICT ("userId", "matchType", "matchValue", "kind") DO NOTHING;

INSERT INTO "FinanceClassificationRule" (
  "id",
  "userId",
  "matchType",
  "matchValue",
  "matchLabel",
  "kind",
  "assignsBudgetCategory",
  "budgetCategory",
  "assignsTags",
  "assignsInternalTransfer",
  "internalTransfer",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('prefix_if_food_', MD5("User"."id")),
  "User"."id",
  'DESCRIPTION_PREFIX',
  'IF*',
  'IF*…',
  'EXPENSE',
  true,
  'PLEASURES',
  true,
  false,
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE EXISTS (
  SELECT 1
  FROM "FinanceTransaction"
  WHERE "FinanceTransaction"."userId" = "User"."id"
    AND "FinanceTransaction"."source" = 'PLUGGY'
    AND "FinanceTransaction"."kind" = 'EXPENSE'
    AND UPPER(COALESCE(NULLIF("FinanceTransaction"."descriptionRaw", ''), "FinanceTransaction"."description"))
      LIKE 'IF*%'
)
ON CONFLICT ("userId", "matchType", "matchValue", "kind") DO NOTHING;

INSERT INTO "FinanceClassificationRuleTag" ("ruleId", "tagId")
SELECT "FinanceClassificationRule"."id", "FinanceTag"."id"
FROM "FinanceClassificationRule"
JOIN "FinanceTag"
  ON "FinanceTag"."userId" = "FinanceClassificationRule"."userId"
  AND "FinanceTag"."systemKey" = 'FOOD'
WHERE "FinanceClassificationRule"."matchType" = 'DESCRIPTION_PREFIX'
  AND "FinanceClassificationRule"."matchValue" = 'IF*'
  AND "FinanceClassificationRule"."kind" = 'EXPENSE'
ON CONFLICT ("ruleId", "tagId") DO NOTHING;

-- Apply the new rules immediately without overwriting explicit manual choices.
UPDATE "FinanceTransaction"
SET
  "budgetCategory" = 'FINANCIAL_FREEDOM',
  "budgetCategorySource" = 'USER_RULE',
  "classificationRuleId" = "FinanceClassificationRule"."id",
  "classifiedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "FinanceClassificationRule"
WHERE "FinanceClassificationRule"."userId" = "FinanceTransaction"."userId"
  AND "FinanceClassificationRule"."matchType" = 'DESCRIPTION_PREFIX'
  AND "FinanceClassificationRule"."matchValue" = 'CREDITO RESGATE FUNDO'
  AND "FinanceClassificationRule"."kind" = 'INCOME'
  AND "FinanceTransaction"."source" = 'PLUGGY'
  AND "FinanceTransaction"."kind" = 'INCOME'
  AND "FinanceTransaction"."budgetCategorySource" <> 'MANUAL'
  AND UPPER(COALESCE(NULLIF("FinanceTransaction"."descriptionRaw", ''), "FinanceTransaction"."description"))
    LIKE 'CREDITO RESGATE FUNDO%';

UPDATE "FinanceTransaction"
SET
  "budgetCategory" = 'PLEASURES',
  "budgetCategorySource" = 'USER_RULE',
  "classificationRuleId" = "FinanceClassificationRule"."id",
  "classifiedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "FinanceClassificationRule"
WHERE "FinanceClassificationRule"."userId" = "FinanceTransaction"."userId"
  AND "FinanceClassificationRule"."matchType" = 'DESCRIPTION_PREFIX'
  AND "FinanceClassificationRule"."matchValue" = 'IF*'
  AND "FinanceClassificationRule"."kind" = 'EXPENSE'
  AND "FinanceTransaction"."source" = 'PLUGGY'
  AND "FinanceTransaction"."kind" = 'EXPENSE'
  AND "FinanceTransaction"."budgetCategorySource" <> 'MANUAL'
  AND UPPER(COALESCE(NULLIF("FinanceTransaction"."descriptionRaw", ''), "FinanceTransaction"."description"))
    LIKE 'IF*%';

DELETE FROM "FinanceTransactionTag"
USING "FinanceTransaction"
WHERE "FinanceTransactionTag"."transactionId" = "FinanceTransaction"."id"
  AND "FinanceTransactionTag"."source" <> 'MANUAL'
  AND "FinanceTransaction"."source" = 'PLUGGY'
  AND "FinanceTransaction"."kind" = 'EXPENSE'
  AND "FinanceTransaction"."tagAssignmentSource" <> 'MANUAL'
  AND UPPER(COALESCE(NULLIF("FinanceTransaction"."descriptionRaw", ''), "FinanceTransaction"."description"))
    LIKE 'IF*%';

UPDATE "FinanceTransaction"
SET
  "tagAssignmentSource" = 'USER_RULE',
  "classificationRuleId" = "FinanceClassificationRule"."id",
  "classifiedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "FinanceClassificationRule"
WHERE "FinanceClassificationRule"."userId" = "FinanceTransaction"."userId"
  AND "FinanceClassificationRule"."matchType" = 'DESCRIPTION_PREFIX'
  AND "FinanceClassificationRule"."matchValue" = 'IF*'
  AND "FinanceClassificationRule"."kind" = 'EXPENSE'
  AND "FinanceTransaction"."source" = 'PLUGGY'
  AND "FinanceTransaction"."kind" = 'EXPENSE'
  AND "FinanceTransaction"."tagAssignmentSource" <> 'MANUAL'
  AND UPPER(COALESCE(NULLIF("FinanceTransaction"."descriptionRaw", ''), "FinanceTransaction"."description"))
    LIKE 'IF*%';

INSERT INTO "FinanceTransactionTag" ("transactionId", "tagId", "source")
SELECT
  "FinanceTransaction"."id",
  "FinanceTag"."id",
  'USER_RULE'
FROM "FinanceTransaction"
JOIN "FinanceTag"
  ON "FinanceTag"."userId" = "FinanceTransaction"."userId"
  AND "FinanceTag"."systemKey" = 'FOOD'
WHERE "FinanceTransaction"."source" = 'PLUGGY'
  AND "FinanceTransaction"."kind" = 'EXPENSE'
  AND "FinanceTransaction"."tagAssignmentSource" = 'USER_RULE'
  AND UPPER(COALESCE(NULLIF("FinanceTransaction"."descriptionRaw", ''), "FinanceTransaction"."description"))
    LIKE 'IF*%'
ON CONFLICT ("transactionId", "tagId") DO NOTHING;
