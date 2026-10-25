import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrapiPlan } from "@/features/portfolio/brapi-plans";

const mocks = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  assertUserOperationRateLimit: vi.fn(),
  fetchBrapiQuotes: vi.fn(),
  storeBrapiApiKey: vi.fn(),
  storeBrapiPlan: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ requireUserId: mocks.requireUserId }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/operation-security", () => ({
  assertUserOperationRateLimit: mocks.assertUserOperationRateLimit,
  withUserOperationLease: vi.fn(),
}));
vi.mock("@/features/portfolio/data", () => ({ ensurePortfolio: vi.fn(), getPortfolioData: vi.fn() }));
vi.mock("@/features/portfolio/brapi", () => ({
  fetchBrapiQuotes: mocks.fetchBrapiQuotes,
  fetchAvailableBrapiQuotes: vi.fn(),
  normalizeBrapiSymbol: (value: string) => value.trim().toUpperCase(),
  readCachedBrapiQuotes: vi.fn(),
  searchBrapiEtfTickers: vi.fn(),
  searchBrapiTickers: vi.fn(),
}));
vi.mock("@/features/portfolio/brapi-credentials", () => ({
  storeBrapiApiKey: mocks.storeBrapiApiKey,
  storeBrapiPlan: mocks.storeBrapiPlan,
  clearBrapiApiKey: vi.fn(),
  requireBrapiApiKey: vi.fn(),
  requireBrapiCredentials: vi.fn(),
}));

import { saveBrapiApiKeyAction, saveBrapiPlanAction } from "@/features/portfolio/actions";

describe("configuração do plano brapi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserId.mockResolvedValue("authenticated-user");
    mocks.assertUserOperationRateLimit.mockResolvedValue(undefined);
    mocks.fetchBrapiQuotes.mockResolvedValue([]);
    mocks.storeBrapiApiKey.mockImplementation(async (_userId, _apiKey, plan) => ({
      lastFour: "-key", updatedAt: "2026-10-25T12:00:00Z", plan,
    }));
    mocks.storeBrapiPlan.mockImplementation(async (_userId, plan) => ({ plan }));
  });

  it.each(["FREE", "STARTUP", "PRO"] as const)("persiste %s para o usuário autenticado sem consultar o provedor", async (plan) => {
    await expect(saveBrapiPlanAction(plan)).resolves.toEqual({ plan });
    expect(mocks.storeBrapiPlan).toHaveBeenCalledWith("authenticated-user", plan);
    expect(mocks.fetchBrapiQuotes).not.toHaveBeenCalled();
    expect(mocks.storeBrapiApiKey).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/configuracoes");
  });

  it.each(["ENTERPRISE", "free", "", null, { plan: "PRO" }])("rejeita plano inválido %j no servidor", async (plan) => {
    await expect(saveBrapiPlanAction(plan as BrapiPlan)).rejects.toThrow();
    expect(mocks.storeBrapiPlan).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("exige autenticação antes de alterar o plano", async () => {
    mocks.requireUserId.mockRejectedValue(new Error("Unauthorized"));
    await expect(saveBrapiPlanAction("PRO")).rejects.toThrow("Unauthorized");
    expect(mocks.storeBrapiPlan).not.toHaveBeenCalled();
  });

  it("valida a chave com um único ticker e o plano escolhido antes de gravar", async () => {
    await expect(saveBrapiApiKeyAction(" Bearer individual-key ", "PRO")).resolves.toEqual({
      lastFour: "-key", updatedAt: "2026-10-25T12:00:00Z", plan: "PRO",
    });
    expect(mocks.fetchBrapiQuotes).toHaveBeenCalledWith({ apiKey: "individual-key", plan: "PRO", tickers: ["WEGE3"] });
    expect(mocks.storeBrapiApiKey).toHaveBeenCalledWith("authenticated-user", "individual-key", "PRO");
    expect(mocks.fetchBrapiQuotes.mock.invocationCallOrder[0]).toBeLessThan(mocks.storeBrapiApiKey.mock.invocationCallOrder[0]);
    expect(mocks.assertUserOperationRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "authenticated-user", operation: "brapi-credential-validation",
    }));
  });

  it("mantém o gratuito para clientes antigos que omitem plano", async () => {
    await saveBrapiApiKeyAction("individual-key");
    expect(mocks.storeBrapiApiKey).toHaveBeenCalledWith("authenticated-user", "individual-key", "FREE");
  });

  it("não persiste chave nem plano quando a validação da brapi falha", async () => {
    mocks.fetchBrapiQuotes.mockRejectedValue(new Error("Invalid token"));
    await expect(saveBrapiApiKeyAction("individual-key", "STARTUP")).rejects.toThrow("Invalid token");
    expect(mocks.storeBrapiApiKey).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejeita o plano inválido também ao salvar a chave", async () => {
    await expect(saveBrapiApiKeyAction("individual-key", "ENTERPRISE" as BrapiPlan)).rejects.toThrow();
    expect(mocks.fetchBrapiQuotes).not.toHaveBeenCalled();
    expect(mocks.storeBrapiApiKey).not.toHaveBeenCalled();
  });
});
