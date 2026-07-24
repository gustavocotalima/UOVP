"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/current-user";
import { assertUserOperationRateLimit } from "@/lib/operation-security";
import { validatePluggyCredentials } from "./pluggy";
import {
  clearPluggyCredentials,
  storePluggyWebhookSecret,
  storePluggyCredentials,
} from "./pluggy-credentials";

const credentialsSchema = z.object({
  clientId: z.string().trim().min(8).max(500),
  clientSecret: z.string().trim().min(8).max(1_000),
});
const webhookSecretSchema = z.string().trim().min(32).max(1_000);

const paths = [
  "/configuracoes",
  "/open-finance",
  "/contas",
  "/home",
  "/transacoes",
];

export async function savePluggyCredentialsAction(input: z.input<typeof credentialsSchema>) {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "pluggy-credential-validation",
    limit: 20,
    windowMs: 60 * 60_000,
  });
  const credentials = credentialsSchema.parse(input);
  await validatePluggyCredentials(credentials);
  const status = await storePluggyCredentials(userId, credentials);
  paths.forEach((path) => revalidatePath(path));
  return status;
}

export async function removePluggyCredentialsAction() {
  const userId = await requireUserId();
  await clearPluggyCredentials(userId);
  paths.forEach((path) => revalidatePath(path));
}

export async function savePluggyWebhookSecretAction(input: string) {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "pluggy-webhook-secret-change",
    limit: 20,
    windowMs: 60 * 60_000,
  });
  const secret = webhookSecretSchema.parse(input);
  const status = await storePluggyWebhookSecret(userId, secret);
  paths.forEach((path) => revalidatePath(path));
  return status;
}
