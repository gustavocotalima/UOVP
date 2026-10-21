BEGIN;
-- statement-breakpoint
-- Nullable userId does not enforce uniqueness of global template keys. Seed
-- and migration serialize on the same lock; neither deletes answered rows.
SELECT pg_advisory_xact_lock(hashtext('uovp:global-diagram-templates'));
-- statement-breakpoint
-- Take the user lock before question locks, matching provisioning's lock order.
-- Reads remain available; registrations/writes wait until backfill completes.
LOCK TABLE "User" IN EXCLUSIVE MODE;
-- statement-breakpoint
LOCK TABLE "DiagramQuestion", "AssetQuestionAnswer" IN SHARE ROW EXCLUSIVE MODE;
-- statement-breakpoint
CREATE TEMP TABLE uovp_default_diagram_question (
  template_key TEXT PRIMARY KEY,
  question_type "DiagramType" NOT NULL,
  criterion TEXT NOT NULL,
  question_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL
) ON COMMIT DROP;
-- statement-breakpoint
INSERT INTO uovp_default_diagram_question VALUES
('CERRADO_ROE', 'CERRADO', 'ROE', 'ROE historicamente maior que 5%? (Considere anos anteriores).', 0),
('CERRADO_CAGR', 'CERRADO', 'CAGR', 'Tem um crescimento de receitas (Ou lucro) superior a 5% nos últimos 5 anos?', 1),
('CERRADO_DIVIDENDOS', 'CERRADO', 'DIVIDENDOS', 'A empresa tem um histórico de pagamento de dividendos?', 2),
('CERRADO_TECNOLOGIA_E_PESQUISA', 'CERRADO', 'TECNOLOGIA E PESQUISA', 'A empresa investe amplamente em pesquisa e inovação? Setor Obsoleto = SEMPRE NÃO', 3),
('CERRADO_TEMPO_DE_MERCADO', 'CERRADO', 'TEMPO DE MERCADO', 'Tem mais de 30 anos de mercado? (Fundação)', 4),
('CERRADO_VANTAGENS_COMPETITIVAS', 'CERRADO', 'VANTAGENS COMPETITIVAS', 'É líder nacional ou mundial no setor em que atua? (Só considera se for LÍDER, primeira colocada)', 5),
('CERRADO_PERENIDADE', 'CERRADO', 'PERENIDADE', 'O setor em que a empresa atua tem mais de 100 anos?', 6),
('CERRADO_TAMANHO', 'CERRADO', 'TAMANHO', 'A empresa é uma BLUE CHIP?', 7),
('CERRADO_GOVERNANCA', 'CERRADO', 'GOVERNANÇA', 'A empresa tem uma boa gestão? Histórico de corrupção = SEMPRE NÃO', 8),
('CERRADO_INDEPENDENCIA', 'CERRADO', 'INDEPENDÊNCIA', 'É livre de controle ESTATAL ou concentração em cliente único?', 9),
('CERRADO_POUCO_ENDIVIDADA', 'CERRADO', 'POUCO ENDIVIDADA', 'Nos últimos 5 anos, a Div. Líquida/EBITDA é menor que 2 ou o Indice de Basileia maior que 14 para banco?', 10),
('REAL_ESTATE_LOCALIZACAO', 'REAL_ESTATE', 'Localização', 'Os imóveis desse Fundo Imobiliário estão localizados em regiões nobres?', 11),
('REAL_ESTATE_PROPRIEDADES', 'REAL_ESTATE', 'Propriedades', 'As propriedades são novas e não consomem manutenção excessiva?', 12),
('REAL_ESTATE_P_VP', 'REAL_ESTATE', 'P/VP', 'O fundo imobiliário está negociado abaixo do P/VP 1? (Acima de 1,5, eu descarto o investimento em qualquer hipótese)', 13),
('REAL_ESTATE_DIVIDENDOS', 'REAL_ESTATE', 'Dividendos', 'Distribui dividendos a mais de 4 anos consistentemente?', 14),
('REAL_ESTATE_DEPENDENCIA', 'REAL_ESTATE', 'Dependência', 'Não é dependende de um único inquilino ou imóvel?', 15),
('REAL_ESTATE_SETOR', 'REAL_ESTATE', 'Setor', 'O Yield está dentro ou acima da média para fundos imobiliários do mesmo tipo?', 16),
('REAL_ESTATE_VACANCIA', 'REAL_ESTATE', 'Vacancia', 'A vacância dos imóveis está abaixo de 5%', 17);
-- statement-breakpoint
-- Reuse only exact unkeyed templates; never reassign an existing template key.
WITH candidates AS (
  SELECT question."id", model.template_key,
         ROW_NUMBER() OVER (PARTITION BY model.template_key ORDER BY question."createdAt", question."id") AS candidate_rank
  FROM "DiagramQuestion" question
  JOIN uovp_default_diagram_question model
    ON question."type" = model.question_type
    AND question."criterion" = model.criterion AND question."text" = model.question_text
  WHERE question."userId" IS NULL AND question."templateKey" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "DiagramQuestion" existing
      WHERE existing."userId" IS NULL AND existing."templateKey" = model.template_key
    )
)
UPDATE "DiagramQuestion" question SET "templateKey" = candidates.template_key
FROM candidates WHERE question."id" = candidates."id" AND candidates.candidate_rank = 1;
-- statement-breakpoint
UPDATE "DiagramQuestion"
SET "templateKey" = 'LEGACY_' || md5("id")
WHERE "userId" IS NULL AND "templateKey" IS NULL;
-- statement-breakpoint
INSERT INTO "DiagramQuestion" (
  "id", "userId", "type", "criterion", "text", "sortOrder", "active", "isDefault", "templateKey", "createdAt", "updatedAt"
)
SELECT 'uovp-default-' || lower(model.template_key), NULL, model.question_type,
       model.criterion, model.question_text, model.sort_order, TRUE, TRUE,
       model.template_key, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM uovp_default_diagram_question model
