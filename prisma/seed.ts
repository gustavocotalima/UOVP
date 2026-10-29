import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createPrismaClient } from "../lib/prisma-client";
import { backfillUserDiagramQuestions, synchronizeGlobalQuestionTemplates } from "../features/portfolio/question-provisioning";
import { ASSET_CATALOG, CATALOG_FAMILY_BY_ID, FIXED_INCOME_FAMILIES } from "../features/portfolio/catalog";

if (!process.env.DATABASE_URL && existsSync(".env")) loadEnvFile(".env");

const prisma = createPrismaClient();

async function main() {
  for (const family of FIXED_INCOME_FAMILIES) {
    await prisma.fixedIncomeFamily.upsert({
      where: { code: family.code },
      update: { name: family.name, shortCode: family.shortCode, sortOrder: family.sortOrder },
      create: family,
    });
  }

  for (const item of ASSET_CATALOG) {
    const data = { ...item, familyCode: CATALOG_FAMILY_BY_ID[item.id] ?? null };
    await prisma.assetCatalogItem.upsert({
      where: { id: item.id },
      update: data,
      create: data,
    });
  }

  await prisma.$transaction(synchronizeGlobalQuestionTemplates, { timeout: 30_000 });
  await backfillUserDiagramQuestions(prisma);
}

main()
  .finally(async () => prisma.$disconnect());
