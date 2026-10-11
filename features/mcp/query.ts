import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { McpContext } from "./types";

// Authorization/audit writes happen outside this transaction. Domain reads cannot
// provision defaults, save simulations, or silently change financial records.
export function readAnalysis<T>(_context: McpContext, read: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SET TRANSACTION READ ONLY`;
    return read(db);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000, maxWait: 5_000 });
}
