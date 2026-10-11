import { prisma } from "@/lib/prisma";
import { mcpConfigured, mcpResource } from "./config";
import { MCP_SCOPES, type McpScope, type McpSettingsDto } from "./types";

export async function getMcpSettings(userId: string): Promise<McpSettingsDto> {
  const [user, grants, clients] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { mcpEnabled: true } }),
    prisma.mcpOAuthGrant.findMany({ where: { userId, revokedAt: null }, select: { id: true, scopes: true, createdAt: true, lastUsedAt: true, client: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.mcpOAuthClient.findMany({ where: { ownerId: userId }, select: { id: true, name: true, redirectUris: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const configured = mcpConfigured();
  return { enabled: user?.mcpEnabled ?? false, configured, endpoint: configured ? mcpResource() : null,
    grants: grants.map((grant) => ({ id: grant.id, clientName: grant.client.name, scopes: grant.scopes.filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope)), createdAt: grant.createdAt.toISOString(), lastUsedAt: grant.lastUsedAt?.toISOString() ?? null })), clients };
}
