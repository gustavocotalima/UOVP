import { prisma } from "@/lib/prisma";
import { decryptCredential, encryptCredential } from "@/lib/credential-cipher";

export type BrapiCredentialStatus = {
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
};

export async function getBrapiCredentialStatus(userId: string): Promise<BrapiCredentialStatus> {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { brapiApiKeyCiphertext: true, brapiApiKeyLastFour: true, brapiApiKeyUpdatedAt: true },
  });
  return {
    configured: Boolean(preference?.brapiApiKeyCiphertext),
    lastFour: preference?.brapiApiKeyLastFour ?? null,
    updatedAt: preference?.brapiApiKeyUpdatedAt?.toISOString() ?? null,
  };
}

export async function requireBrapiApiKey(userId: string) {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { brapiApiKeyCiphertext: true },
  });
  if (!preference?.brapiApiKeyCiphertext) {
    throw new Error("Configure sua chave da brapi antes de consultar cotações.");
  }
  const decrypted = decryptCredential(preference.brapiApiKeyCiphertext, { userId, type: "brapi" });
  if (decrypted.needsRotation) {
    await prisma.userPreference.updateMany({
      where: {
        userId,
        brapiApiKeyCiphertext: preference.brapiApiKeyCiphertext,
      },
      data: {
        brapiApiKeyCiphertext: encryptCredential(decrypted.value, { userId, type: "brapi" }),
        brapiApiKeyUpdatedAt: new Date(),
      },
    });
  }
  return decrypted.value;
}

export async function storeBrapiApiKey(userId: string, apiKey: string) {
  const now = new Date();
  const ciphertext = encryptCredential(apiKey, { userId, type: "brapi" });
  await prisma.userPreference.upsert({
    where: { userId },
    update: {
      brapiApiKeyCiphertext: ciphertext,
      brapiApiKeyLastFour: apiKey.slice(-4),
      brapiApiKeyUpdatedAt: now,
    },
    create: {
      userId,
      brapiApiKeyCiphertext: ciphertext,
      brapiApiKeyLastFour: apiKey.slice(-4),
      brapiApiKeyUpdatedAt: now,
    },
  });
  return { lastFour: apiKey.slice(-4), updatedAt: now.toISOString() };
}

export async function clearBrapiApiKey(userId: string) {
  await prisma.userPreference.upsert({
    where: { userId },
    update: { brapiApiKeyCiphertext: null, brapiApiKeyLastFour: null, brapiApiKeyUpdatedAt: null },
    create: { userId },
  });
}
