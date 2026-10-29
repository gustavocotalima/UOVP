import "server-only";

import { Prisma } from "@/generated/prisma/client";

type SyncRequestTransaction = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

export type PluggySyncRequestState = {
  syncRequestedVersion: number;
  syncProcessedVersion: number;
  syncPending: boolean;
};

/** Call in the same transaction that marks the deduplicated webhook processed. */
export async function requestPluggySync(
  tx: SyncRequestTransaction,
  input: { userId: string; pluggyItemId: string },
): Promise<number> {
  return tx.$executeRaw(Prisma.sql`
    UPDATE "PluggyItem"
    SET "syncRequestedVersion" = "syncRequestedVersion" + 1,
        "syncPending" = TRUE,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = ${input.userId}
      AND "pluggyItemId" = ${input.pluggyItemId}
  `);
}

/**
 * Acknowledge only after every phase, including diagram reconciliation, succeeds.
 * Both counters are read by the UPDATE while holding the row lock: a webhook
 * arriving during HTTP or while this statement waits cannot be cleared by an
 * older snapshot. Partial snapshots preserve their previous processed version.
 */
export async function acknowledgePluggySync(
  tx: SyncRequestTransaction,
  input: { itemId: string; userId: string; requestedVersion: number; partial: boolean },
): Promise<PluggySyncRequestState | null> {
  if (!Number.isSafeInteger(input.requestedVersion) || input.requestedVersion < 0) {
    throw new Error("Versão de sincronização inválida.");
  }
  const processedVersion = input.partial
    ? Prisma.sql`"syncProcessedVersion"`
    : Prisma.sql`GREATEST("syncProcessedVersion", LEAST("syncRequestedVersion", ${input.requestedVersion}))`;
  const rows = await tx.$queryRaw<PluggySyncRequestState[]>(Prisma.sql`
    UPDATE "PluggyItem"
    SET "syncProcessedVersion" = ${processedVersion},
        "syncPending" = ${input.partial} OR "syncRequestedVersion" > ${processedVersion},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.itemId} AND "userId" = ${input.userId}
    RETURNING "syncRequestedVersion", "syncProcessedVersion", "syncPending"
  `);
  return rows[0] ?? null;
}
