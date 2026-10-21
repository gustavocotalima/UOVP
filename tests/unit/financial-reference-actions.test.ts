import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  findProfile: vi.fn(),
  findPreference: vi.fn(),
  updateUser: vi.fn(),
  updateProfile: vi.fn(),
  upsertPreference: vi.fn(),
  setup: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireUserId: mocks.requireUserId }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/finance/setup", () => ({ ensureFinanceSetup: mocks.setup }));
vi.mock("@/features/finance/account-investments", () => ({
  projectAccountInvestment: vi.fn(), setAccountInvestmentPreference: vi.fn(),
}));
vi.mock("@/features/finance/account-fx", () => ({
  financialFxRequired: vi.fn(), resolveCurrentFinancialFx: vi.fn(), resolveHistoricalFinancialFx: vi.fn(),
}));
vi.mock("@/features/finance/classification-service", () => ({
  classifyFinanceTransactionsForUser: vi.fn(), learnFinanceClassificationRule: vi.fn(),
}));

import { saveFinanceProfileAction } from "@/features/finance/actions";
import { saveTimeZoneAction } from "@/features/settings/actions";

describe("alterações de configuração do calendário financeiro", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireUserId.mockResolvedValue("user-a");
    mocks.queryRaw.mockResolvedValue([{ id: "user-a" }]);
    mocks.executeRaw.mockResolvedValue(3);
    mocks.findProfile.mockResolvedValue({ financialMonthStart: 1 });
    mocks.findPreference.mockResolvedValue({ timeZone: "America/Sao_Paulo" });
    mocks.transaction.mockImplementation(async (operation) => operation({
      $queryRaw: mocks.queryRaw,
      $executeRaw: mocks.executeRaw,
      user: { update: mocks.updateUser },
      financeProfile: { findUnique: mocks.findProfile, update: mocks.updateProfile },
      userPreference: { findUnique: mocks.findPreference, upsert: mocks.upsertPreference },
    }));
  });

  const profile = { name: "Nome atualizado", monthlyIncome: 5_000, financialMonthStart: 1, objectives: "Reserva" };

  it("salva nome, renda e objetivos sem recalcular referências quando o início é igual", async () => {
    await saveFinanceProfileAction(profile);

    expect(mocks.updateUser).toHaveBeenCalledWith({ where: { id: "user-a" }, data: { name: profile.name } });
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      where: { userId: "user-a" },
      data: { monthlyIncome: 5_000, financialMonthStart: 1, objectives: "Reserva" },
    });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/home");
  });

  it("bloqueia o usuário antes de ler configurações e recalcula com o fuso persistido", async () => {
    await saveFinanceProfileAction({ ...profile, financialMonthStart: 15 });

    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.findProfile.mock.invocationCallOrder[0]);
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.findPreference.mock.invocationCallOrder[0]);
    expect(mocks.updateProfile.mock.invocationCallOrder[0]).toBeLessThan(mocks.executeRaw.mock.invocationCallOrder[0]);
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.executeRaw.mock.calls[0][0].values).toContain("America/Sao_Paulo");
    expect(mocks.executeRaw.mock.calls[0][0].values).toContain(15);
  });

  it("não recalcula ao salvar o mesmo fuso", async () => {
    expect(await saveTimeZoneAction("America/Sao_Paulo")).toEqual({ timeZone: "America/Sao_Paulo" });
    expect(mocks.upsertPreference).toHaveBeenCalledOnce();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("usa o início financeiro existente ao alterar o fuso", async () => {
    mocks.findProfile.mockResolvedValue({ financialMonthStart: 20 });
    await saveTimeZoneAction("America/Noronha");

    expect(mocks.executeRaw.mock.calls[0][0].values).toContain("America/Noronha");
    expect(mocks.executeRaw.mock.calls[0][0].values).toContain(20);
    expect(mocks.upsertPreference.mock.invocationCallOrder[0]).toBeLessThan(mocks.executeRaw.mock.invocationCallOrder[0]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("trata ausência de configuração como início 1 e fuso padrão", async () => {
    mocks.findProfile.mockResolvedValue(null);
    mocks.findPreference.mockResolvedValue(null);
    await saveTimeZoneAction("America/Sao_Paulo");
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("não persiste configurações se o usuário não foi encontrado ao obter o lock", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(saveTimeZoneAction("America/Noronha")).rejects.toThrow("Usuário não encontrado.");
    expect(mocks.upsertPreference).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("propaga falha de recálculo dentro da transação e não revalida", async () => {
    mocks.executeRaw.mockRejectedValue(new Error("Falha no recálculo"));
    await expect(saveFinanceProfileAction({ ...profile, financialMonthStart: 15 }))
      .rejects.toThrow("Falha no recálculo");
    await expect(mocks.transaction.mock.results[0].value).rejects.toThrow("Falha no recálculo");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejeita um fuso não suportado antes de abrir a transação", async () => {
    await expect(saveTimeZoneAction("Not/A_Zone")).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
