import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { isPrismaTransactionConflict } from "@/lib/prisma-errors";

const requestError = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("Database operation failed", { code, meta, clientVersion: "test" });
const adapterError = (cause: unknown) => Object.assign(new Error("Driver operation failed", { cause }), { name: "DriverAdapterError" });

describe("transaction conflict compatibility", () => {
  it("recognizes Prisma's transaction conflict code", () => {
    expect(isPrismaTransactionConflict(requestError("P2034"))).toBe(true);
  });
  it.each(["40001", "40P01"])("recognizes raw PostgreSQL conflict %s in both driver formats", (code) => {
    expect(isPrismaTransactionConflict(requestError("P2010", { code }))).toBe(true);
    expect(isPrismaTransactionConflict(requestError("P2010", {
      driverAdapterError: new Error("Driver conflict", { cause: { originalCode: code, kind: "TransactionWriteConflict" } }),
    }))).toBe(true);
  });
  it.each(["40001", "40P01"])("recognizes direct adapter conflict %s from transaction commit", (code) => {
    expect(isPrismaTransactionConflict(adapterError({ originalCode: code, kind: "TransactionWriteConflict" }))).toBe(true);
  });
  it.each([
    adapterError({ originalCode: "23505", kind: "TransactionWriteConflict" }),
    adapterError({ originalCode: "40001", kind: "DatabaseNotReachable" }),
    adapterError({ originalCode: "40001" }),
    adapterError(undefined),
    new Error("TransactionWriteConflict", { cause: { originalCode: "40001", kind: "TransactionWriteConflict" } }),
    { name: "DriverAdapterError", cause: { originalCode: "40001", kind: "TransactionWriteConflict" } },
  ])("does not retry unrelated or malformed direct adapter errors", (error) => {
    expect(isPrismaTransactionConflict(error)).toBe(false);
  });
  it.each(["23505", "42501", "57014"])("does not retry unrelated SQL error %s", (code) => {
    expect(isPrismaTransactionConflict(requestError("P2010", { driverAdapterError: new Error("Driver error", { cause: { originalCode: code } }) }))).toBe(false);
  });
  it.each([requestError("P2002"), requestError("P1001"), new Error("40001"), { code: "P2034" }, null])("does not treat an unrelated error as a conflict", (error) => {
    expect(isPrismaTransactionConflict(error)).toBe(false);
  });
});
