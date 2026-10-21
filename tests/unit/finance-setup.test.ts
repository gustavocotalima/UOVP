import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import {
  AUVP_FINANCE_GOALS,
  AUVP_FINANCE_TAGS,
  ensureFinanceSetup,
  previewFinanceSetupRepair,
  repairFinanceSetup,
} from "@/features/finance/setup";

function fixture() {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "user-a" }]),
    financeProfile: {
      findUnique: vi.fn().mockResolvedValue({ id: "profile-a" }),
      create: vi.fn(),
    },
    financeGoal: {
      findMany: vi.fn().mockResolvedValue(Object.keys(AUVP_FINANCE_GOALS).map((category) => ({ category }))),
      createMany: vi.fn(),
    },
    financeTag: {
      findMany: vi.fn().mockResolvedValue(AUVP_FINANCE_TAGS.map((tag) => ({ id: `tag-${tag.systemKey}`, ...tag }))),
      createMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { db, tx: db as unknown as Prisma.TransactionClient };
}

describe("provisionamento financeiro explícito", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("não grava nada para um usuário já provisionado", async () => {
    const { db, tx } = fixture();
    const plan = await repairFinanceSetup(tx, "user-a", { apply: true });

    expect(plan).toEqual({ createProfile: false, createGoals: [], createTags: [], restoreTagKeys: [], conflicts: [] });
    expect(db.financeProfile.create).not.toHaveBeenCalled();
    expect(db.financeGoal.createMany).not.toHaveBeenCalled();
    expect(db.financeTag.createMany).not.toHaveBeenCalled();
    expect(db.financeTag.updateMany).not.toHaveBeenCalled();
  });

  it("a simulação lista os registros ausentes sem locks ou gravações", async () => {
    const { db, tx } = fixture();
    db.financeProfile.findUnique.mockResolvedValue(null);
    db.financeGoal.findMany.mockResolvedValue([]);
    db.financeTag.findMany.mockResolvedValue([]);

    const plan = await repairFinanceSetup(tx, "user-a");
    expect(plan.createProfile).toBe(true);
    expect(plan.createGoals).toHaveLength(6);
    expect(plan.createTags).toHaveLength(6);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.financeProfile.create).not.toHaveBeenCalled();
    expect(db.financeGoal.createMany).not.toHaveBeenCalled();
    expect(db.financeTag.createMany).not.toHaveBeenCalled();
  });

  it("cria somente categorias ausentes, sem sobrescrever percentuais existentes", async () => {
    const { db, tx } = fixture();
    db.financeGoal.findMany.mockResolvedValue([
      { category: "FIXED_COSTS" }, { category: "COMFORT" }, { category: "GOALS" },
      { category: "PLEASURES" }, { category: "FINANCIAL_FREEDOM" },
    ]);

    await repairFinanceSetup(tx, "user-a", { apply: true });
    expect(db.financeGoal.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user-a", category: "KNOWLEDGE", percentage: 5 }],
    });
    expect(db.financeProfile.create).not.toHaveBeenCalled();
  });

  it("preserva nome e cor personalizados quando a chave de sistema já existe", async () => {
    const { db, tx } = fixture();
    db.financeTag.findMany.mockResolvedValue(AUVP_FINANCE_TAGS.map((tag) => ({
      ...tag, id: `tag-${tag.systemKey}`, name: `Personalizada ${tag.systemKey}`, color: "#112233",
    })));

    const plan = await repairFinanceSetup(tx, "user-a", { apply: true });
    expect(plan.createTags).toEqual([]);
    expect(plan.restoreTagKeys).toEqual([]);
    expect(db.financeTag.createMany).not.toHaveBeenCalled();
    expect(db.financeTag.updateMany).not.toHaveBeenCalled();
  });

  it("recupera chave por nome preservando ID, cor e associações da tag legada", async () => {
    const { db, tx } = fixture();
    db.financeTag.findMany.mockResolvedValue(AUVP_FINANCE_TAGS.map((tag) => ({
      ...tag, id: `tag-${tag.systemKey}`, systemKey: tag.systemKey === "FOOD" ? null : tag.systemKey,
    })));

    const plan = await repairFinanceSetup(tx, "user-a", { apply: true });
    expect(plan.restoreTagKeys).toEqual([{ id: "tag-FOOD", systemKey: "FOOD" }]);
    expect(db.financeTag.updateMany).toHaveBeenCalledWith({
      where: { id: "tag-FOOD", userId: "user-a", systemKey: null }, data: { systemKey: "FOOD" },
    });
    expect(db.financeTag.createMany).not.toHaveBeenCalled();
  });

  it("relata colisão de nome sem roubar a chave de outra tag ou duplicá-la", async () => {
    const { db, tx } = fixture();
    db.financeTag.findMany.mockResolvedValue(AUVP_FINANCE_TAGS
      .filter((tag) => tag.systemKey !== "FOOD")
      .map((tag) => ({ ...tag, id: `tag-${tag.systemKey}`, name: tag.systemKey === "HOME" ? "Alimentação" : tag.name })));

    const plan = await repairFinanceSetup(tx, "user-a", { apply: true });
    expect(plan.conflicts).toEqual([{
      id: "tag-HOME", name: "Alimentação", systemKey: "FOOD", existingSystemKey: "HOME",
    }]);
    expect(db.financeTag.createMany).not.toHaveBeenCalled();
    expect(db.financeTag.updateMany).not.toHaveBeenCalled();
  });

  it("consulta somente dados do usuário indicado e bloqueia antes de ler", async () => {
    const { db, tx } = fixture();
    await repairFinanceSetup(tx, "user-a", { apply: true });
    expect(db.financeProfile.findUnique).toHaveBeenCalledWith({ where: { userId: "user-a" }, select: { id: true } });
    expect(db.financeGoal.findMany.mock.calls[0][0].where).toEqual({ userId: "user-a" });
    expect(db.financeTag.findMany.mock.calls[0][0].where).toEqual({ userId: "user-a" });
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual(["user-a"]);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.financeProfile.findUnique.mock.invocationCallOrder[0]);
  });

  it("não tenta reparar um usuário inexistente", async () => {
    const { db, tx } = fixture();
    db.$queryRaw.mockResolvedValue([]);
    await expect(repairFinanceSetup(tx, "missing", { apply: true })).rejects.toThrow("Usuário não encontrado.");
    expect(db.financeProfile.findUnique).not.toHaveBeenCalled();
  });

  it("o fallback de escrita repete a transação após uma disputa de unicidade", async () => {
    const { tx } = fixture();
    mocks.transaction
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique race", { code: "P2002", clientVersion: "test" }))
      .mockImplementationOnce((operation) => operation(tx));
    const plan = await ensureFinanceSetup("user-a");
    expect(plan.createTags).toEqual([]);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("propaga falha de banco sem convertê-la em sucesso", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("Banco indisponível"));
    await expect(ensureFinanceSetup("user-a")).rejects.toThrow("Banco indisponível");
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("o preview público não bloqueia nem modifica configurações", async () => {
    const { db, tx } = fixture();
    await previewFinanceSetupRepair(tx, "user-a");
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.financeProfile.create).not.toHaveBeenCalled();
  });
});
