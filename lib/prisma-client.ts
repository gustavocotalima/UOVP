import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";

export function databaseConnectionOptions(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  const parameter = (name: string, fallback: number, minimum = 0) => {
    const raw = url.searchParams.get(name);
    const value = raw === null ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid database parameter: ${name}.`);
    return value;
  };
  return {
    connectionString,
    max: parameter("connection_limit", 10, 1),
    connectionTimeoutMillis: parameter("pool_timeout", parameter("connect_timeout", 5)) * 1000,
    idleTimeoutMillis: parameter("max_idle_connection_lifetime", 300) * 1000,
    maxLifetimeSeconds: parameter("max_connection_lifetime", 0),
    schema: url.searchParams.get("schema") ?? "public",
  };
}

export function createPrismaClient(options: Pick<Prisma.PrismaClientOptions, "log" | "errorFormat" | "transactionOptions"> = {}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const { schema, ...connection } = databaseConnectionOptions(process.env.DATABASE_URL);
  return new PrismaClient({ ...options, adapter: new PrismaPg(connection, { schema }) });
}
