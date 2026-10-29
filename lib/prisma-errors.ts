import { Prisma } from "@/generated/prisma/client";

export function isPrismaTransactionConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  const driver = error.meta?.driverAdapterError;
  const cause = typeof driver === "object" && driver !== null && "cause" in driver ? driver.cause : undefined;
  const originalCode = typeof cause === "object" && cause !== null && "originalCode" in cause ? cause.originalCode : undefined;
  return [error.meta?.code, originalCode].some((code) => code === "40001" || code === "40P01");
}
