UPDATE "FinanceTransaction" AS finance_transaction
SET
  "kind" = CASE UPPER(pluggy_transaction."type")
    WHEN 'DEBIT' THEN 'EXPENSE'::"FinanceTransactionKind"
    WHEN 'CREDIT' THEN 'INCOME'::"FinanceTransactionKind"
    ELSE finance_transaction."kind"
  END,
  "amount" = CASE UPPER(pluggy_transaction."type")
    WHEN 'DEBIT' THEN -ABS(finance_transaction."amount")
    WHEN 'CREDIT' THEN ABS(finance_transaction."amount")
    ELSE finance_transaction."amount"
  END
FROM "PluggyTransaction" AS pluggy_transaction
WHERE
  finance_transaction."source" = 'PLUGGY'
  AND finance_transaction."externalId" = pluggy_transaction."pluggyTransactionId"
  AND UPPER(pluggy_transaction."type") IN ('DEBIT', 'CREDIT');

