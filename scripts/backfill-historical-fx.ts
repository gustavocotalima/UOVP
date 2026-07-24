import { Prisma } from "@prisma/client";
import { ensureHistoricalFxRates } from "@/features/finance/fx";
import { prisma } from "@/lib/prisma";

const BATCH_SIZE = 500;

async function backfillHistoricalFx() {
  let cursor: string | undefined;
  let converted = 0;
  let pending = 0;

  while (true) {
    const transactions = await prisma.financeTransaction.findMany({
      where: {
        source: "PLUGGY",
        reportingAmountBrl: null,
        fxSource: null,
        currencyCode: { not: "BRL" },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        amount: true,
        currencyCode: true,
        date: true,
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

    await prisma.$transaction(
      transactions.flatMap((transaction) => {
        const day = transaction.date.toISOString().slice(0, 10);
        const rate = ratesByCurrency.get(transaction.currencyCode)?.get(day);
        if (!rate) {
          pending += 1;
          return [];
        }
        converted += 1;
        return [prisma.financeTransaction.updateMany({
          where: {
            id: transaction.id,
            reportingAmountBrl: null,
            fxSource: null,
          },
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
      `Backfill concluído: ${converted} convertida(s), ${pending} sem cotação disponível.\n`,
    );
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
