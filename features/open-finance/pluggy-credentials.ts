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
  webhookConfigured: boolean;
  webhookSecretLastFour: string | null;
  webhookUpdatedAt: string | null;
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
      pluggyWebhookSecretCiphertext: true,
      pluggyWebhookSecretLastFour: true,
      pluggyWebhookSecretUpdatedAt: true,
      pluggyCredentialUpdatedAt: true,
    },
  });
  return {
    configured: Boolean(preference?.pluggyClientIdCiphertext && preference.pluggyClientSecretCiphertext),
    clientIdLastFour: preference?.pluggyClientIdLastFour ?? null,
    clientSecretLastFour: preference?.pluggyClientSecretLastFour ?? null,
    webhookConfigured: Boolean(preference?.pluggyWebhookSecretCiphertext),
    webhookSecretLastFour: preference?.pluggyWebhookSecretLastFour ?? null,
    webhookUpdatedAt: preference?.pluggyWebhookSecretUpdatedAt?.toISOString() ?? null,
    updatedAt: preference?.pluggyCredentialUpdatedAt?.toISOString() ?? null,
  };
}

async function readPluggyWebhookSecret(userId: string) {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { pluggyWebhookSecretCiphertext: true },
  });
  if (!preference?.pluggyWebhookSecretCiphertext) {
    throw new Error("Configure o segredo individual do webhook da Pluggy.");
  }
  const secret = decryptCredential(preference.pluggyWebhookSecretCiphertext, {
    userId,
    type: "pluggy-webhook-secret",
  });
  return {
    value: secret.value,
    needsRotation: secret.needsRotation,
    ciphertext: preference.pluggyWebhookSecretCiphertext,
  };
}

async function rotatePluggyWebhookSecretIfCurrent(
  userId: string,
  secret: Awaited<ReturnType<typeof readPluggyWebhookSecret>>,
) {
  if (!secret.needsRotation) return;
  await prisma.userPreference.updateMany({
    where: {
      userId,
      pluggyWebhookSecretCiphertext: secret.ciphertext,
    },
    data: {
      pluggyWebhookSecretCiphertext: encryptCredential(secret.value, {
        userId,
        type: "pluggy-webhook-secret",
      }),
      pluggyWebhookSecretUpdatedAt: new Date(),
    },
  });
}

export async function requirePluggyWebhookSecret(
  userId: string,
  { rotate = true }: { rotate?: boolean } = {},
) {
  const secret = await readPluggyWebhookSecret(userId);
  if (rotate) await rotatePluggyWebhookSecretIfCurrent(userId, secret);
  return secret.value;
}

export async function rotatePluggyWebhookSecretEncryption(userId: string) {
  const secret = await readPluggyWebhookSecret(userId);
  await rotatePluggyWebhookSecretIfCurrent(userId, secret);
}

export async function storePluggyWebhookSecret(userId: string, secret: string) {
  const now = new Date();
  const data = {
    pluggyWebhookSecretCiphertext: encryptCredential(secret, {
      userId,
      type: "pluggy-webhook-secret" as const,
    }),
    pluggyWebhookSecretLastFour: secret.slice(-4),
    pluggyWebhookSecretUpdatedAt: now,
  };
  await prisma.userPreference.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  return {
    webhookSecretLastFour: data.pluggyWebhookSecretLastFour,
    webhookUpdatedAt: now.toISOString(),
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
    await prisma.userPreference.updateMany({
      where: {
        userId,
        pluggyClientIdCiphertext: preference.pluggyClientIdCiphertext,
        pluggyClientSecretCiphertext: preference.pluggyClientSecretCiphertext,
      },
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
      pluggyWebhookSecretCiphertext: null,
      pluggyWebhookSecretLastFour: null,
      pluggyWebhookSecretUpdatedAt: null,
      pluggyCredentialUpdatedAt: null,
    },
    create: { userId },
  });
}
