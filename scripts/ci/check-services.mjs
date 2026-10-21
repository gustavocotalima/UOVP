import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";

assert.equal(process.env.GITHUB_ACTIONS, "true", "CI services must run on an isolated Actions runner.");
for (const name of ["DATABASE_URL", "REDIS_URL", "UOVP_TEST_REDIS_URL", "AUTH_SECRET", "AUTH_RATE_LIMIT_PEPPER", "CREDENTIAL_ENCRYPTION_KEYS", "CREDENTIAL_ENCRYPTION_ACTIVE_KEY", "MCP_OAUTH_SIGNING_KEYS", "MCP_OAUTH_ACTIVE_KEY"]) {
  assert.ok(process.env[name], `${name} is required; integration suites must not silently skip.`);
}
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.equal(databaseUrl.hostname, "127.0.0.1");
assert.equal(databaseUrl.pathname, "/uovp_ci");
assert.equal(process.env.REDIS_URL, process.env.UOVP_TEST_REDIS_URL);
assert.equal(new URL(process.env.REDIS_URL).hostname, "127.0.0.1");
const database = new PrismaClient();
const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", () => undefined);
try {
  const [version] = await database.$queryRaw`SHOW server_version`;
  assert.match(version.server_version, /^18\.4(?:\D|$)/);
  await redis.connect();
  assert.equal(await redis.ping(), "PONG");
  assert.match(await redis.info("server"), /redis_version:7\.2\.15\r?\n/);
  console.log("Disposable PostgreSQL 18.4 and Redis 7.2.15 are reachable.");
} finally {
  await database.$disconnect();
  if (redis.isOpen) await redis.quit();
}
