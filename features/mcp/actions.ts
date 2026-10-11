"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserId } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { isSameOriginRequest } from "@/lib/request-security";
import { consumeAuthRateLimit } from "@/lib/auth-security";
import { mcpConfigured, mcpOrigin, validateRedirectUri } from "./config";
import { createMcpAuthorization } from "./oauth";
import { getMcpSettings } from "./settings";
import { MCP_SCOPES } from "./types";

async function settingsUser() {
  const userId = await requireUserId();
  if (!isSameOriginRequest(new Request(`${mcpOrigin()}/api/mcp/settings`, { headers: await headers() }))) throw new Error("Solicitação inválida.");
  const limit = await consumeAuthRateLimit({ scope: "mcp-settings", identifier: userId, limit: 30, windowMs: 60_000, blockMs: 60_000 });
  if (!limit.allowed) throw new Error("Muitas solicitações. Aguarde um minuto.");
  return userId;
}

export async function setMcpEnabledAction(enabled: boolean) {
  const userId = await settingsUser();
  z.boolean().parse(enabled);
  if (enabled && !mcpConfigured()) throw new Error("O administrador precisa configurar a chave independente do MCP.");
  await prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-user:${userId}`}))`;
    await db.user.update({ where: { id: userId }, data: { mcpEnabled: enabled } });
    if (!enabled) await db.mcpOAuthGrant.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  revalidatePath("/configuracoes"); return getMcpSettings(userId);
}
export async function revokeMcpGrantAction(grantId: string) {
  const userId = await settingsUser(); z.string().min(1).max(100).parse(grantId);
  await prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-user:${userId}`}))`;
    await db.mcpOAuthGrant.updateMany({ where: { id: grantId, userId }, data: { revokedAt: new Date() } });
  });
  revalidatePath("/configuracoes"); return getMcpSettings(userId);
}
export async function revokeAllMcpGrantsAction() {
  const userId = await settingsUser();
  await prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-user:${userId}`}))`;
    await db.mcpOAuthGrant.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  revalidatePath("/configuracoes"); return getMcpSettings(userId);
}
export async function registerMcpClientAction(input: { name: string; redirectUris: string[] }) {
  const userId = await settingsUser();
  const data = z.object({ name: z.string().trim().min(2).max(100), redirectUris: z.array(z.string().min(1).max(2048)).min(1).max(10) }).strict().parse(input);
  const redirectUris = [...new Set(data.redirectUris.map(validateRedirectUri))];
  const client = await prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mcp-user:${userId}`}))`;
    if (await db.mcpOAuthClient.count({ where: { ownerId: userId } }) >= 50) throw new Error("Limite de clientes atingido.");
    return db.mcpOAuthClient.create({ data: { id: randomUUID(), name: data.name, redirectUris, ownerId: userId } });
  });
  revalidatePath("/configuracoes"); return { clientId: client.id, settings: await getMcpSettings(userId) };
}
export async function authorizeMcpClientAction(input: { request: Record<string, string>; approvedScopes: typeof MCP_SCOPES[number][]; approved: boolean }) {
  const userId = await settingsUser();
  const parsed = z.object({ request: z.record(z.string().max(50), z.string().max(2048)), approvedScopes: z.array(z.enum(MCP_SCOPES)).max(5), approved: z.boolean() }).strict().parse(input);
  return createMcpAuthorization(userId, parsed.request, parsed.approvedScopes, parsed.approved);
}
