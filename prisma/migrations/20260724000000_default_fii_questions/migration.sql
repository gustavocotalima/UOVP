UPDATE "DiagramQuestion"
SET
  "active" = false,
  "isDefault" = false,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "userId" IS NULL
  AND "isDefault" = true
  AND "type" = 'REAL_ESTATE';

INSERT INTO "DiagramQuestion" (
  "id",
  "userId",
  "type",
  "criterion",
  "text",
  "sortOrder",
  "active",
  "isDefault",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'default-fii-localizacao',
    NULL,
    'REAL_ESTATE',
    'Localização',
    'Os imóveis desse Fundo Imobiliário estão localizados em regiões nobres?',
    0,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'default-fii-propriedades',
    NULL,
    'REAL_ESTATE',
    'Propriedades',
    'As propriedades são novas e não consomem manutenção excessiva?',
    1,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'default-fii-p-vp',
    NULL,
    'REAL_ESTATE',
    'P/VP',
    'O fundo imobiliário está negociado abaixo do P/VP 1? (Acima de 1,5, eu descarto o investimento em qualquer hipótese)',
    2,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'default-fii-dividendos',
    NULL,
    'REAL_ESTATE',
    'Dividendos',
    'Distribui dividendos a mais de 4 anos consistentemente?',
    3,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'default-fii-dependencia',
    NULL,
    'REAL_ESTATE',
    'Dependência',
    'Não é dependende de um único inquilino ou imóvel?',
    4,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'default-fii-setor',
    NULL,
    'REAL_ESTATE',
    'Setor',
    'O Yield está dentro ou acima da média para fundos imobiliários do mesmo tipo?',
    5,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'default-fii-vacancia',
    NULL,
    'REAL_ESTATE',
    'Vacancia',
    'A vacância dos imóveis está abaixo de 5%',
    6,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE
SET
  "userId" = EXCLUDED."userId",
  "type" = EXCLUDED."type",
  "criterion" = EXCLUDED."criterion",
  "text" = EXCLUDED."text",
  "sortOrder" = EXCLUDED."sortOrder",
  "active" = EXCLUDED."active",
  "isDefault" = EXCLUDED."isDefault",
  "updatedAt" = CURRENT_TIMESTAMP;
