import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { McpContext } from "./types";

let lastCleanupAt = 0;

export async function auditMcpCall(context: McpContext, tool: string, outcome: string, startedAt: number) {
  const durationMs = Date.now() - startedAt;
  const cleanupDue = Date.now() - lastCleanupAt >= 3_600_000;
  if (cleanupDue) lastCleanupAt = Date.now();
  try {
    await prisma.$transaction([
      prisma.mcpAuditEvent.create({ data: { userId: context.userId, clientId: context.clientId, tool, outcome, durationMs } }),
      prisma.mcpOAuthGrant.updateMany({ where: { id: context.grantId, userId: context.userId, revokedAt: null }, data: { lastUsedAt: new Date() } }),
      ...(cleanupDue ? [prisma.mcpAuditEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } })] : []),
    ]);
  } catch {
    // Never log arguments, identifiers, results, or a database error payload.
    console.warn(JSON.stringify({ event: "mcp-audit-unavailable", tool }));
  }
  console.info(JSON.stringify({ event: "mcp-read", user: createHash("sha256").update(context.userId).digest("hex").slice(0, 12), tool, outcome, durationMs }));
}
