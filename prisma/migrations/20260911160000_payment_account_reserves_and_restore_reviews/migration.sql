INSERT INTO "FixedIncomeFamily" (
  "code",
  "name",
  "shortCode",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
VALUES (
  'PAYMENT_ACCOUNT_RESERVES',
  'Reservas remuneradas em contas de pagamento (sem FGC)',
  'CONTA-PGTO',
  50,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "shortCode" = EXCLUDED."shortCode",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "PluggyInvestmentDiagramLink"
SET
  "status" = 'NEEDS_REVIEW',
  "classificationSource" = 'USER_OVERRIDE',
  "suggestedInvestmentClass" = CASE
    WHEN "suggestedInstrumentType" = 'FIXED_INCOME' THEN "suggestedInvestmentClass"
    ELSE NULL
  END,
  "suggestedMarketRegion" = NULL,
  "suggestedFamilyCode" = NULL,
  "suggestedIndexation" = CASE
    WHEN "suggestedInstrumentType" = 'FIXED_INCOME' THEN "suggestedIndexation"
    ELSE NULL
  END,
  "reviewReason" = CASE
    WHEN "reviewReason" = 'Classe removida do diagrama pelo usuário.'
      THEN 'Classe removida da carteira. Revise a classificação para adicionar o investimento novamente.'
    ELSE 'Ativo removido da carteira. Revise a classificação para adicioná-lo novamente.'
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "status" = 'EXCLUDED'
  AND "reviewReason" IN (
    'Ativo removido do diagrama pelo usuário.',
    'Classe removida do diagrama pelo usuário.'
  );