WHERE NOT EXISTS (
  SELECT 1 FROM "DiagramQuestion" existing
  WHERE existing."userId" IS NULL AND existing."templateKey" = model.template_key
);
-- statement-breakpoint
-- A canonical template may have been retired globally; revive only its model,
-- preserving its ID and answers. Existing personal copies are never updated.
WITH chosen AS (
  SELECT DISTINCT ON (question."templateKey") question."id", model.*
  FROM "DiagramQuestion" question
  JOIN uovp_default_diagram_question model ON model.template_key = question."templateKey"
  WHERE question."userId" IS NULL
  ORDER BY question."templateKey", question."createdAt", question."id"
)
UPDATE "DiagramQuestion" question
SET "type" = chosen.question_type, "criterion" = chosen.criterion,
    "text" = chosen.question_text, "sortOrder" = chosen.sort_order,
    "active" = TRUE, "isDefault" = TRUE
FROM chosen WHERE question."id" = chosen."id";
-- statement-breakpoint
-- Every current user gets local defaults, plus any retired global question
-- they actually answered. Duplicate globals share a stable key and stay intact.
WITH sources AS (
  SELECT owner."id" AS user_id, question.*,
         ROW_NUMBER() OVER (
           PARTITION BY owner."id", question."templateKey"
           ORDER BY question."isDefault" DESC, question."createdAt", question."id"
         ) AS source_rank
  FROM "User" owner
  CROSS JOIN "DiagramQuestion" question
  WHERE question."userId" IS NULL
    AND (question."isDefault" = TRUE OR EXISTS (
      SELECT 1 FROM "AssetQuestionAnswer" answer
      JOIN "Asset" asset ON asset."id" = answer."assetId"
      JOIN "Portfolio" portfolio ON portfolio."id" = asset."portfolioId"
      WHERE answer."questionId" = question."id" AND portfolio."userId" = owner."id"
    ))
)
INSERT INTO "DiagramQuestion" (
  "id", "userId", "type", "criterion", "text", "sortOrder", "active", "isDefault", "templateKey", "createdAt", "updatedAt"
)
SELECT 'user-question-' || md5(user_id || ':' || "templateKey"), user_id,
       "type", "criterion", "text", "sortOrder", "active", FALSE, "templateKey", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM sources WHERE source_rank = 1
ON CONFLICT ("userId", "templateKey") DO NOTHING;
-- statement-breakpoint
-- Preserve existing local answers first. If duplicate globals disagree, copy
-- only the latest answer; retain every original global answer for history.
WITH candidates AS (
  SELECT answer."assetId", local_question."id" AS local_question_id, answer."answer",
         ROW_NUMBER() OVER (
           PARTITION BY answer."assetId", local_question."id"
           ORDER BY answer."updatedAt" DESC, answer."id"
         ) AS answer_rank
  FROM "AssetQuestionAnswer" answer
  JOIN "DiagramQuestion" global_question
    ON global_question."id" = answer."questionId" AND global_question."userId" IS NULL
  JOIN "Asset" asset ON asset."id" = answer."assetId"
  JOIN "Portfolio" portfolio ON portfolio."id" = asset."portfolioId"
  JOIN "DiagramQuestion" local_question
    ON local_question."userId" = portfolio."userId" AND local_question."templateKey" = global_question."templateKey"
)
INSERT INTO "AssetQuestionAnswer" ("id", "assetId", "questionId", "answer", "createdAt", "updatedAt")
SELECT 'user-answer-' || md5("assetId" || ':' || local_question_id), "assetId", local_question_id, "answer",
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM candidates WHERE answer_rank = 1
ON CONFLICT ("assetId", "questionId") DO NOTHING;
-- statement-breakpoint
-- Asset.score, custom/local questions, disabled flags, original global
-- questions and original answers are deliberately preserved.
COMMIT;
