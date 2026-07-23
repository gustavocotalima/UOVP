import { prisma } from "@/lib/prisma";
import Decimal from "decimal.js";
import { INVESTMENT_CLASSES, type InvestmentClassKey } from "./constants";
import { aggregateHoldingValue, holdingCurrentValue } from "./asset-groups";
import { aggregateAveragePrices, calculateHoldingAveragePrice } from "./average-price";

export async function ensurePortfolio(userId: string) {
  return prisma.portfolio.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function getPortfolioData(userId: string) {
  const portfolio = await ensurePortfolio(userId);
  const [assets, storedTargets, fixedIncomeFamilies, catalog, integrationReview] = await Promise.all([
    prisma.asset.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: [{ investmentClass: "asc" }, { ticker: "asc" }],
      include: {
        fixedIncomeFamily: true,
        holdings: {
          include: {
            catalogItem: true,
            pluggyDiagramLink: {
              include: {
                investment: {
                  include: {
                    transactions: {
                      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
                      select: {
                        id: true,
                        description: true,
                        type: true,
                        movementType: true,
                        quantity: true,
                        value: true,
                        amount: true,
                        netAmount: true,
                        agreedRate: true,
                        date: true,
                        tradeDate: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: [{ maturityDate: "asc" }, { productName: "asc" }],
        },
      },
    }),
    prisma.investmentTarget.findMany({ where: { userId } }),
    prisma.fixedIncomeFamily.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.assetCatalogItem.findMany({ orderBy: [{ category: "asc" }, { id: "asc" }] }),
    prisma.pluggyInvestmentDiagramLink.findMany({
      where: {
        userId,
        status: "NEEDS_REVIEW",
        investment: { providerAvailable: true, status: "ACTIVE" },
      },
      orderBy: { updatedAt: "asc" },
      include: {
        investment: {
          include: {
            item: { select: { institutionName: true, connectorName: true } },
            transactions: {
              orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            },
          },
        },
      },
    }),
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
    assets: assets.filter((asset) => {
      const activeHoldings = asset.holdings.filter((holding) => holding.includedInTotals);
      return activeHoldings.length > 0 || !asset.holdings.some((holding) => holding.positionSource === "PLUGGY");
    }).map((asset) => {
      const holdings = asset.holdings.filter((holding) => holding.includedInTotals);
      const holdingValues = holdings.map(holdingCurrentValue);
      const supportsAveragePrice = ["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT"].includes(asset.instrumentType);
      const holdingAveragePrices = holdings.map((holding) =>
        supportsAveragePrice
          ? calculateHoldingAveragePrice({
              positionSource: holding.positionSource,
              quantity: holding.quantity.toString(),
              investedValue: holding.investedValue?.toString(),
              amountOriginal: holding.pluggyDiagramLink?.investment.amountOriginal?.toString(),
              transactions: holding.pluggyDiagramLink?.investment.transactions.map((transaction) => ({
                type: transaction.type,
                quantity: transaction.quantity?.toString(),
                value: transaction.value?.toString(),
                amount: transaction.amount?.toString(),
                netAmount: transaction.netAmount?.toString(),
              })),
            })
          : { price: null, coverage: 0 },
      );
      const averagePrice = aggregateAveragePrices(holdings.map((holding, index) => ({
        ...holdingAveragePrices[index],
        quantity: holding.quantity.toString(),
      })));
      const currentValue = aggregateHoldingValue(holdings);
      const firstHolding = holdings[0];
      const latestPriceUpdate = holdings.reduce<Date | null>((latest, holding) => {
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
        quantity: asset.instrumentType === "FIXED_INCOME"
          ? currentValue.toString()
          : holdings.reduce((total, holding) => total.add(holding.quantity.toString()), new Decimal(0)).toString(),
        unitPrice: asset.instrumentType === "FIXED_INCOME" ? "1" : firstHolding?.unitPrice.toString() ?? "0",
        manualValue: asset.instrumentType === "FIXED_INCOME" ? currentValue.toString() : null,
        currentValue: currentValue.toString(),
        averagePricePaid: averagePrice.price?.toString() ?? null,
        averagePriceCoverage: averagePrice.coverage,
        fractional: asset.instrumentType === "FIXED_INCOME" ? true : asset.instrumentType === "ETF" ? false : firstHolding?.fractional ?? false,
        score: asset.score,
        priceUpdatedAt: latestPriceUpdate?.toISOString() ?? null,
        updatedAt: asset.updatedAt.toISOString(),
        pluggyControlled: holdings.some((holding) => holding.positionSource === "PLUGGY"),
        needsScore: asset.score === 0,
        holdings: holdings.map((holding, index) => ({
          id: holding.id,
          catalogItemId: holding.catalogItemId,
          typeName: holding.catalogItem?.name ?? holding.customTypeName ?? "Outro",
          customTypeName: holding.customTypeName,
          issuer: holding.issuer,
          productName: holding.productName,
          pricingSource: holding.pricingSource,
          positionSource: holding.positionSource,
          ticker: holding.ticker,
          brapiAssetType: holding.brapiAssetType,
          brapiSubType: holding.brapiSubType,
          currency: holding.currency,
          quantity: holding.quantity.toString(),
          unitPrice: holding.unitPrice.toString(),
          investedValue: supportsAveragePrice && holdingAveragePrices[index].price
            ? holdingAveragePrices[index].price.mul(holding.quantity.toString()).toString()
            : holding.investedValue?.toString() ?? null,
          averagePricePaid: holdingAveragePrices[index].price?.toString() ?? null,
          averagePriceCoverage: holdingAveragePrices[index].coverage,
          currentValue: holdingValues[index].toString(),
          fractional: holding.fractional,
          rateConvention: holding.rateConvention,
          benchmark: holding.benchmark,
          rateValue: holding.rateValue?.toString() ?? null,
          purchaseDate: holding.purchaseDate?.toISOString() ?? null,
          maturityDate: holding.maturityDate?.toISOString() ?? null,
          logoUrl: holding.logoUrl,
          priceUpdatedAt: holding.priceUpdatedAt?.toISOString() ?? null,
          providerCurrentValue: holding.providerCurrentValue?.toString() ?? null,
          providerStatus: holding.pluggyDiagramLink?.investment.status ?? null,
          providerAvailable: holding.pluggyDiagramLink?.investment.providerAvailable ?? true,
          transactions: holding.pluggyDiagramLink?.investment.transactions.map((transaction) => ({
            id: transaction.id,
            description: transaction.description,
            type: transaction.type,
            movementType: transaction.movementType,
            quantity: transaction.quantity?.toString() ?? null,
            value: transaction.value?.toString() ?? null,
            amount: transaction.amount?.toString() ?? null,
            netAmount: transaction.netAmount?.toString() ?? null,
            agreedRate: transaction.agreedRate?.toString() ?? null,
            date: transaction.date.toISOString(),
            tradeDate: transaction.tradeDate?.toISOString() ?? null,
          })) ?? [],
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
    integrationReview: integrationReview.map((link) => ({
      id: link.id,
      investmentName: link.investment.name,
      institution: link.investment.institutionName
        ?? link.investment.item.institutionName
        ?? link.investment.item.connectorName,
      providerType: link.investment.type,
      providerSubtype: link.investment.subtype,
      balance: link.investment.balance.toString(),
      code: link.investment.code,
      isin: link.investment.isin,
      value: link.investment.value?.toString() ?? null,
      quantity: link.investment.quantity?.toString() ?? null,
      amount: link.investment.amount?.toString() ?? null,
      taxes: link.investment.taxes?.toString() ?? null,
      taxes2: link.investment.taxes2?.toString() ?? null,
      amountProfit: link.investment.amountProfit?.toString() ?? null,
      amountWithdrawal: link.investment.amountWithdrawal?.toString() ?? null,
      amountOriginal: link.investment.amountOriginal?.toString() ?? null,
      lastMonthRate: link.investment.lastMonthRate?.toString() ?? null,
      annualRate: link.investment.annualRate?.toString() ?? null,
      lastTwelveMonthsRate: link.investment.lastTwelveMonthsRate?.toString() ?? null,
      currencyCode: link.investment.currencyCode,
      quotaDate: link.investment.quotaDate?.toISOString() ?? null,
      owner: link.investment.owner,
      number: link.investment.number,
      institutionNumber: link.investment.institutionNumber,
      insurerName: link.investment.insurerName,
      insurerCnpj: link.investment.insurerCnpj,
      issuer: link.investment.issuer,
      issuerCnpj: link.investment.issuerCnpj,
      rate: link.investment.rate?.toString() ?? null,
      rateType: link.investment.rateType,
      fixedAnnualRate: link.investment.fixedAnnualRate?.toString() ?? null,
      purchaseDate: link.investment.purchaseDate?.toISOString() ?? null,
      dueDate: link.investment.dueDate?.toISOString() ?? null,
      issueDate: link.investment.issueDate?.toISOString() ?? null,
      gracePeriodDate: link.investment.gracePeriodDate?.toISOString() ?? null,
      metadata: link.investment.metadata,
      status: link.investment.status,
      updatedAt: (link.investment.providerUpdatedAt ?? link.investment.updatedAt).toISOString(),
      transactions: link.investment.transactions.map((transaction) => ({
        id: transaction.id,
        description: transaction.description,
        type: transaction.type,
        movementType: transaction.movementType,
        quantity: transaction.quantity?.toString() ?? null,
        value: transaction.value?.toString() ?? null,
        amount: transaction.amount?.toString() ?? null,
        netAmount: transaction.netAmount?.toString() ?? null,
        agreedRate: transaction.agreedRate?.toString() ?? null,
        brokerageNumber: transaction.brokerageNumber,
        date: transaction.date.toISOString(),
        tradeDate: transaction.tradeDate?.toISOString() ?? null,
        expenses: transaction.expenses,
      })),
      suggestedInstrumentType: link.suggestedInstrumentType,
      suggestedInvestmentClass: link.suggestedInvestmentClass as InvestmentClassKey | null,
      suggestedFamilyCode: link.suggestedFamilyCode,
      suggestedIndexation: link.suggestedIndexation,
      reviewReason: link.reviewReason,
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
