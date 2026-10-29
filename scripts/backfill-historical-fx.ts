import { Prisma } from "@/generated/prisma/client";
import { ensureHistoricalFxRates } from "@/features/finance/fx";
import { prisma } from "@/lib/prisma";
import {
  historicalFxBackfillWhere,
  type HistoricalFxBackfillSnapshot,
} from "./helpers/historical-fx-backfill";

const BATCH_SIZE = 500;

async function backfillHistoricalFx() {
  let cursor: string | undefined;
  let converted = 0;
  let pending = 0;

  while (true) {
    const transactions: HistoricalFxBackfillSnapshot[] = await prisma.financeTransaction.findMany({
      where: {
        source: "PLUGGY",
        reportingAmountBrl: null,
        fxSource: null,
        currencyCode: { not: "BRL" },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      select: {
        id: true,
        userId: true,
        source: true,
        amount: true,
        currencyCode: true,
        date: true,
        updatedAt: true,
      },
    });
    if (!transactions.length) break;

    const ratesByCurrency = new Map<string, Awaited<ReturnType<typeof ensureHistoricalFxRates>>>();
    for (const currency of new Set(transactions.map((transaction) => transaction.currencyCode))) {
      const dates = transactions
        .filter((transaction) => transaction.currencyCode === currency)
        .map((transaction) => transaction.date);
      ratesByCurrency.set(currency, await ensureHistoricalFxRates(currency, dates));
    }

    const results = await prisma.$transaction(
      transactions.flatMap((transaction) => {
        const day = transaction.date.toISOString().slice(0, 10);
        const rate = ratesByCurrency.get(transaction.currencyCode)?.get(day);
        if (!rate) return [];
        return [prisma.financeTransaction.updateMany({
          where: historicalFxBackfillWhere(transaction),
          data: {
            reportingAmountBrl: transaction.amount.mul(rate.rateToBrl).toDecimalPlaces(2),
            fxRateToBrl: rate.rateToBrl,
            fxRateDate: rate.rateDate,
            fxSource: "YAHOO",
          },
        })];
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    const applied = results.reduce((total, result) => total + result.count, 0);
    converted += applied;
    pending += transactions.length - applied;

    cursor = transactions.at(-1)?.id;
    process.stdout.write(
      `Câmbio histórico: ${converted} convertida(s), ${pending} ainda pendente(s).\n`,
    );
  }

  return { converted, pending };
}

backfillHistoricalFx()
  .then(({ converted, pending }) => {
    process.stdout.write(
      `Backfill concluído: ${converted} convertida(s), ${pending} sem cotação ou alterada(s) concorrentemente.\n`,
    );
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
