/**
 * Preview: pnpm exec tsx scripts/repair-purchase-summaries.ts [--user-id=ID]
 * Apply:   pnpm exec tsx scripts/repair-purchase-summaries.ts --apply [--user-id=ID]
 *
 * Requires the purchase-summary migration. Preview never writes. Repair locks
 * each parent before reading its committed movements; concurrent trigger deltas
 * then run after the repair, without losing inserts, changes or deletions.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type StoredSummary = {
  id: string;
  version: number;
  quantity: Prisma.Decimal;
  cost: Prisma.Decimal;
  expectedQuantity: Prisma.Decimal;
  expectedCost: Prisma.Decimal;
};

async function readSummary(tx: Pick<Prisma.TransactionClient, "$queryRaw">, investmentId: string) {
  const rows = await tx.$queryRaw<StoredSummary[]>(Prisma.sql`
    SELECT investment."id", investment."purchaseSummaryVersion" AS version,
           investment."purchaseQuantityTotal" AS quantity,
           investment."purchaseCostTotal" AS cost,
           SUM(entry.purchase_quantity) AS "expectedQuantity",
           SUM(entry.purchase_cost) AS "expectedCost"
    FROM "PluggyInvestment" investment
    LEFT JOIN "PluggyInvestmentTransaction" movement
      ON movement."pluggyInvestmentDbId" = investment."id"
    CROSS JOIN LATERAL uovp_purchase_summary_entry(
      movement."type", movement."quantity", movement."value", movement."amount", movement."netAmount"
    ) entry
    WHERE investment."id" = ${investmentId}
    GROUP BY investment."id"
  `);
  return rows[0];
}

async function repairPurchaseSummaries() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !/^--user-id=.+$/.test(arg))) {
    throw new Error("Use apenas --apply e/ou --user-id=ID. Sem --apply, nenhuma alteração é gravada.");
  }
  const apply = args.includes("--apply");
  const userId = args.find((arg) => arg.startsWith("--user-id="))?.slice("--user-id=".length);
  if (userId && !await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) {
    throw new Error("Usuário não encontrado.");
  }
  let cursor: string | undefined;
  let scanned = 0;
  let changes = 0;
  while (true) {
    const investments = await prisma.pluggyInvestment.findMany({
      where: userId ? { item: { userId } } : {},
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    if (!investments.length) break;
    for (const investment of investments) {
      const result = await prisma.$transaction(async (tx) => {
        if (apply) {
          // Read the aggregates in a separate statement AFTER acquiring the lock.
          // This matters under READ COMMITTED when a concurrent writer committed
          // while we waited for the parent lock.
          await tx.$queryRaw(Prisma.sql`
            SELECT "id" FROM "PluggyInvestment"
            WHERE "id" = ${investment.id} FOR NO KEY UPDATE
          `);
        }
        const summary = await readSummary(tx, investment.id);
        if (!summary || (summary.version === 1
          && summary.quantity.eq(summary.expectedQuantity)
          && summary.cost.eq(summary.expectedCost))) return null;
        if (apply) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "PluggyInvestment"
            SET "purchaseQuantityTotal" = ${summary.expectedQuantity},
                "purchaseCostTotal" = ${summary.expectedCost},
                "purchaseSummaryVersion" = 1
            WHERE "id" = ${investment.id}
          `);
        }
        return {
          investmentId: investment.id,
          previousVersion: summary.version,
          previousQuantity: summary.quantity.toString(),
          previousCost: summary.cost.toString(),
          expectedQuantity: summary.expectedQuantity.toString(),
          expectedCost: summary.expectedCost.toString(),
        };
      });
      scanned++;
      if (result) {
        changes++;
        process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result })}\n`);
      }
    }
    cursor = investments.at(-1)?.id;
  }
  process.stdout.write(`${apply ? "Reparo aplicado" : "Simulação sem gravações"}: ${changes} resumo(s) divergente(s) em ${scanned} investimento(s).\n`);
}

repairPurchaseSummaries()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
