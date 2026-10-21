/**
 * Preview: pnpm exec tsx scripts/repair-financial-references.ts [--user-id=ID]
 * Apply:   pnpm exec tsx scripts/repair-financial-references.ts --apply [--user-id=ID]
 *
 * Preview is the default. Output contains counts and up to 20 changed references
 * per user, never transaction descriptions or amounts. Applying is idempotent.
 */
import {
  lockFinancialReferenceSettings,
  previewFinancialReferenceRepair,
  readFinancialReferenceSettings,
  recalculateFinancialReferences,
} from "@/features/finance/financial-reference";
import { prisma } from "@/lib/prisma";

async function repairFinancialReferences() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !/^--user-id=.+$/.test(arg))) {
    throw new Error("Use apenas --apply e/ou --user-id=ID. Sem --apply, nenhuma alteração é gravada.");
  }
  const apply = args.includes("--apply");
  const userId = args.find((arg) => arg.startsWith("--user-id="))?.slice("--user-id=".length);
  let cursor: string | undefined;
  let total = 0;

  while (true) {
    const users = await prisma.user.findMany({
      where: userId ? { id: userId } : {},
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (!users.length) break;
    for (const user of users) {
      const result = await prisma.$transaction(async (tx) => {
        if (apply) await lockFinancialReferenceSettings(tx, user.id);
        const settings = await readFinancialReferenceSettings(tx, user.id);
        const preview = await previewFinancialReferenceRepair(tx, user.id, settings);
        const updated = apply
          ? await recalculateFinancialReferences(tx, user.id, settings)
          : 0;
        return { userId: user.id, ...settings, ...preview, updated };
      });
      total += apply ? result.updated : result.total;
      if (result.total) process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result })}\n`);
    }
    cursor = users.at(-1)?.id;
  }
  process.stdout.write(`${apply ? "Reparo aplicado" : "Simulação sem gravações"}: ${total} referência(s).\n`);
}

repairFinancialReferences()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
