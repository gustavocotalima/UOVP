import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "prisma/config";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL },
});
