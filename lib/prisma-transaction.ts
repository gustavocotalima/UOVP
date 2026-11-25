import type { PrismaPg } from "@prisma/adapter-pg";

type PgAdapter = Awaited<ReturnType<PrismaPg["connect"]>>;
type PgTransaction = Awaited<ReturnType<PgAdapter["startTransaction"]>>;

// Prisma can dispatch relation reads concurrently, even for one awaited query.
// An interactive transaction uses one checked-out pg client, unlike pool queries.
export function serializePostgresTransaction(transaction: PgTransaction): PgTransaction {
  let tail = Promise.resolve();
  let finished: Promise<void> | undefined;

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    // A rejected query still reaches its caller. Cleanup must be able to run.
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  function query<T>(operation: () => Promise<T>) {
    if (finished) return Promise.reject(new Error("PostgreSQL transaction is already closed."));
    return enqueue(operation);
  }

  function finish(operation: () => Promise<void>) {
    finished ??= enqueue(operation);
    return finished;
  }

  return {
    provider: transaction.provider,
    adapterName: transaction.adapterName,
    options: transaction.options,
    queryRaw: (statement) => query(() => transaction.queryRaw(statement)),
    executeRaw: (statement) => query(() => transaction.executeRaw(statement)),
    commit: () => finish(() => transaction.commit()),
    rollback: () => finish(() => transaction.rollback()),
  };
}
