ALTER TABLE "FinanceTransaction"
  ADD COLUMN "originalAmount" DECIMAL(30, 2),
  ADD COLUMN "originalCurrencyCode" TEXT;

UPDATE "FinanceTransaction" finance_transaction
SET
  "originalAmount" = CASE
    WHEN finance_transaction."kind" = 'EXPENSE'
      THEN -ABS(pluggy_transaction."amount")
    ELSE ABS(pluggy_transaction."amount")
  END,
  "originalCurrencyCode" = pluggy_transaction."currencyCode",
  "amount" = CASE
    WHEN finance_transaction."kind" = 'EXPENSE'
      THEN -ABS(COALESCE(pluggy_transaction."amountInAccountCurrency", pluggy_transaction."amount"))
    ELSE ABS(COALESCE(pluggy_transaction."amountInAccountCurrency", pluggy_transaction."amount"))
  END,
  "currencyCode" = financial_account."currencyCode",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "PluggyTransaction" pluggy_transaction,
     "FinancialAccount" financial_account
WHERE finance_transaction."source" = 'PLUGGY'
  AND finance_transaction."externalId" = pluggy_transaction."pluggyTransactionId"
  AND finance_transaction."accountId" = financial_account."id";
