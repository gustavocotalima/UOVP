import { beforeEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({
  questions: vi.fn(), answers: vi.fn(), transaction: vi.fn(), questionCreate: vi.fn(), answerCreate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  diagramQuestion: { findMany: queries.questions, createMany: queries.questionCreate },
  assetQuestionAnswer: { findMany: queries.answers, createMany: queries.answerCreate },
  $transaction: queries.transaction,
} }));

import { getDiagramData } from "@/features/portfolio/data";

describe("loader de perguntas da carteira somente leitura", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("retorna perguntas locais desativadas e suas respostas sem provisionar ou consultar globais", async () => {
    queries.questions.mockResolvedValue([{
      id: "personal", userId: "user-a", type: "CERRADO", criterion: "Editado",
      text: "Texto preservado", sortOrder: 9, active: false, isDefault: false,
    }]);
    queries.answers.mockResolvedValue([{ assetId: "asset-a", questionId: "personal", answer: false }]);
    expect(await getDiagramData("user-a")).toEqual({
      questions: [{ id: "personal", type: "CERRADO", criterion: "Editado", text: "Texto preservado", sortOrder: 9, active: false, isDefault: false }],
      answers: [{ assetId: "asset-a", questionId: "personal", answer: false }],
    });
    expect(queries.questions).toHaveBeenCalledExactlyOnceWith({
      where: { userId: "user-a" }, orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    });
    expect(queries.answers).toHaveBeenCalledExactlyOnceWith({
      where: { asset: { portfolio: { userId: "user-a" } }, question: { userId: "user-a" } },
      select: { assetId: true, questionId: true, answer: true },
    });
    for (const write of [queries.transaction, queries.questionCreate, queries.answerCreate]) expect(write).not.toHaveBeenCalled();
  });

  it("uma leitura vazia não restaura modelos nem migra respostas", async () => {
    queries.questions.mockResolvedValue([]);
    queries.answers.mockResolvedValue([]);
    expect(await getDiagramData("legacy-unprepared")).toEqual({ questions: [], answers: [] });
    for (const write of [queries.transaction, queries.questionCreate, queries.answerCreate]) expect(write).not.toHaveBeenCalled();
  });
});
