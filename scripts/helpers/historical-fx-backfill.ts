import type { FinanceTransaction, Prisma } from "@/generated/prisma/client";

export type HistoricalFxBackfillSnapshot = Pick<FinanceTransaction,
  "id" | "userId" | "source" | "amount" | "date" | "currencyCode" | "updatedAt"
>;

/** A provider/user edit during the HTTP lookup must invalidate the snapshot. */
export function historicalFxBackfillWhere(
  snapshot: HistoricalFxBackfillSnapshot,
): Prisma.FinanceTransactionWhereInput {
  return {
    id: snapshot.id,
    userId: snapshot.userId,
    source: snapshot.source,
    amount: snapshot.amount,
    date: snapshot.date,
    currencyCode: snapshot.currencyCode,
    updatedAt: snapshot.updatedAt,
    reportingAmountBrl: null,
    fxSource: null,
  };
}
