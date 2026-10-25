import { prisma } from "@/lib/prisma";
import { decryptCredential, encryptCredential } from "@/lib/credential-cipher";
import { normalizeBrapiPlan, type BrapiPlan } from "./brapi-plans";

export type BrapiCredentialStatus = {
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
  plan: BrapiPlan;
};

export async function getBrapiCredentialStatus(userId: string): Promise<BrapiCredentialStatus> {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { brapiApiKeyCiphertext: true, brapiApiKeyLastFour: true, brapiApiKeyUpdatedAt: true, brapiPlan: true },
  });
  return {
    configured: Boolean(preference?.brapiApiKeyCiphertext),
    lastFour: preference?.brapiApiKeyLastFour ?? null,
    updatedAt: preference?.brapiApiKeyUpdatedAt?.toISOString() ?? null,
    plan: normalizeBrapiPlan(preference?.brapiPlan),
  };
}

export async function requireBrapiCredentials(userId: string) {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { brapiApiKeyCiphertext: true, brapiPlan: true },
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
  return { apiKey: decrypted.value, plan: normalizeBrapiPlan(preference.brapiPlan) };
}

export async function requireBrapiApiKey(userId: string) {
  const { apiKey } = await requireBrapiCredentials(userId);
  return apiKey;
}

export async function storeBrapiApiKey(userId: string, apiKey: string, plan: BrapiPlan = "FREE") {
  const now = new Date();
  const ciphertext = encryptCredential(apiKey, { userId, type: "brapi" });
  await prisma.userPreference.upsert({
    where: { userId },
    update: {
      brapiPlan: plan,
      brapiApiKeyCiphertext: ciphertext,
      brapiApiKeyLastFour: apiKey.slice(-4),
      brapiApiKeyUpdatedAt: now,
    },
    create: {
      userId,
      brapiPlan: plan,
      brapiApiKeyCiphertext: ciphertext,
      brapiApiKeyLastFour: apiKey.slice(-4),
      brapiApiKeyUpdatedAt: now,
    },
  });
  return { lastFour: apiKey.slice(-4), updatedAt: now.toISOString(), plan };
}

export async function storeBrapiPlan(userId: string, plan: BrapiPlan) {
  await prisma.userPreference.upsert({
    where: { userId },
    update: { brapiPlan: plan },
    create: { userId, brapiPlan: plan },
  });
  return { plan };
}

export async function clearBrapiApiKey(userId: string) {
  await prisma.userPreference.upsert({
    where: { userId },
    update: { brapiApiKeyCiphertext: null, brapiApiKeyLastFour: null, brapiApiKeyUpdatedAt: null },
    create: { userId },
  });
}
