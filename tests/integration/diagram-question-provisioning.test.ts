import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  backfillUserDiagramQuestions,
  legacyQuestionTemplateKey,
  provisionUserDiagramQuestions,
  synchronizeGlobalQuestionTemplates,
} from "@/features/portfolio/question-provisioning";
import { DEFAULT_QUESTIONS, defaultQuestionTemplateKey } from "@/features/portfolio/questions";
import { getDiagramData } from "@/features/portfolio/data";

const db = process.env.DATABASE_URL ? new PrismaClient() : null;
const suite = db ? describe : describe.skip;

suite("provisionamento seguro de perguntas e respostas legadas", () => {
  const userIds: string[] = [];
  const globalIds: string[] = [];

  afterAll(async () => {
    if (!db) return;
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.diagramQuestion.deleteMany({ where: { id: { in: globalIds } } });
    await db.$disconnect();
  });

  async function fixture() {
    const suffix = randomUUID();
    const user = await db!.user.create({
      data: { email: `question-repair-${suffix}@example.com`, portfolio: { create: {} } }, include: { portfolio: true },
    });
    userIds.push(user.id);
    const asset = await db!.asset.create({ data: {
      portfolioId: user.portfolio!.id, ticker: `TEST-${suffix}`, name: "Ativo", score: 7,
      investmentClass: "BRAZILIAN_STOCKS", instrumentType: "STOCK",
    } });
    const templateKey = `TEST_${suffix}`;
    const global = await db!.diagramQuestion.create({ data: {
      type: "CERRADO", criterion: "MODELO", text: "Pergunta global respondida", templateKey, isDefault: true,
    } });
    const retired = await db!.diagramQuestion.create({ data: {
      type: "REAL_ESTATE", criterion: "ANTIGA", text: "Pergunta global retirada", active: false, isDefault: false,
    } });
    globalIds.push(global.id, retired.id);
    const local = await db!.diagramQuestion.create({ data: {
      userId: user.id, type: "CERRADO", criterion: "EDITADA", text: "Texto pessoal preservado",
      templateKey, active: false, sortOrder: 99,
    } });
    const custom = await db!.diagramQuestion.create({ data: {
      userId: user.id, type: "CERRADO", criterion: "CUSTOM", text: "Pergunta personalizada sem chave", active: false,
    } });
    const localAnswer = await db!.assetQuestionAnswer.create({ data: { assetId: asset.id, questionId: local.id, answer: false } });
    await db!.assetQuestionAnswer.createMany({ data: [
      { assetId: asset.id, questionId: global.id, answer: true },
      { assetId: asset.id, questionId: retired.id, answer: true },
    ] });
    return { user, asset, global, retired, local, custom, localAnswer };
  }

  async function assertPreserved(f: Awaited<ReturnType<typeof fixture>>) {
    expect(await db!.diagramQuestion.findUniqueOrThrow({ where: { id: f.local.id } })).toEqual(f.local);
    expect(await db!.diagramQuestion.findUniqueOrThrow({ where: { id: f.custom.id } })).toEqual(f.custom);
    expect(await db!.assetQuestionAnswer.findUniqueOrThrow({ where: { id: f.localAnswer.id } })).toEqual(f.localAnswer);
    expect((await db!.asset.findUniqueOrThrow({ where: { id: f.asset.id } })).score).toBe(7);
    expect(await db!.assetQuestionAnswer.count({ where: { assetId: f.asset.id, questionId: { in: [f.global.id, f.retired.id] } } })).toBe(2);
    const retiredCopy = await db!.diagramQuestion.findUniqueOrThrow({
      where: { userId_templateKey: { userId: f.user.id, templateKey: legacyQuestionTemplateKey(f.retired.id) } },
    });
    expect(retiredCopy).toMatchObject({ active: false, text: f.retired.text, isDefault: false });
    expect(await db!.assetQuestionAnswer.findUniqueOrThrow({
      where: { assetId_questionId: { assetId: f.asset.id, questionId: retiredCopy.id } },
    })).toMatchObject({ answer: true });
    const canonical = await db!.diagramQuestion.findMany({ where: {
      userId: f.user.id, templateKey: { in: DEFAULT_QUESTIONS.map(defaultQuestionTemplateKey) },
    } });
    expect(canonical).toHaveLength(DEFAULT_QUESTIONS.length);
  }

  async function personalSnapshot(userId: string) {
    return {
      questions: await db!.diagramQuestion.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      answers: await db!.assetQuestionAnswer.findMany({ where: { asset: { portfolio: { userId } } }, orderBy: { id: "asc" } }),
    };
  }

  it("seed de perguntas duas vezes preserva IDs, respostas e personalizações sem abrir páginas", async () => {
    await db!.$transaction(synchronizeGlobalQuestionTemplates);
    const f = await fixture();
    const neverVisited = await db!.user.create({ data: { email: `question-unvisited-${randomUUID()}@example.com` } });
    userIds.push(neverVisited.id);
    const canonicalBefore = await db!.diagramQuestion.findMany({
      where: { userId: null, templateKey: { in: DEFAULT_QUESTIONS.map(defaultQuestionTemplateKey) } },
      orderBy: { id: "asc" }, select: { id: true },
    });
    await db!.$transaction(synchronizeGlobalQuestionTemplates);
    await backfillUserDiagramQuestions(db!, 1);
    await assertPreserved(f);
    expect(await db!.diagramQuestion.count({ where: { userId: neverVisited.id } })).toBeGreaterThanOrEqual(DEFAULT_QUESTIONS.length);
    const first = await personalSnapshot(f.user.id);
    await db!.$transaction(synchronizeGlobalQuestionTemplates);
    const secondRun = await backfillUserDiagramQuestions(db!, 1);
    expect(secondRun).toMatchObject({ questionsCreated: 0, answersCopied: 0 });
    expect(await personalSnapshot(f.user.id)).toEqual(first);
    const canonicalAfter = await db!.diagramQuestion.findMany({
      where: { userId: null, templateKey: { in: DEFAULT_QUESTIONS.map(defaultQuestionTemplateKey) } },
      orderBy: { id: "asc" }, select: { id: true },
    });
    expect(canonicalAfter).toEqual(canonicalBefore);
    expect(await db!.diagramQuestion.findUnique({ where: { id: f.global.id } })).not.toBeNull();
  });

  it("serializa reparos do mesmo usuário e usa a resposta global mais recente sem excluir originais", async () => {
    const f = await fixture();
    const templateKey = `DUPLICATE_${randomUUID()}`;
    const older = await db!.diagramQuestion.create({ data: {
      type: "CERRADO", text: "Modelo duplicado", criterion: "DUPLICADO", templateKey, isDefault: true,
    } });
    const newer = await db!.diagramQuestion.create({ data: {
      type: "CERRADO", text: "Modelo duplicado", criterion: "DUPLICADO", templateKey, isDefault: true,
    } });
    globalIds.push(older.id, newer.id);
    await db!.assetQuestionAnswer.createMany({ data: [
      { assetId: f.asset.id, questionId: older.id, answer: true, updatedAt: new Date("2026-08-01T12:00:00Z") },
      { assetId: f.asset.id, questionId: newer.id, answer: false, updatedAt: new Date("2026-08-02T12:00:00Z") },
    ] });
    await db!.$transaction(synchronizeGlobalQuestionTemplates);
    await Promise.all([1, 2, 3].map(() => db!.$transaction((tx) => provisionUserDiagramQuestions(tx, f.user.id))));
    const copy = await db!.diagramQuestion.findUniqueOrThrow({ where: { userId_templateKey: { userId: f.user.id, templateKey } } });
    expect(await db!.assetQuestionAnswer.findUniqueOrThrow({ where: { assetId_questionId: { assetId: f.asset.id, questionId: copy.id } } }))
      .toMatchObject({ answer: false });
    expect(await db!.assetQuestionAnswer.count({ where: { assetId: f.asset.id, questionId: { in: [older.id, newer.id] } } })).toBe(2);
    await assertPreserved(f);
  });

  it("migração de deploy executada duas vezes converge com o helper e preserva dados legados", async () => {
    const f = await fixture();
    const sql = readFileSync(new URL("../../prisma/migrations/20261021030000_preserve_diagram_questions/migration.sql", import.meta.url), "utf8");
    // Execute exactly the migration's statements inside one test transaction.
    // Delimiters avoid splitting semicolons inside SQL literals/comments.
    const statements = sql.split("-- statement-breakpoint").map((statement) => statement.trim())
      .filter((statement) => {
        const command = statement.replace(/^--.*$/gm, "").trim();
        return command && command !== "BEGIN;" && command !== "COMMIT;";
      });
    const migrate = () => db!.$transaction(async (tx) => {
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
    }, { timeout: 30_000 });
    await migrate();
    await assertPreserved(f);
    const first = await personalSnapshot(f.user.id);
    await migrate();
    expect(await personalSnapshot(f.user.id)).toEqual(first);
    expect(await db!.$transaction((tx) => provisionUserDiagramQuestions(tx, f.user.id)))
      .toEqual({ questionsCreated: 0, answersCopied: 0 });
  });

  it("leitura do legado já migrado retorna somente cópias locais sem alterar linhas ou timestamps", async () => {
    const f = await fixture();
    await db!.$transaction(synchronizeGlobalQuestionTemplates);
    await db!.$transaction((tx) => provisionUserDiagramQuestions(tx, f.user.id));
    const before = await personalSnapshot(f.user.id);
    const userBefore = await db!.user.findUniqueOrThrow({ where: { id: f.user.id } });
    const [first, second] = await Promise.all([getDiagramData(f.user.id), getDiagramData(f.user.id)]);
    expect(second).toEqual(first);
    expect(first.questions).toContainEqual(expect.objectContaining({ id: f.local.id, active: false, text: f.local.text }));
    expect(first.answers).toContainEqual({ assetId: f.asset.id, questionId: f.local.id, answer: false });
    expect(first.answers.some((answer) => [f.global.id, f.retired.id].includes(answer.questionId))).toBe(false);
    expect(first.answers.every((answer) => first.questions.some((question) => question.id === answer.questionId))).toBe(true);
    expect(await personalSnapshot(f.user.id)).toEqual(before);
    expect(await db!.user.findUniqueOrThrow({ where: { id: f.user.id } })).toEqual(userBefore);
    expect((await db!.asset.findUniqueOrThrow({ where: { id: f.asset.id } })).score).toBe(7);
  });

  it("ler um usuário ainda sem perguntas não cria modelos, respostas ou portfolio", async () => {
    const user = await db!.user.create({ data: { email: `read-only-questions-${randomUUID()}@example.com` } });
    userIds.push(user.id);
    const questionsBefore = await db!.diagramQuestion.count();
    const answersBefore = await db!.assetQuestionAnswer.count();
    expect(await getDiagramData(user.id)).toEqual({ questions: [], answers: [] });
    expect(await db!.diagramQuestion.count()).toBe(questionsBefore);
    expect(await db!.assetQuestionAnswer.count()).toBe(answersBefore);
    expect(await db!.portfolio.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await db!.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
  });
});
