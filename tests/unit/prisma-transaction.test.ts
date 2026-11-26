import { describe, expect, it, vi } from "vitest";
import { serializePostgresTransaction } from "@/lib/prisma-transaction";

const statement = { sql: "SELECT 1", args: [], argTypes: [] };
const rows = { columnNames: [], columnTypes: [], rows: [] };

function setup() {
  const underlying = {
    provider: "postgres" as const,
    adapterName: "test",
    options: { usePhantomQuery: false },
    queryRaw: vi.fn(async () => rows),
    executeRaw: vi.fn(async () => 1),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
  };
  return { underlying, transaction: serializePostgresTransaction(underlying) };
}

describe("Prisma PostgreSQL transaction queue", () => {
  it("serializes I/O and release on one client without blocking separate transactions", async () => {
    const { underlying, transaction } = setup();
    const other = setup();
    let releaseRead!: () => void;
    underlying.queryRaw.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseRead = resolve; });
      return rows;
    });

    const pendingRead = transaction.queryRaw(statement);
    const pendingWrite = transaction.executeRaw(statement);
    const pendingCommit = transaction.commit();
    await expect(other.transaction.queryRaw(statement)).resolves.toBe(rows);
    expect(underlying.queryRaw).toHaveBeenCalledOnce();
    expect(underlying.executeRaw).not.toHaveBeenCalled();
    expect(underlying.commit).not.toHaveBeenCalled();

    releaseRead();
    await expect(pendingRead).resolves.toBe(rows);
    await expect(pendingWrite).resolves.toBe(1);
    await pendingCommit;
    expect(underlying.executeRaw).toHaveBeenCalledExactlyOnceWith(statement);
    expect(underlying.commit).toHaveBeenCalledOnce();
  });

  it("returns the original query error and still lets the transaction roll back once", async () => {
    const { underlying, transaction } = setup();
    const error = new Error("query failed");
    underlying.queryRaw.mockRejectedValueOnce(error);
    await expect(transaction.queryRaw(statement)).rejects.toBe(error);
    await Promise.all([transaction.rollback(), transaction.rollback()]);
    expect(underlying.rollback).toHaveBeenCalledOnce();
    await expect(transaction.executeRaw(statement)).rejects.toThrow("already closed");
    expect(underlying.executeRaw).not.toHaveBeenCalled();
  });
});
