import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";

if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV) {
  throw new Error("This script only generates credentials for a GitHub Actions job.");
}
const secrets = {
  AUTH_SECRET: randomBytes(48).toString("base64url"),
  AUTH_RATE_LIMIT_PEPPER: randomBytes(48).toString("base64url"),
  CREDENTIAL_ENCRYPTION_KEYS: `ci:${randomBytes(32).toString("base64url")}`,
  MCP_OAUTH_SIGNING_KEYS: `ci:${randomBytes(32).toString("base64url")}`,
};
for (const [name, value] of Object.entries(secrets)) {
  console.log(`::add-mask::${value}`);
  appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}
appendFileSync(process.env.GITHUB_ENV, "CREDENTIAL_ENCRYPTION_ACTIVE_KEY=ci\n");
appendFileSync(process.env.GITHUB_ENV, "MCP_OAUTH_ACTIVE_KEY=ci\n");
