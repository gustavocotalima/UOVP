import { prisma } from "@/lib/prisma";
import { decryptCredential, encryptCredential } from "@/lib/credential-cipher";

export type PluggyCredentials = {
  clientId: string;
  clientSecret: string;
};

export type PluggyCredentialStatus = {
  configured: boolean;
  clientIdLastFour: string | null;
  clientSecretLastFour: string | null;
  updatedAt: string | null;
};

export async function getPluggyCredentialStatus(userId: string): Promise<PluggyCredentialStatus> {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      pluggyClientIdCiphertext: true,
      pluggyClientIdLastFour: true,
      pluggyClientSecretCiphertext: true,
      pluggyClientSecretLastFour: true,
      pluggyCredentialUpdatedAt: true,
    },
  });
  return {
    configured: Boolean(preference?.pluggyClientIdCiphertext && preference.pluggyClientSecretCiphertext),
    clientIdLastFour: preference?.pluggyClientIdLastFour ?? null,
    clientSecretLastFour: preference?.pluggyClientSecretLastFour ?? null,
    updatedAt: preference?.pluggyCredentialUpdatedAt?.toISOString() ?? null,
  };
}

export async function requirePluggyCredentials(userId: string): Promise<PluggyCredentials> {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      pluggyClientIdCiphertext: true,
      pluggyClientSecretCiphertext: true,
    },
  });
  if (!preference?.pluggyClientIdCiphertext || !preference.pluggyClientSecretCiphertext) {
    throw new Error("Configure suas credenciais da Pluggy em Configurações.");
  }

  const clientId = decryptCredential(preference.pluggyClientIdCiphertext, {
    userId,
    type: "pluggy-client-id",
  });
  const clientSecret = decryptCredential(preference.pluggyClientSecretCiphertext, {
    userId,
    type: "pluggy-client-secret",
  });

  if (clientId.needsRotation || clientSecret.needsRotation) {
    await prisma.userPreference.update({
      where: { userId },
      data: {
        pluggyClientIdCiphertext: encryptCredential(clientId.value, {
          userId,
          type: "pluggy-client-id",
        }),
        pluggyClientSecretCiphertext: encryptCredential(clientSecret.value, {
          userId,
          type: "pluggy-client-secret",
        }),
        pluggyCredentialUpdatedAt: new Date(),
      },
    });
  }

  return { clientId: clientId.value, clientSecret: clientSecret.value };
}

export async function storePluggyCredentials(userId: string, credentials: PluggyCredentials) {
  const now = new Date();
  const data = {
    pluggyClientIdCiphertext: encryptCredential(credentials.clientId, {
      userId,
      type: "pluggy-client-id" as const,
    }),
    pluggyClientIdLastFour: credentials.clientId.slice(-4),
    pluggyClientSecretCiphertext: encryptCredential(credentials.clientSecret, {
      userId,
      type: "pluggy-client-secret" as const,
    }),
    pluggyClientSecretLastFour: credentials.clientSecret.slice(-4),
    pluggyCredentialUpdatedAt: now,
  };
  await prisma.userPreference.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  return {
    clientIdLastFour: data.pluggyClientIdLastFour,
    clientSecretLastFour: data.pluggyClientSecretLastFour,
    updatedAt: now.toISOString(),
  };
}

export async function clearPluggyCredentials(userId: string) {
  await prisma.userPreference.upsert({
    where: { userId },
    update: {
      pluggyClientIdCiphertext: null,
      pluggyClientIdLastFour: null,
      pluggyClientSecretCiphertext: null,
      pluggyClientSecretLastFour: null,
      pluggyCredentialUpdatedAt: null,
    },
    create: { userId },
  });
}
