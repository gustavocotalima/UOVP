import { PrismaClient, DiagramType } from "@prisma/client";
import { INVESTMENT_PRESETS } from "../features/portfolio/constants";
import { FAQ_SEED } from "../features/faq/data";
import { DEFAULT_QUESTIONS } from "../features/portfolio/questions";
import { ASSET_CATALOG, CATALOG_FAMILY_BY_ID, FIXED_INCOME_FAMILIES } from "../features/portfolio/catalog";

const prisma = new PrismaClient();

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

  for (const preset of INVESTMENT_PRESETS) {
    await prisma.investorProfilePreset.upsert({
      where: { slug: preset.slug },
      update: { name: preset.name, description: preset.description, targets: preset.targets },
      create: preset,
    });
  }

  await prisma.diagramQuestion.deleteMany({ where: { userId: null, isDefault: true } });
  await prisma.diagramQuestion.createMany({
    data: DEFAULT_QUESTIONS.map((question, index) => ({
      type: question.type as DiagramType,
      criterion: question.criterion,
      text: question.text,
      sortOrder: index,
      active: true,
      isDefault: true,
    })),
  });

  for (const [categoryIndex, category] of FAQ_SEED.entries()) {
    const stored = await prisma.faqCategory.upsert({
      where: { slug: category.slug },
      update: { title: category.title, sortOrder: categoryIndex },
      create: { slug: category.slug, title: category.title, sortOrder: categoryIndex },
    });
    await prisma.faqItem.deleteMany({ where: { categoryId: stored.id } });
    await prisma.faqItem.createMany({
      data: category.items.map((item, sortOrder) => ({ ...item, sortOrder, categoryId: stored.id })),
    });
  }
}

main()
  .finally(async () => prisma.$disconnect());
