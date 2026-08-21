import { prisma } from "@/lib/prisma";
import Decimal from "decimal.js";
import { resolvePluggyInvestmentIssuer } from "@/features/open-finance/institution-logo";
import { INVESTMENT_CLASSES, type InvestmentClassKey } from "./constants";
import { aggregateHoldingValue, holdingCurrentValue, holdingCurrentValueNative, holdingUnitPriceBrl } from "./asset-groups";
import { aggregateAveragePrices, calculateHoldingAveragePrice } from "./average-price";
import { normalizeBrapiSymbol } from "./brapi";
import { normalizeYahooSymbol } from "./yahoo-finance";
import { usableBrapiLogoUrl } from "./market-logo";
import { readMarketMetadata } from "./market-metadata";
import { DEFAULT_QUESTIONS, defaultQuestionTemplateKey } from "./questions";
import { allowsFractionalUnits } from "./fractional-assets";

const BRAPI_INSTRUMENTS = new Set(["STOCK", "ETF", "REAL_ESTATE_FUND"]);
const MARKET_INSTRUMENTS = new Set(["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT"]);

function isBrapiAsset(asset: {
  instrumentType: string;
  investmentClass: string;
  marketRegion: string | null;
}) {
  return BRAPI_INSTRUMENTS.has(asset.instrumentType)
    && !["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(asset.investmentClass)
    && (asset.investmentClass !== "STORE_OF_VALUE" || asset.marketRegion === "BRAZIL");
}

function isYahooAsset(asset: {
  instrumentType: string;
  investmentClass: string;
  marketRegion: string | null;
}) {
  return MARKET_INSTRUMENTS.has(asset.instrumentType)
    && (
      ["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(asset.investmentClass)
      || (asset.investmentClass === "STORE_OF_VALUE" && asset.marketRegion === "INTERNATIONAL")
    );
}

export async function ensurePortfolio(userId: string) {
  return prisma.portfolio.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function getPortfolioData(userId: string) {
  const portfolio = await ensurePortfolio(userId);
  const [assets, storedTargets, fixedIncomeFamilies, catalog, integrationReview, preference] = await Promise.all([
    prisma.asset.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: { ticker: "asc" },
      include: {
        fixedIncomeFamily: true,
        holdings: {
          include: {
            catalogItem: true,
            pluggyDiagramLink: {
              include: {
                investment: {
                  include: {
                    item: {
                      select: {
                        institutionName: true,
                        connectorName: true,
                      },
                    },
                    _count: { select: { transactions: true } },
                  },
                },
              },
            },
          },
          orderBy: [{ maturityDate: "asc" }, { productName: "asc" }],
        },
        suggestions: {
          where: {
            executionStatus: "AWAITING_SYNC",
            simulation: { userId },
          },
          orderBy: [{ awaitingSyncAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            quantity: true,
            value: true,
            paidUnitPrice: true,
            nativeCurrency: true,
            paidUnitPriceNative: true,
            executionFxRateToBrl: true,
            awaitingSyncAt: true,
          },
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
              take: 25,
            },
          },
        },
      },
    }),
    prisma.userPreference.findUnique({
      where: { userId },
      select: { timeZone: true },
    }),
  ]);
  const investmentClassOrder = new Map(
    INVESTMENT_CLASSES.map((investmentClass, index) => [investmentClass, index]),
  );
  assets.sort((left, right) => {
    const classComparison = (investmentClassOrder.get(left.investmentClass as InvestmentClassKey) ?? Number.MAX_SAFE_INTEGER)
      - (investmentClassOrder.get(right.investmentClass as InvestmentClassKey) ?? Number.MAX_SAFE_INTEGER);
    return classComparison || left.ticker.localeCompare(right.ticker, "pt-BR", {
      numeric: true,
      sensitivity: "base",
    });
  });
  const [brapiMetadataBySymbol, yahooMetadataBySymbol] = await Promise.all([
    readMarketMetadata(
      "BRAPI",
      assets.filter(isBrapiAsset).map((asset) => normalizeBrapiSymbol(asset.ticker)),
    ),
    readMarketMetadata(
      "YAHOO",
      assets.filter(isYahooAsset).map((asset) => normalizeYahooSymbol(asset.ticker)),
    ),
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
    timeZone: preference?.timeZone ?? "America/Sao_Paulo",
    targets,
    assets: assets.filter((asset) => {
      const activeHoldings = asset.holdings.filter((holding) => holding.includedInTotals);
      return activeHoldings.length > 0
        || asset.suggestions.length > 0
        || !asset.holdings.some((holding) => holding.positionSource === "PLUGGY");
    }).map((asset) => {
      const holdings = asset.holdings.filter((holding) => holding.includedInTotals);
      const awaitingSyncContribution = asset.suggestions[0] ?? null;
      const holdingValues = holdings.map(holdingCurrentValue);
      const supportsAveragePrice = ["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT"].includes(asset.instrumentType);
      const holdingAveragePrices = holdings.map((holding) =>
        supportsAveragePrice
          ? calculateHoldingAveragePrice({
              positionSource: holding.positionSource,
              quantity: holding.quantity.toString(),
              investedValue: holding.investedValue?.toString(),
              amountOriginal: holding.pluggyDiagramLink?.investment.amountOriginal?.toString(),
              transactions: [],
            })
          : { price: null, coverage: 0 },
      );
      const averagePrice = aggregateAveragePrices(holdings.map((holding, index) => ({
        ...holdingAveragePrices[index],
        quantity: holding.quantity.toString(),
      })));
      const currentValue = aggregateHoldingValue(holdings);
      const nativeCurrencies = new Set(holdings.map((holding) => holding.currency.trim().toUpperCase()));
      const nativeCurrency = nativeCurrencies.size === 1 && !nativeCurrencies.has("BRL")
        ? [...nativeCurrencies][0]
        : null;
      const holdingNativeValues = holdings.map(holdingCurrentValueNative);
      const nativeCurrentValue = nativeCurrency && holdingNativeValues.every((value) => value !== null)
        ? holdingNativeValues.reduce((total, value) => total.add(value!), new Decimal(0))
        : null;
      const firstHolding = holdings[0];
      const marketMetadata = isBrapiAsset(asset)
        ? brapiMetadataBySymbol.get(normalizeBrapiSymbol(asset.ticker))
        : isYahooAsset(asset)
          ? yahooMetadataBySymbol.get(normalizeYahooSymbol(asset.ticker))
          : undefined;
      const canonicalLogoUrl = marketMetadata?.status === "VERIFIED"
        ? marketMetadata.provider === "BRAPI"
          ? usableBrapiLogoUrl(marketMetadata.logoUrl)
          : marketMetadata.logoUrl
        : null;
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
        marketRegion: asset.marketRegion,
        logoUrl: canonicalLogoUrl ?? firstHolding?.logoUrl ?? null,
        currency: firstHolding?.currency ?? "BRL",
        quantity: asset.instrumentType === "FIXED_INCOME"
          ? currentValue.toString()
          : holdings.reduce((total, holding) => total.add(holding.quantity.toString()), new Decimal(0)).toString(),
        unitPrice: asset.instrumentType === "FIXED_INCOME" ? "1" : firstHolding ? holdingUnitPriceBrl(firstHolding).toString() : "0",
        nativeUnitPrice: asset.instrumentType === "FIXED_INCOME" ? null : firstHolding?.unitPrice.toString() ?? null,
        fxRateToBrl: firstHolding?.fxRateToBrl?.toString() ?? null,
        fxUpdatedAt: firstHolding?.fxUpdatedAt?.toISOString() ?? null,
        manualValue: asset.instrumentType === "FIXED_INCOME" ? currentValue.toString() : null,
        currentValue: currentValue.toString(),
        nativeCurrentValue: nativeCurrentValue?.toString() ?? null,
        nativeCurrency,
        averagePricePaid: averagePrice.price?.toString() ?? null,
        averagePriceCoverage: averagePrice.coverage,
        fractional: allowsFractionalUnits({
          instrumentType: asset.instrumentType,
          investmentClass: asset.investmentClass,
          pricingSource: firstHolding?.pricingSource,
          fallback: firstHolding?.fractional ?? false,
        }),
        score: asset.score,
        priceUpdatedAt: latestPriceUpdate?.toISOString() ?? null,
        updatedAt: asset.updatedAt.toISOString(),
        pluggyControlled: holdings.some((holding) => holding.positionSource === "PLUGGY"),
        needsScore: asset.score === 0,
        awaitingSyncContribution: awaitingSyncContribution
          ? {
              quantity: awaitingSyncContribution.quantity.toString(),
              value: awaitingSyncContribution.value.toString(),
              paidUnitPrice: awaitingSyncContribution.paidUnitPrice?.toString() ?? null,
              nativeCurrency: awaitingSyncContribution.nativeCurrency,
              paidUnitPriceNative: awaitingSyncContribution.paidUnitPriceNative?.toString() ?? null,
              executionFxRateToBrl: awaitingSyncContribution.executionFxRateToBrl?.toString() ?? null,
              awaitingSyncAt: awaitingSyncContribution.awaitingSyncAt?.toISOString() ?? null,
            }
          : null,
        holdings: holdings.map((holding, index) => ({
          id: holding.id,
          catalogItemId: holding.catalogItemId,
          typeName: holding.catalogItem?.name ?? holding.customTypeName ?? "Outro",
          customTypeName: holding.customTypeName,
          issuer: holding.pluggyDiagramLink && MARKET_INSTRUMENTS.has(asset.instrumentType)
            ? marketMetadata?.name ?? asset.name
            : holding.pluggyDiagramLink
              ? resolvePluggyInvestmentIssuer(
                  holding.pluggyDiagramLink.investment.issuer,
                  holding.pluggyDiagramLink.investment.institutionName,
                  holding.pluggyDiagramLink.investment.item.institutionName,
                  holding.pluggyDiagramLink.investment.item.connectorName,
                )
              : holding.issuer,
          institution: holding.pluggyDiagramLink
            ? resolvePluggyInvestmentIssuer(
                null,
                holding.pluggyDiagramLink.investment.institutionName,
                holding.pluggyDiagramLink.investment.item.institutionName,
                holding.pluggyDiagramLink.investment.item.connectorName,
              )
            : null,
          productName: holding.productName,
          pricingSource: holding.pricingSource,
          positionSource: holding.positionSource,
          ticker: holding.ticker,
          providerSymbol: holding.providerSymbol,
          brapiAssetType: holding.brapiAssetType,
          brapiSubType: holding.brapiSubType,
          marketExchange: holding.marketExchange,
          marketQuoteType: holding.marketQuoteType,
          marketSector: holding.marketSector,
          marketIndustry: holding.marketIndustry,
          currency: holding.currency,
          quantity: holding.quantity.toString(),
          unitPrice: holding.unitPrice.toString(),
          unitPriceBrl: holdingUnitPriceBrl(holding).toString(),
          fxRateToBrl: holding.fxRateToBrl?.toString() ?? null,
          fxUpdatedAt: holding.fxUpdatedAt?.toISOString() ?? null,
          investedValue: supportsAveragePrice && holdingAveragePrices[index].price
            ? holdingAveragePrices[index].price.mul(holding.quantity.toString()).toString()
            : holding.investedValue?.toString() ?? null,
          averagePricePaid: holdingAveragePrices[index].price?.toString() ?? null,
          averagePriceCoverage: holdingAveragePrices[index].coverage,
          currentValue: holdingValues[index].toString(),
          nativeCurrentValue: holdingNativeValues[index]?.toString() ?? null,
          fractional: holding.fractional,
          rateConvention: holding.rateConvention,
          benchmark: holding.benchmark,
          rateValue: holding.rateValue?.toString() ?? null,
          purchaseDate: holding.purchaseDate?.toISOString() ?? null,
          maturityDate: holding.maturityDate?.toISOString() ?? null,
          logoUrl: canonicalLogoUrl ?? holding.logoUrl ?? null,
          priceUpdatedAt: holding.priceUpdatedAt?.toISOString() ?? null,
          providerCurrentValue: holding.providerCurrentValue?.toString() ?? null,
          providerStatus: holding.pluggyDiagramLink?.investment.status ?? null,
          providerAvailable: holding.pluggyDiagramLink?.investment.providerAvailable ?? true,
          transactionCount: holding.pluggyDiagramLink?.investment._count.transactions ?? 0,
          transactions: [],
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
      institution: resolvePluggyInvestmentIssuer(
        null,
        link.investment.institutionName,
        link.investment.item.institutionName,
        link.investment.item.connectorName,
      ),
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
      issuer: resolvePluggyInvestmentIssuer(
        link.investment.issuer,
        link.investment.institutionName,
        link.investment.item.institutionName,
        link.investment.item.connectorName,
      ),
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
      suggestedMarketRegion: link.suggestedMarketRegion,
      suggestedFamilyCode: link.suggestedFamilyCode,
      suggestedIndexation: link.suggestedIndexation,
      reviewReason: link.reviewReason,
    })),
  };
}

async function ensureUserDiagramQuestions(userId: string) {
  await prisma.$transaction(async (tx) => {
    const defaults = await tx.diagramQuestion.findMany({
      where: { userId: null, isDefault: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    });
    const sourceQuestions = defaults.length
      ? defaults
      : DEFAULT_QUESTIONS.map((question, sortOrder) => ({
          id: "",
          type: question.type,
          criterion: question.criterion,
          text: question.text,
          sortOrder,
          active: true,
          templateKey: defaultQuestionTemplateKey(question),
        }));
    await tx.diagramQuestion.createMany({
      data: sourceQuestions.map((question) => ({
        userId,
        type: question.type,
        criterion: question.criterion,
        text: question.text,
        sortOrder: question.sortOrder,
        active: question.active,
        templateKey: question.templateKey
          ?? `${question.type}:${question.criterion}`.toUpperCase(),
      })),
      skipDuplicates: true,
    });
    const copies = await tx.diagramQuestion.findMany({
      where: {
        userId,
        templateKey: { in: sourceQuestions.flatMap((question) => question.templateKey ? [question.templateKey] : []) },
      },
      select: { id: true, templateKey: true },
    });
    const copyByTemplate = new Map(copies.map((copy) => [copy.templateKey, copy.id]));
    const defaultById = new Map(defaults.map((question) => [question.id, question.templateKey]));
    const existingAnswers = defaults.length
      ? await tx.assetQuestionAnswer.findMany({
          where: {
            questionId: { in: defaults.map((question) => question.id) },
            asset: { portfolio: { userId } },
          },
          select: { assetId: true, questionId: true, answer: true },
        })
      : [];
    if (existingAnswers.length) {
      await tx.assetQuestionAnswer.createMany({
        data: existingAnswers.flatMap((answer) => {
          const templateKey = defaultById.get(answer.questionId);
          const copyId = templateKey ? copyByTemplate.get(templateKey) : undefined;
          return copyId ? [{ assetId: answer.assetId, answer: answer.answer, questionId: copyId }] : [];
        }),
        skipDuplicates: true,
      });
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
