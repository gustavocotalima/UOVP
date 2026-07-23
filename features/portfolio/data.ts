import { prisma } from "@/lib/prisma";
import { INVESTMENT_CLASSES, type InvestmentClassKey } from "./constants";
import { aggregateHoldingValue, holdingCurrentValue } from "./asset-groups";

export async function ensurePortfolio(userId: string) {
  return prisma.portfolio.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function getPortfolioData(userId: string) {
  const portfolio = await ensurePortfolio(userId);
  const [assets, storedTargets, fixedIncomeFamilies, catalog] = await Promise.all([
    prisma.asset.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: [{ investmentClass: "asc" }, { ticker: "asc" }],
      include: {
        fixedIncomeFamily: true,
        holdings: { include: { catalogItem: true }, orderBy: [{ maturityDate: "asc" }, { productName: "asc" }] },
      },
    }),
    prisma.investmentTarget.findMany({ where: { userId } }),
    prisma.fixedIncomeFamily.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.assetCatalogItem.findMany({ orderBy: [{ category: "asc" }, { id: "asc" }] }),
  ]);
  const targets = Object.fromEntries(
    INVESTMENT_CLASSES.map((investmentClass) => [
      investmentClass,
      Number(storedTargets.find((target) => target.investmentClass === investmentClass)?.percentage ?? 0),
    ]),
  ) as Record<InvestmentClassKey, number>;

  return {
    id: portfolio.id,
    version: portfolio.version,
    targets,
    assets: assets.map((asset) => {
      const holdingValues = asset.holdings.map(holdingCurrentValue);
      const currentValue = aggregateHoldingValue(asset.holdings);
      const firstHolding = asset.holdings[0];
      const latestPriceUpdate = asset.holdings.reduce<Date | null>((latest, holding) => {
        if (!holding.priceUpdatedAt) return latest;
        return !latest || holding.priceUpdatedAt > latest ? holding.priceUpdatedAt : latest;
      }, null);
      return {
        id: asset.id,
        investmentClass: asset.investmentClass as InvestmentClassKey,
        instrumentType: asset.instrumentType,
        ticker: asset.ticker,
        name: asset.name,
        fixedIncomeFamilyCode: asset.fixedIncomeFamilyCode,
        fixedIncomeFamilyName: asset.fixedIncomeFamily?.name ?? null,
        fixedIncomeFamilyShortCode: asset.fixedIncomeFamily?.shortCode ?? null,
        indexation: asset.indexation,
        logoUrl: firstHolding?.logoUrl ?? null,
        currency: firstHolding?.currency ?? "BRL",
        quantity: asset.instrumentType === "FIXED_INCOME" ? currentValue.toString() : firstHolding?.quantity.toString() ?? "0",
        unitPrice: asset.instrumentType === "FIXED_INCOME" ? "1" : firstHolding?.unitPrice.toString() ?? "0",
        manualValue: asset.instrumentType === "FIXED_INCOME" ? currentValue.toString() : null,
        currentValue: currentValue.toString(),
        fractional: asset.instrumentType === "FIXED_INCOME" ? true : asset.instrumentType === "ETF" ? false : firstHolding?.fractional ?? false,
        score: asset.score,
        priceUpdatedAt: latestPriceUpdate?.toISOString() ?? null,
        updatedAt: asset.updatedAt.toISOString(),
        holdings: asset.holdings.map((holding, index) => ({
          id: holding.id,
          catalogItemId: holding.catalogItemId,
          typeName: holding.catalogItem?.name ?? holding.customTypeName ?? "Outro",
          customTypeName: holding.customTypeName,
          issuer: holding.issuer,
          productName: holding.productName,
          pricingSource: holding.pricingSource,
          ticker: holding.ticker,
          brapiAssetType: holding.brapiAssetType,
          brapiSubType: holding.brapiSubType,
          currency: holding.currency,
          quantity: holding.quantity.toString(),
          unitPrice: holding.unitPrice.toString(),
          investedValue: holding.investedValue?.toString() ?? null,
          currentValue: holdingValues[index].toString(),
          fractional: holding.fractional,
          rateConvention: holding.rateConvention,
          benchmark: holding.benchmark,
          rateValue: holding.rateValue?.toString() ?? null,
          purchaseDate: holding.purchaseDate?.toISOString() ?? null,
          maturityDate: holding.maturityDate?.toISOString() ?? null,
          logoUrl: holding.logoUrl,
          priceUpdatedAt: holding.priceUpdatedAt?.toISOString() ?? null,
          updatedAt: holding.updatedAt.toISOString(),
        })),
      };
    }),
    fixedIncomeFamilies,
    catalog: catalog.map((item) => ({
      id: item.id,
      category: item.category,
      name: item.name,
      summary: item.summary,
      familyCode: item.familyCode,
    })),
  };
}

async function ensureUserDiagramQuestions(userId: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.diagramQuestion.count({ where: { userId } });
    if (existing > 0) return;
    const defaults = await tx.diagramQuestion.findMany({
      where: { userId: null, isDefault: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    });
    for (const question of defaults) {
      const copy = await tx.diagramQuestion.create({
        data: {
          userId,
          type: question.type,
          criterion: question.criterion,
          text: question.text,
          sortOrder: question.sortOrder,
          active: question.active,
        },
      });
      const existingAnswers = await tx.assetQuestionAnswer.findMany({
        where: { questionId: question.id, asset: { portfolio: { userId } } },
        select: { assetId: true, answer: true },
      });
      if (existingAnswers.length) {
        await tx.assetQuestionAnswer.createMany({
          data: existingAnswers.map((answer) => ({ ...answer, questionId: copy.id })),
          skipDuplicates: true,
        });
      }
    }
  });
}

export async function getDiagramData(userId: string) {
  await ensureUserDiagramQuestions(userId);
  const [questions, answers] = await Promise.all([
    prisma.diagramQuestion.findMany({
      where: { userId },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.assetQuestionAnswer.findMany({
      where: { asset: { portfolio: { userId } } },
      select: { assetId: true, questionId: true, answer: true },
    }),
  ]);
  return {
    questions: questions.map((question) => ({
      id: question.id,
      type: question.type,
      criterion: question.criterion,
      text: question.text,
      active: question.active,
      isDefault: question.isDefault,
      sortOrder: question.sortOrder,
    })),
    answers,
  };
}
