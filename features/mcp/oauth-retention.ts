import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const MCP_OAUTH_RETENTION_MS = 30 * 86_400_000;
export const MCP_OAUTH_CLEANUP_BATCH_SIZE = 100;

type CleanupOptions = { now?: Date; batchSize?: number; apply?: boolean };

/**
 * Only take the user lock: exchanges take token -> user, so taking a token lock
 * here would invert their order. Every issuance/rotation/revocation writer uses
 * the same user lock. Try-locking keeps maintenance off the authorization path.
 *
 * Revoked ancestors remain evidence until the entire refresh family has passed
 * its last natural credential deadline/revocation plus the retention window.
 */
export async function cleanupMcpOAuthBatch(
  tx: Prisma.TransactionClient,
  userId: string,
  options: CleanupOptions = {},
) {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? MCP_OAUTH_CLEANUP_BATCH_SIZE;
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError("Use uma data válida e lotes entre 1 e 500 registros.");
  }
  const cutoff = new Date(now.getTime() - MCP_OAUTH_RETENTION_MS);
  const apply = options.apply ?? true;
  const [lock] = await tx.$queryRaw<Array<{ owned: boolean }>>(Prisma.sql`
    SELECT pg_try_advisory_xact_lock(hashtext(${`mcp-user:${userId}`})) AS "owned"
  `);
  if (!lock?.owned) return { skipped: true, tokens: 0, codes: 0, grants: 0, hasMore: false };

  const tokens = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT token."id"
    FROM "McpOAuthToken" token
    INNER JOIN "McpOAuthGrant" grant_record ON grant_record."id" = token."grantId"
    WHERE grant_record."userId" = ${userId}
      AND token."accessExpiresAt" < ${cutoff}
      AND (token."refreshExpiresAt" IS NULL OR token."refreshExpiresAt" < ${cutoff})
      AND (token."revokedAt" IS NULL OR token."revokedAt" < ${cutoff})
      AND NOT EXISTS (
        SELECT 1 FROM "McpOAuthToken" family
        WHERE family."grantId" = token."grantId" AND family."familyId" = token."familyId"
          AND (family."accessExpiresAt" >= ${cutoff}
            OR family."refreshExpiresAt" >= ${cutoff}
            OR family."revokedAt" >= ${cutoff})
      )
    ORDER BY token."accessExpiresAt", token."id"
    LIMIT ${batchSize}
  `);
  if (apply && tokens.length) {
    await tx.mcpOAuthToken.deleteMany({ where: { id: { in: tokens.map((token) => token.id) }, grant: { userId } } });
  }

  // Never let ON DELETE SET NULL detach a live descendant from its consumed
  // code: code replay must still revoke every token issued from that code.
  const codes = await tx.mcpOAuthCode.findMany({
    where: {
      grant: { userId }, expiresAt: { lt: cutoff },
      OR: [{ consumedAt: null }, { consumedAt: { lt: cutoff } }], tokens: { none: {} },
    },
    select: { codeHash: true }, orderBy: [{ expiresAt: "asc" }, { codeHash: "asc" }], take: batchSize,
  });
  if (apply && codes.length) {
    await tx.mcpOAuthCode.deleteMany({
      where: { codeHash: { in: codes.map((code) => code.codeHash) }, grant: { userId }, tokens: { none: {} } },
    });
  }
  const grants = await tx.mcpOAuthGrant.findMany({
    where: {
      userId, createdAt: { lt: cutoff },
      AND: [
        { OR: [{ revokedAt: null }, { revokedAt: { lt: cutoff } }] },
        { OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }] },
      ],
      codes: { none: {} }, tokens: { none: {} },
    },
    select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: batchSize,
  });
  if (apply && grants.length) {
    await tx.mcpOAuthGrant.deleteMany({
      where: { id: { in: grants.map((grant) => grant.id) }, userId, codes: { none: {} }, tokens: { none: {} } },
    });
  }
  return {
    skipped: false, tokens: tokens.length, codes: codes.length, grants: grants.length,
    hasMore: [tokens.length, codes.length, grants.length].some((count) => count === batchSize),
  };
}

export async function cleanupMcpOAuthForUser(userId: string, options: CleanupOptions = {}) {
  return prisma.$transaction((tx) => cleanupMcpOAuthBatch(tx, userId, options), { timeout: 5_000, maxWait: 1_000 });
}

/** Issuance has already committed; optional maintenance cannot roll it back. */
export async function opportunisticMcpOAuthCleanup(userId: string) {
  try { await cleanupMcpOAuthForUser(userId); }
  catch { console.warn(JSON.stringify({ event: "mcp-oauth-cleanup-unavailable" })); }
}
