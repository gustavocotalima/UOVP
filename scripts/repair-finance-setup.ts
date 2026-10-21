/**
 * Preview: pnpm exec tsx scripts/repair-finance-setup.ts [--user-id=ID]
 * Apply:   pnpm exec tsx scripts/repair-finance-setup.ts --apply [--user-id=ID]
 *
 * Preview is the default. Missing records alone are inserted; customized settings
 * are retained. A name already used by another system key is reported for review.
 */
import { repairFinanceSetup } from "@/features/finance/setup";
import { prisma } from "@/lib/prisma";

async function repairLegacyFinanceSetup() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !/^--user-id=.+$/.test(arg))) {
    throw new Error("Use apenas --apply e/ou --user-id=ID. Sem --apply, nenhuma alteração é gravada.");
  }
  const apply = args.includes("--apply");
  const userId = args.find((arg) => arg.startsWith("--user-id="))?.slice("--user-id=".length);
  let cursor: string | undefined;
  let changes = 0;
  let conflicts = 0;
  let usersFound = 0;

  while (true) {
    const users = await prisma.user.findMany({
      where: userId ? { id: userId } : {},
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (!users.length) break;
    usersFound += users.length;
    for (const user of users) {
      const plan = await prisma.$transaction((tx) => repairFinanceSetup(tx, user.id, { apply }));
      const count = Number(plan.createProfile) + plan.createGoals.length
        + plan.createTags.length + plan.restoreTagKeys.length;
      changes += count;
      conflicts += plan.conflicts.length;
      if (count || plan.conflicts.length) {
        process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", userId: user.id, ...plan })}\n`);
      }
    }
    cursor = users.at(-1)?.id;
  }
  if (userId && !usersFound) throw new Error("Usuário não encontrado.");
  process.stdout.write(`${apply ? "Reparo aplicado" : "Simulação sem gravações"}: ${changes} registro(s); ${conflicts} conflito(s) preservado(s).\n`);
  if (conflicts) process.exitCode = 2;
}

repairLegacyFinanceSetup()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
