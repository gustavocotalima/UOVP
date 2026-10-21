import { Prisma } from "@prisma/client";
import { DEFAULT_TIME_ZONE, validTimeZone } from "@/lib/calendar";
import type { UserOperationLeaseContext } from "@/lib/operation-security";

export type FinancialReferenceSettings = {
  financialMonthStart: number;
  timeZone: string;
};

export async function lockFinancialReferenceSettings(tx: Prisma.TransactionClient, userId: string) {
  // Both settings screens lock the same stable row before reading either setting.
  const users = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `);
  if (!users.length) throw new Error("Usuário não encontrado.");
}

export async function readFinancialReferenceSettings(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<FinancialReferenceSettings> {
  const profile = await tx.financeProfile.findUnique({
    where: { userId },
    select: { financialMonthStart: true },
  });
  const preference = await tx.userPreference.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  return {
    financialMonthStart: profile?.financialMonthStart ?? 1,
    timeZone: validTimeZone(preference?.timeZone ?? DEFAULT_TIME_ZONE),
  };
}

function financialReferenceCandidates(userId: string, settings: FinancialReferenceSettings) {
  const startDay = Math.max(1, Math.min(28, Math.trunc(settings.financialMonthStart)));
  const timeZone = validTimeZone(settings.timeZone);
  // Prisma's PostgreSQL DateTime column is timestamp without time zone and stores
  // UTC. Attach UTC first, then obtain the user's local calendar date. Relying on
  // the database session time zone would move transactions at month boundaries.
  return Prisma.sql`
    "localized" AS (
      SELECT "id", "date", "referenceYear", "referenceMonth",
        ("date" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone} AS "localDate"
      FROM "FinanceTransaction"
      WHERE "userId" = ${userId} AND "referenceOverridden" = false
    ),
    "calculated" AS (
      SELECT "id", "date", "referenceYear", "referenceMonth",
        EXTRACT(YEAR FROM CASE
          WHEN EXTRACT(DAY FROM "localDate") < ${startDay}
          THEN "localDate" - INTERVAL '1 month' ELSE "localDate"
        END)::INTEGER AS "nextYear",
        EXTRACT(MONTH FROM CASE
          WHEN EXTRACT(DAY FROM "localDate") < ${startDay}
          THEN "localDate" - INTERVAL '1 month' ELSE "localDate"
        END)::INTEGER AS "nextMonth"
      FROM "localized"
    ),
    "changes" AS (
      SELECT * FROM "calculated"
      WHERE "referenceYear" <> "nextYear" OR "referenceMonth" <> "nextMonth"
    )
  `;
}

/** Run within the same transaction as the setting change, after locking the user. */
export async function recalculateFinancialReferences(
  tx: Prisma.TransactionClient,
  userId: string,
  settings: FinancialReferenceSettings,
) {
  return tx.$executeRaw(Prisma.sql`
    WITH ${financialReferenceCandidates(userId, settings)}
    UPDATE "FinanceTransaction" AS "transaction"
    SET "referenceYear" = "changes"."nextYear",
        "referenceMonth" = "changes"."nextMonth",
        "updatedAt" = CURRENT_TIMESTAMP
    FROM "changes"
    WHERE "transaction"."id" = "changes"."id"
      AND "transaction"."userId" = ${userId}
      AND "transaction"."referenceOverridden" = false
  `);
}

/** Serializes profile/time-zone changes and skips recalculation for unrelated edits. */
export async function updateFinancialReferenceSettings(
  tx: Prisma.TransactionClient,
  userId: string,
  changedSettings: Partial<FinancialReferenceSettings>,
  persistSettings: () => Promise<unknown>,
) {
  await lockFinancialReferenceSettings(tx, userId);
  const previous = await readFinancialReferenceSettings(tx, userId);
  const next = { ...previous, ...changedSettings };
  await persistSettings();
  if (previous.financialMonthStart === next.financialMonthStart && previous.timeZone === next.timeZone) {
    return 0;
  }
  return recalculateFinancialReferences(tx, userId, next);
}

type FinancialReferenceWrite = (
  tx: Prisma.TransactionClient,
  settings: FinancialReferenceSettings,
) => Promise<unknown>;

/**
 * Resolve settings again inside every fenced write batch. Provider/FX requests
 * must finish before calling this helper so the user lock never spans network I/O.
 */
export async function writeFinancialReferenceBatches(
  lease: UserOperationLeaseContext,
  userId: string,
  operations: FinancialReferenceWrite[],
  batchSize = 100,
) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new RangeError("Lote financeiro inválido.");
  for (let index = 0; index < operations.length; index += batchSize) {
    const batch = operations.slice(index, index + batchSize);
    await lease.runFencedTransaction(async (tx) => {
      await lockFinancialReferenceSettings(tx, userId);
      const settings = await readFinancialReferenceSettings(tx, userId);
      await Promise.all(batch.map((operation) => operation(tx, settings)));
    });
  }
}

export type FinancialReferenceChange = {
  id: string;
  date: Date;
  referenceYear: number;
  referenceMonth: number;
  nextYear: number;
  nextMonth: number;
};

/** Read-only preview; never changes references or their updatedAt timestamps. */
export async function previewFinancialReferenceRepair(
  tx: Prisma.TransactionClient,
  userId: string,
  settings: FinancialReferenceSettings,
) {
  const rows = await tx.$queryRaw<Array<FinancialReferenceChange & { total: number }>>(Prisma.sql`
    WITH ${financialReferenceCandidates(userId, settings)}
    SELECT "id", "date", "referenceYear", "referenceMonth", "nextYear", "nextMonth",
      (COUNT(*) OVER())::INTEGER AS "total"
    FROM "changes"
    ORDER BY "id"
    LIMIT 20
  `);
  return {
    total: rows[0]?.total ?? 0,
    samples: rows.map((row) => ({
      id: row.id,
      date: row.date,
      referenceYear: row.referenceYear,
      referenceMonth: row.referenceMonth,
      nextYear: row.nextYear,
      nextMonth: row.nextMonth,
    })),
  };
}
