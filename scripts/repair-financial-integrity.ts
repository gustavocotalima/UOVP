/**
 * Preview: pnpm exec tsx scripts/repair-financial-integrity.ts [--user-id=ID] [--batch-size=100]
 * Apply:   pnpm exec tsx scripts/repair-financial-integrity.ts --apply [--user-id=ID]
 *
 * Dry-run is the default. No provider requests are made. Logs contain only
 * opaque record IDs, statuses and counts, never amounts, symbols or user data.
 * External holdings are diagnosed only: multiple holdings of one asset may be
 * legitimate (different institutions/products). They are never merged/deleted.
 * Apply repairs only proven BRL/NATIVE/1 reporting snapshots, using a complete
 * row compare-and-set. Concurrently modified records are skipped, never retried
 * from their stale snapshot. Run preview again to inspect skipped records.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import {
  parseFinancialIntegrityRepairOptions,
  planReportingAmountRepair,
} from "./helpers/financial-integrity-repair";

const options = parseFinancialIntegrityRepairOptions(process.argv.slice(2));
// Disable Prisma error logging as database errors may contain financial fields.
const prisma = new PrismaClient({ log: [] });
const mode = options.apply ? "apply" : "dry-run";

function report(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ mode, ...value })}\n`);
}

async function diagnoseExternalHoldings() {
  const activeExternal: Prisma.AssetHoldingWhereInput = {
    includedInTotals: true,
    supersededAt: null,
    positionSource: { in: ["PLUGGY", "BINANCE"] },
    ...(options.userId ? { asset: { portfolio: { userId: options.userId } } } : {}),
  };
  let cursor: string | undefined;
  let orphanCount = 0;
  while (true) {
    const holdings = await prisma.assetHolding.findMany({
      where: {
        ...activeExternal,
        OR: [
          { positionSource: "PLUGGY", pluggyDiagramLink: null },
          { positionSource: "BINANCE", binanceWalletAsset: null },
        ],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: options.batchSize,
      select: { id: true, positionSource: true },
    });
    if (!holdings.length) break;
    for (const holding of holdings) {
      orphanCount++;
      report({ issue: "ORPHAN_EXTERNAL_HOLDING", holdingId: holding.id, source: holding.positionSource, action: "MANUAL_REVIEW_ONLY" });
    }
    cursor = holdings.at(-1)!.id;
  }

  // Paginate assets by their immutable key; grouping is performed in PostgreSQL
  // so a large group never loads all of its holdings into process memory.
  cursor = undefined;
  let ambiguousGroups = 0;
  while (true) {
    const assets: Array<{ id: string }> = await prisma.asset.findMany({
      where: {
        ...(options.userId ? { portfolio: { userId: options.userId } } : {}),
        holdings: { some: activeExternal },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: options.batchSize,
    });
    if (!assets.length) break;
    const groups = await prisma.assetHolding.groupBy({
      by: ["assetId", "positionSource", "currency", "providerSymbol", "ticker"],
      where: { ...activeExternal, assetId: { in: assets.map((asset) => asset.id) } },
      _count: { id: true },
      having: { id: { _count: { gt: 1 } } },
    });
    for (const group of groups) {
      ambiguousGroups++;
      // Deliberately omit ticker/currency to avoid exposing portfolio contents.
      report({ issue: "AMBIGUOUS_EXTERNAL_HOLDINGS", assetId: group.assetId, source: group.positionSource, count: group._count.id, action: "MANUAL_REVIEW_ONLY" });
    }
    cursor = assets.at(-1)!.id;
  }
  return { orphanCount, ambiguousGroups };
}

async function repairReportingAmounts() {
  let cursor: string | undefined;
  const totals = { scanned: 0, repairable: 0, repaired: 0, concurrentlyChanged: 0, reviewRequired: 0 };
  while (true) {
    const transactions = await prisma.financeTransaction.findMany({
      where: {
        source: "PLUGGY",
        ...(options.userId ? { userId: options.userId } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: options.batchSize,
      select: {
        id: true, userId: true, accountId: true, amount: true, currencyCode: true,
        reportingAmountBrl: true, fxRateToBrl: true, fxRateDate: true, fxSource: true,
        date: true, updatedAt: true,
      },
    });
    if (!transactions.length) break;
    for (const transaction of transactions) {
      totals.scanned++;
      const plan = planReportingAmountRepair(transaction);
      if (plan.status === "UNCHANGED") continue;
      if (plan.status === "REVIEW_REQUIRED") {
        totals.reviewRequired++;
        report({ issue: "REPORTING_REVIEW_REQUIRED", transactionId: transaction.id, reason: plan.reason });
        continue;
      }
      totals.repairable++;
      let changed: number | undefined;
      if (options.apply) {
        const result = await prisma.financeTransaction.updateMany({
          where: {
            id: transaction.id, userId: transaction.userId, source: "PLUGGY",
            accountId: transaction.accountId, amount: transaction.amount,
            currencyCode: transaction.currencyCode, date: transaction.date,
            reportingAmountBrl: transaction.reportingAmountBrl,
            fxRateToBrl: transaction.fxRateToBrl, fxRateDate: transaction.fxRateDate,
            fxSource: transaction.fxSource, updatedAt: transaction.updatedAt,
          },
          data: { reportingAmountBrl: plan.expected },
        });
        changed = result.count;
        if (changed) totals.repaired++;
        else totals.concurrentlyChanged++;
      }
      report({ issue: "REPORTING_NATIVE_BRL_MISMATCH", transactionId: transaction.id, action: changed === undefined ? "WOULD_REPAIR" : changed ? "REPAIRED" : "SKIPPED_CONCURRENT_CHANGE" });
    }
    cursor = transactions.at(-1)!.id;
  }
  return totals;
}

async function main() {
  if (options.userId && !await prisma.user.findUnique({ where: { id: options.userId }, select: { id: true } })) {
    throw new Error("USER_NOT_FOUND");
  }
  const holdings = await diagnoseExternalHoldings();
  const transactions = await repairReportingAmounts();
  report({ issue: "SUMMARY", holdings, transactions });
}

main()
  .catch((error: unknown) => {
    // Do not emit Prisma/provider error text, parameters or connection strings.
    process.stderr.write(error instanceof Error && error.message === "USER_NOT_FOUND"
      ? "Usuário não encontrado. Nenhuma alteração foi aplicada.\n"
      : "A inspeção foi interrompida. Consulte a conectividade e o schema; nenhum dado financeiro foi registrado no erro.\n");
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
