import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_QUESTIONS, defaultQuestionTemplateKey } from "./questions";

/** Match the deployed SQL backfill; legacy questions retain their own identity. */
export function legacyQuestionTemplateKey(id: string) {
  return `LEGACY_${createHash("md5").update(id).digest("hex")}`;
}

/**
 * Explicit seed/write path, never a page loader. Nullable userId does not make
 * the composite unique key unique for global templates, so seeds serialize and
 * reuse a pre-existing ID instead of deleting/recreating answered questions.
 */
export async function synchronizeGlobalQuestionTemplates(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('uovp:global-diagram-templates'))`;
  for (const [sortOrder, question] of DEFAULT_QUESTIONS.entries()) {
    const templateKey = defaultQuestionTemplateKey(question);
    const existing = await tx.diagramQuestion.findFirst({
      where: { userId: null, templateKey },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    }) ?? await tx.diagramQuestion.findFirst({
      where: { userId: null, templateKey: null, type: question.type, criterion: question.criterion, text: question.text },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const data = { ...question, sortOrder, templateKey, active: true, isDefault: true };
    if (existing) await tx.diagramQuestion.update({ where: { id: existing.id }, data });
    else await tx.diagramQuestion.create({ data });
  }
  const missingKeys = await tx.diagramQuestion.findMany({
    where: { userId: null, templateKey: null }, select: { id: true },
  });
  for (const question of missingKeys) {
    await tx.diagramQuestion.updateMany({
      where: { id: question.id, userId: null, templateKey: null },
      data: { templateKey: legacyQuestionTemplateKey(question.id) },
    });
  }
}

/**
 * Preserve customized/deactivated local questions, local answers and asset
 * scores. Global answers remain as historical records; only missing local
 * answers are copied. With duplicate globals, the newest answer wins the copy.
 */
export async function provisionUserDiagramQuestions(tx: Prisma.TransactionClient, userId: string) {
  const users = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `);
  if (!users.length) throw new Error("Usuário não encontrado.");
  const globals = await tx.diagramQuestion.findMany({
    where: {
      userId: null,
      OR: [{ isDefault: true }, { answers: { some: { asset: { portfolio: { userId } } } } }],
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const keyById = new Map(globals.map((question) => [question.id, question.templateKey ?? legacyQuestionTemplateKey(question.id)]));
  const sources = new Map<string, typeof globals[number]>();
  for (const question of globals) {
    const key = keyById.get(question.id)!;
    if (!sources.has(key)) sources.set(key, question);
  }
  const created = await tx.diagramQuestion.createMany({
    data: [...sources].map(([templateKey, question]) => ({
      userId, templateKey, type: question.type, criterion: question.criterion,
      text: question.text, sortOrder: question.sortOrder, active: question.active,
      isDefault: false,
    })),
    skipDuplicates: true,
  });
  const copies = await tx.diagramQuestion.findMany({
    where: { userId, templateKey: { in: [...sources.keys()] } }, select: { id: true, templateKey: true },
  });
  const copyByKey = new Map(copies.map((question) => [question.templateKey, question.id]));
  const answers = await tx.assetQuestionAnswer.findMany({
    where: { asset: { portfolio: { userId } }, questionId: { in: globals.map((question) => question.id) } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { assetId: true, questionId: true, answer: true },
  });
  const copiedPairs = new Set<string>();
  const copied = await tx.assetQuestionAnswer.createMany({
    data: answers.flatMap((answer) => {
      const questionId = copyByKey.get(keyById.get(answer.questionId)!);
      if (!questionId) return [];
      const pair = `${answer.assetId}:${questionId}`;
      if (copiedPairs.has(pair)) return [];
      copiedPairs.add(pair);
      return [{ assetId: answer.assetId, questionId, answer: answer.answer }];
    }),
    skipDuplicates: true,
  });
  return { questionsCreated: created.count, answersCopied: copied.count };
}

/** Maintenance over every existing user, independent of visits to the app. */
export async function backfillUserDiagramQuestions(db: PrismaClient, batchSize = 100) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("Lote inválido.");
  let cursor: string | undefined;
  const total = { users: 0, questionsCreated: 0, answersCopied: 0 };
  while (true) {
    const users: Array<{ id: string }> = await db.user.findMany({
      where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" }, take: batchSize, select: { id: true },
    });
    if (!users.length) break;
    for (const user of users) {
      const result = await db.$transaction((tx) => provisionUserDiagramQuestions(tx, user.id), { timeout: 30_000 });
      total.users++;
      total.questionsCreated += result.questionsCreated;
      total.answersCopied += result.answersCopied;
    }
    cursor = users.at(-1)!.id;
  }
  return total;
}
