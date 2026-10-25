import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  encryptCredential: vi.fn(),
  decryptCredential: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { userPreference: {
  findUnique: mocks.findUnique,
  upsert: mocks.upsert,
  updateMany: mocks.updateMany,
} } }));
vi.mock("@/lib/credential-cipher", () => ({
  encryptCredential: mocks.encryptCredential,
  decryptCredential: mocks.decryptCredential,
}));

import {
  clearBrapiApiKey,
  getBrapiCredentialStatus,
  requireBrapiApiKey,
  requireBrapiCredentials,
  storeBrapiApiKey,
  storeBrapiPlan,
} from "@/features/portfolio/brapi-credentials";

describe("credenciais e plano da brapi por usuário", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({});
    mocks.encryptCredential.mockReturnValue("encrypted-key");
    mocks.decryptCredential.mockReturnValue({ value: "individual-key", needsRotation: false });
  });

  it("usa o gratuito quando ainda não há preferência", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(getBrapiCredentialStatus("user-a")).resolves.toEqual({
      configured: false, lastFour: null, updatedAt: null, plan: "FREE",
    });
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-a" } }));
  });

  it("retorna status sem expor a chave e mantém a escolha de plano", async () => {
    const updatedAt = new Date("2026-10-25T12:00:00Z");
    mocks.findUnique.mockResolvedValue({
      brapiApiKeyCiphertext: "encrypted-key", brapiApiKeyLastFour: "-key", brapiApiKeyUpdatedAt: updatedAt, brapiPlan: "STARTUP",
    });
    await expect(getBrapiCredentialStatus("user-a")).resolves.toEqual({
      configured: true, lastFour: "-key", updatedAt: updatedAt.toISOString(), plan: "STARTUP",
    });
    expect(mocks.decryptCredential).not.toHaveBeenCalled();
  });

  it("exige chave individual mesmo quando um plano já foi escolhido", async () => {
    mocks.findUnique.mockResolvedValue({ brapiPlan: "PRO", brapiApiKeyCiphertext: null });
    await expect(requireBrapiCredentials("user-a")).rejects.toThrow("Configure sua chave");
    expect(mocks.decryptCredential).not.toHaveBeenCalled();
  });

  it("carrega chave e plano na mesma leitura isolada pelo usuário", async () => {
    mocks.findUnique.mockResolvedValue({ brapiApiKeyCiphertext: "encrypted-key", brapiPlan: "PRO" });
    await expect(requireBrapiCredentials("user-b")).resolves.toEqual({ apiKey: "individual-key", plan: "PRO" });
    expect(mocks.findUnique).toHaveBeenCalledOnce();
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-b" }, select: { brapiApiKeyCiphertext: true, brapiPlan: true },
    });
    expect(mocks.decryptCredential).toHaveBeenCalledWith("encrypted-key", { userId: "user-b", type: "brapi" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("mantém o wrapper legado que retorna somente a chave", async () => {
    mocks.findUnique.mockResolvedValue({ brapiApiKeyCiphertext: "encrypted-key", brapiPlan: "STARTUP" });
    await expect(requireBrapiApiKey("user-a")).resolves.toBe("individual-key");
  });

  it("grava chave criptografada e plano juntos sem afetar outro usuário", async () => {
    const status = await storeBrapiApiKey("user-a", "individual-key", "STARTUP");
    expect(status).toEqual({ lastFour: "-key", updatedAt: expect.any(String), plan: "STARTUP" });
    expect(mocks.encryptCredential).toHaveBeenCalledWith("individual-key", { userId: "user-a", type: "brapi" });
    const fields = {
      brapiPlan: "STARTUP", brapiApiKeyCiphertext: "encrypted-key", brapiApiKeyLastFour: "-key", brapiApiKeyUpdatedAt: expect.any(Date),
    };
    expect(mocks.upsert).toHaveBeenCalledWith({ where: { userId: "user-a" }, update: fields, create: { userId: "user-a", ...fields } });
  });

  it("usa o gratuito ao gravar uma chave sem informar plano", async () => {
    await expect(storeBrapiApiKey("user-a", "individual-key")).resolves.toEqual(expect.objectContaining({ plan: "FREE" }));
    expect(mocks.upsert.mock.calls[0][0].update.brapiPlan).toBe("FREE");
  });

  it("altera somente o plano, sem tocar na chave ou na data de validação", async () => {
    await expect(storeBrapiPlan("user-a", "PRO")).resolves.toEqual({ plan: "PRO" });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId: "user-a" }, update: { brapiPlan: "PRO" }, create: { userId: "user-a", brapiPlan: "PRO" },
    });
    expect(mocks.encryptCredential).not.toHaveBeenCalled();
  });

  it("preserva o plano ao remover a chave", async () => {
    await clearBrapiApiKey("user-a");
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId: "user-a" },
      update: { brapiApiKeyCiphertext: null, brapiApiKeyLastFour: null, brapiApiKeyUpdatedAt: null },
      create: { userId: "user-a" },
    });
  });
});
