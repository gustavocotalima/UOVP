import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient, databaseConnectionOptions } from "@/lib/prisma-client";

afterEach(() => vi.unstubAllEnvs());

describe("PostgreSQL driver configuration", () => {
  it("keeps finite connection timeouts and a bounded pool by default", () => {
    expect(databaseConnectionOptions("postgresql://test:test@localhost/test")).toMatchObject({
      max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 300000, maxLifetimeSeconds: 0, schema: "public",
    });
  });

  it("preserves explicit Prisma connection URL limits and schema", () => {
    expect(databaseConnectionOptions("postgresql://test:test@localhost/test?connection_limit=1&pool_timeout=3&max_idle_connection_lifetime=60&max_connection_lifetime=120&schema=custom")).toMatchObject({
      max: 1, connectionTimeoutMillis: 3000, idleTimeoutMillis: 60000, maxLifetimeSeconds: 120, schema: "custom",
    });
  });

  it("uses connect_timeout when no pool timeout was specified", () => {
    expect(databaseConnectionOptions("postgresql://test:test@localhost/test?connect_timeout=7").connectionTimeoutMillis).toBe(7000);
  });

  it.each(["connection_limit=0", "pool_timeout=-1", "connect_timeout=invalid", "max_connection_lifetime=1.5"])("rejects invalid configuration: %s", (query) => {
    expect(() => databaseConnectionOptions(`postgresql://test:private@localhost/test?${query}`)).toThrow("Invalid database parameter");
  });

  it("rejects invalid URLs without including credentials in the error", () => {
    expect(() => databaseConnectionOptions("private-invalid-url")).toThrow("DATABASE_URL must be a valid PostgreSQL connection URL.");
  });

  it("requires a configured connection instead of falling back to driver defaults", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => createPrismaClient()).toThrow("DATABASE_URL is required.");
  });
});
