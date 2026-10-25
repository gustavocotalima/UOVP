import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  decryptCredential: vi.fn(),
  encryptCredential: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userPreference: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      update: mocks.update,
      upsert: mocks.upsert,
    },
  },
}));

vi.mock("@/lib/credential-cipher", () => ({
  decryptCredential: mocks.decryptCredential,
  encryptCredential: mocks.encryptCredential,
}));

import {
  requirePluggyCredentials,
  requirePluggyWebhookSecret,
  rotatePluggyWebhookSecretEncryption,
} from "@/features/open-finance/pluggy-credentials";
import { requireBrapiApiKey, requireBrapiCredentials } from "@/features/portfolio/brapi-credentials";

describe("CAS da rotação lazy de credenciais", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.decryptCredential.mockImplementation((_: string, context: { type: string }) => ({
      value: `plain-${context.type}`,
      needsRotation: true,
    }));
    mocks.encryptCredential.mockImplementation((value: string, context: { type: string }) =>
      `rotated:${context.type}:${value}`);
  });

  it("adia a rotação do segredo do webhook até a autenticação e usa o ciphertext lido", async () => {
    mocks.findUnique.mockResolvedValue({
      pluggyWebhookSecretCiphertext: "webhook-old-ciphertext",
    });

    await expect(requirePluggyWebhookSecret("user-a", { rotate: false }))
      .resolves.toBe("plain-pluggy-webhook-secret");
    expect(mocks.updateMany).not.toHaveBeenCalled();

    await rotatePluggyWebhookSecretEncryption("user-a");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "user-a",
        pluggyWebhookSecretCiphertext: "webhook-old-ciphertext",
      },
    }));
  });

  it("só recriptografa o par Pluggy se ambos os ciphertexts permanecerem iguais", async () => {
    mocks.findUnique.mockResolvedValue({
      pluggyClientIdCiphertext: "client-id-old",
      pluggyClientSecretCiphertext: "client-secret-old",
    });

    await expect(requirePluggyCredentials("user-b")).resolves.toEqual({
      clientId: "plain-pluggy-client-id",
      clientSecret: "plain-pluggy-client-secret",
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "user-b",
        pluggyClientIdCiphertext: "client-id-old",
        pluggyClientSecretCiphertext: "client-secret-old",
      },
    }));
  });

  it("só recriptografa a chave brapi se o ciphertext permanecer igual", async () => {
    mocks.findUnique.mockResolvedValue({
      brapiApiKeyCiphertext: "brapi-old",
    });

    await expect(requireBrapiApiKey("user-c")).resolves.toBe("plain-brapi");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "user-c",
        brapiApiKeyCiphertext: "brapi-old",
      },
    }));
  });

  it("carrega o plano junto com a chave sem alterá-lo na rotação", async () => {
    mocks.findUnique.mockResolvedValue({ brapiApiKeyCiphertext: "brapi-old", brapiPlan: "PRO" });

    await expect(requireBrapiCredentials("user-c")).resolves.toEqual({ apiKey: "plain-brapi", plan: "PRO" });
    expect(mocks.findUnique).toHaveBeenCalledOnce();
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-c" },
      select: { brapiApiKeyCiphertext: true, brapiPlan: true },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-c", brapiApiKeyCiphertext: "brapi-old" },
      data: { brapiApiKeyCiphertext: "rotated:brapi:plain-brapi", brapiApiKeyUpdatedAt: expect.any(Date) },
    });
  });
});
