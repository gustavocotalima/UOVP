import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { consumeAuthRateLimit } from "@/lib/auth-security";
import { prisma } from "@/lib/prisma";

export class OperationRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Muitas solicitações. Tente novamente em ${retryAfterSeconds} segundo(s).`);
    this.name = "OperationRateLimitError";
  }
}

export class OperationInProgressError extends Error {
  constructor() {
    super("Esta operação já está em andamento. Aguarde a conclusão antes de tentar novamente.");
    this.name = "OperationInProgressError";
  }
}

export class OperationLeaseLostError extends Error {
  constructor() {
    super("A exclusividade desta operação foi perdida antes da conclusão.");
    this.name = "OperationLeaseLostError";
  }
}

export type UserOperationLeaseContext = {
  id: string;
  userId: string;
  operation: string;
  signal: AbortSignal;
  renew(): Promise<void>;
  assertOwned(): Promise<void>;
  runFencedTransaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T>;
};

export async function assertUserOperationRateLimit({
  userId,
  operation,
  limit,
  windowMs,
}: {
  userId: string;
  operation: string;
  limit: number;
  windowMs: number;
}) {
  const result = await consumeAuthRateLimit({
    scope: `operation-${operation}`,
    identifier: userId,
    limit,
    windowMs,
    blockMs: windowMs,
  });
  if (!result.allowed) {
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1_000));
    throw new OperationRateLimitError(seconds);
  }
}

export async function withUserOperationLease<T>({
  userId,
  operation,
  leaseMs,
  action,
}: {
  userId: string;
  operation: string;
  leaseMs: number;
  action: (lease: UserOperationLeaseContext) => Promise<T>;
}) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000) {
    throw new RangeError("A duração do lease precisa ser um inteiro de pelo menos 1.000 ms.");
  }
  const id = randomUUID();
  const lockedUntil = new Date(Date.now() + leaseMs);
  const acquired = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "UserOperationLease" (
      "id", "userId", "operation", "lockedUntil", "createdAt", "updatedAt"
    )
    VALUES (
      ${id}, ${userId}, ${operation}, ${lockedUntil}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("userId", "operation") DO UPDATE
    SET
      "id" = EXCLUDED."id",
      "lockedUntil" = EXCLUDED."lockedUntil",
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "UserOperationLease"."lockedUntil" <= CURRENT_TIMESTAMP
    RETURNING "id"
  `);
  if (!acquired.length) {
    throw new OperationInProgressError();
  }

  const controller = new AbortController();
  const lostError = new OperationLeaseLostError();
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatPromise: Promise<void> | null = null;
  let renewalPromise: Promise<void> | null = null;

  const markLost = () => {
    if (!controller.signal.aborted) controller.abort(lostError);
  };
  const renew = () => {
    if (controller.signal.aborted) return Promise.reject(lostError);
    if (renewalPromise) return renewalPromise;
    const nextLockedUntil = new Date(Date.now() + leaseMs);
    const pending = prisma.$executeRaw(Prisma.sql`
      UPDATE "UserOperationLease"
      SET
        "lockedUntil" = ${nextLockedUntil},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = ${userId}
        AND "operation" = ${operation}
        AND "id" = ${id}
        AND "lockedUntil" > CURRENT_TIMESTAMP
    `).then((updated) => {
      if (updated !== 1) {
        markLost();
        throw lostError;
      }
    }).catch((error) => {
      markLost();
      throw error;
    }).finally(() => {
      renewalPromise = null;
    });
    renewalPromise = pending;
    return pending;
  };
  const assertOwned = async () => {
    if (controller.signal.aborted) throw lostError;
    const [ownership] = await prisma.$queryRaw<Array<{ owned: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "UserOperationLease"
        WHERE "userId" = ${userId}
          AND "operation" = ${operation}
          AND "id" = ${id}
          AND "lockedUntil" > CURRENT_TIMESTAMP
      ) AS "owned"
    `);
    if (!ownership?.owned) {
      markLost();
      throw lostError;
    }
  };
  const lease: UserOperationLeaseContext = {
    id,
    userId,
    operation,
    signal: controller.signal,
    renew,
    assertOwned,
    runFencedTransaction: async (transactionAction, options) => {
      if (controller.signal.aborted) throw lostError;
      return prisma.$transaction(async (tx) => {
        const owned = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "UserOperationLease"
          WHERE "userId" = ${userId}
            AND "operation" = ${operation}
            AND "id" = ${id}
            AND "lockedUntil" > CURRENT_TIMESTAMP
          FOR UPDATE
        `);
        if (!owned.length) {
          markLost();
          throw lostError;
        }
        return transactionAction(tx);
      }, {
        timeout: options?.timeout ?? 30_000,
      });
    },
  };
  const heartbeatMs = Math.max(250, Math.min(Math.floor(leaseMs / 3), 30_000));
  const scheduleHeartbeat = () => {
    if (stopped || controller.signal.aborted) return;
    heartbeatTimer = setTimeout(() => {
      heartbeatPromise = renew()
        .catch(() => undefined)
        .finally(() => {
          heartbeatPromise = null;
          scheduleHeartbeat();
        });
    }, heartbeatMs);
  };
  scheduleHeartbeat();

  try {
    const result = await action(lease);
    if (controller.signal.aborted) throw lostError;
    await assertOwned();
    return result;
  } finally {
    stopped = true;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    const pendingHeartbeat = heartbeatPromise;
    if (pendingHeartbeat) await pendingHeartbeat;
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "UserOperationLease"
      SET
        "lockedUntil" = CURRENT_TIMESTAMP,
        "lastRunAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = ${userId}
        AND "operation" = ${operation}
        AND "id" = ${id}
    `).catch(() => undefined);
  }
}
