/**
 * Preview next eligible batch/user:
 *   pnpm exec tsx scripts/cleanup-mcp-oauth.ts [--user-id=ID]
 * Apply bounded cleanup:
 *   pnpm exec tsx scripts/cleanup-mcp-oauth.ts --apply [--user-id=ID] [--max-batches=100] [--after-user-id=ID]
 *
 * No credentials or token hashes are printed. Public client registrations are
 * preserved. Preview does not simulate cascading eligibility for later batches.
 */
import { cleanupMcpOAuthForUser } from "@/features/mcp/oauth-retention";
import { prisma } from "@/lib/prisma";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !/^--(?:after-)?user-id=.+$/.test(arg) && !/^--max-batches=\d+$/.test(arg))) {
    throw new Error("Use apenas --apply, --user-id=ID, --after-user-id=ID e/ou --max-batches=N.");
  }
  const apply = args.includes("--apply");
  const userId = args.find((arg) => arg.startsWith("--user-id="))?.slice("--user-id=".length);
  const afterUserId = args.find((arg) => arg.startsWith("--after-user-id="))?.slice("--after-user-id=".length);
  if (userId && afterUserId) throw new Error("Use --user-id ou --after-user-id, sem combiná-los.");
  const maxBatches = Number(args.find((arg) => arg.startsWith("--max-batches="))?.slice("--max-batches=".length) ?? 100);
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10_000) throw new Error("Use entre 1 e 10.000 lotes.");
  if (userId && !await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) throw new Error("Usuário não encontrado.");
  const totals = { tokens: 0, codes: 0, grants: 0, skippedUsers: 0, batches: 0 };
  let cursor = afterUserId;
  let lastCompletedUserId = afterUserId;
  while (totals.batches < maxBatches) {
    const users = await prisma.user.findMany({
      where: { mcpGrants: { some: {} }, ...(userId ? { id: userId } : cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" }, take: 100, select: { id: true },
    });
    if (!users.length) break;
    for (const user of users) {
      let more = true;
      while (more && totals.batches < maxBatches) {
        const result = await cleanupMcpOAuthForUser(user.id, { apply });
        totals.batches += 1;
        totals.tokens += result.tokens;
        totals.codes += result.codes;
        totals.grants += result.grants;
        if (result.skipped) totals.skippedUsers += 1;
        process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", userId: user.id, ...result })}\n`);
        more = apply && result.hasMore && !result.skipped;
      }
      if (!more) lastCompletedUserId = user.id;
      if (totals.batches >= maxBatches) break;
    }
    if (userId) break;
    cursor = users.at(-1)!.id;
  }
  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry-run", ...totals, batchLimitReached: totals.batches >= maxBatches,
    resumeAfterUserId: lastCompletedUserId ?? null,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Falha na manutenção OAuth."}\n`);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
