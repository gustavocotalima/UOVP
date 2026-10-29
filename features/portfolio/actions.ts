"use server";

import { serializeContributionBaselines } from "./pending-contributions";


import { revalidatePath } from "next/cache";
import { Prisma, type DiagramType, type FixedIncomeIndexation, type InstrumentType, type InvestmentClass, type MarketRegion, type RateConvention } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setAccountInvestmentPreference } from "@/features/finance/account-investments";
import { requireUserId } from "@/lib/current-user";
import {
  assertUserOperationRateLimit,
  type UserOperationLeaseContext,
  withUserOperationLease,
} from "@/lib/operation-security";
import {
  isAutomaticRefreshStale,
  shouldRefreshMarketHoldings,
} from "@/lib/automatic-refresh-policy";
import { anonymizedUserId, logIntegrationRefresh } from "@/lib/integration-observability";
import {
  PLUGGY_DIAGRAM_REVIEW_REASON,
  reopenDeletedPluggyPositionForReview,
} from "@/features/open-finance/diagram-exclusion";
import { questionChangeAffectsAllocation } from "./allocation";
import { calculateContribution } from "./calculation/server";
import { BUDGET_POLICIES, type BudgetPolicy } from "./calculation/types";
import { CONTRIBUTION_UNIT_TYPES, resolveContributionQuantity, registerContributionQuantity, reviewPendingContribution, refreshContributionQuantityCost } from "@/features/open-finance/contribution-quantity";
import { fixedIncomeHoldingFingerprint, holdingCurrentValue } from "./asset-groups";
import { addInvestmentCost, investmentCostUpdate } from "./investment-cost";
import { investmentTargetsTotalCents, targetPercentageCents } from "./target-drafts";
import {
  applyAssetQuantityEdits, assetQuantityEditSchema, prepareAssetQuantityEdits,
  validateAssetQuantityEdits, type PreparedAssetQuantityEdits,
} from "@/features/open-finance/asset-quantity-edits";
import {
  assetCanReceiveContribution,
  isContributionScopeValid,
  type ContributionScopeKey,
} from "./contribution-scope";
import {
  fetchBinanceQuotes,
  readCachedBinancePairPrices,
  searchBinanceAssets,
  type BinanceAssetSearchResult,
  type BinanceQuote,
} from "./binance";
import { fetchAvailableBrapiQuotes, fetchBrapiQuotes, normalizeBrapiSymbol, readCachedBrapiQuotes, searchBrapiEtfTickers, searchBrapiTickers, type BrapiQuote } from "./brapi";
import { clearBrapiApiKey, requireBrapiApiKey, requireBrapiCredentials, storeBrapiApiKey, storeBrapiPlan } from "./brapi-credentials";
import { BRAPI_PLANS, type BrapiPlan } from "./brapi-plans";
import { ensurePortfolio, getPortfolioData } from "./data";
import { FIXED_INCOME_INDEXATIONS, INSTRUMENT_TYPES, INVESTMENT_CLASSES, RATE_CONVENTIONS, FIXED_INCOME_INDEXATION_META, type InvestmentClassKey } from "./constants";
import { DEFAULT_QUESTIONS, defaultQuestionTemplateKey, calculateDiagramScore } from "./questions";
import { allowsFractionalUnits } from "./fractional-assets";
import { sortContributionSuggestions } from "./contribution-order";
import {
  persistExactBrapiSearchMetadata,
  persistExactYahooSearchMetadata,
  resolveBrapiLogo,
  resolveYahooLogo,
} from "./market-logo-resolver";
import {
  classifyYahooReitMetadata,
  fetchAvailableYahooQuotes,
  fetchYahooAssetProfile,
  fetchYahooFxRates,
  fetchYahooQuotes,
  normalizeYahooSymbol,
  readCachedYahooQuotes,
  searchYahooTickers,
  yahooFxSymbol,
  type YahooQuote,
  type YahooSearchKind,
} from "./yahoo-finance";

const investmentClassSchema = z.enum(INVESTMENT_CLASSES);
const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES);
const marketRegionSchema = z.enum(["BRAZIL", "INTERNATIONAL"]);
const investmentCostShape = {
  investedValue: z.coerce.number().finite().min(0).nullable().optional(),
  investedValueCurrency: z.string().trim().regex(/^[A-Za-z0-9]{3,8}$/).transform((value) => value.toUpperCase()).nullable().optional(),
};
const assetSchema = z.object({
  id: z.string().cuid().optional(),
  investmentClass: investmentClassSchema,
  instrumentType: instrumentTypeSchema.optional(),
  ticker: z.string().trim().min(1).max(24).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  quantity: z.coerce.number().min(0),
  unitPrice: z.coerce.number().min(0),
  manualValue: z.coerce.number().min(0).nullable().optional(),
  ...investmentCostShape,
  currency: z.string().trim().regex(/^[A-Za-z0-9]{3,8}$/, "Informe uma moeda válida.").transform((value) => value.toUpperCase()).default("BRL"),
  fractional: z.boolean().default(false),
  score: z.coerce.number().int().min(-30).max(30).default(0),
  fixedIncomeFamilyCode: z.string().trim().min(2).max(80).nullable().optional(),
  indexation: z.enum(FIXED_INCOME_INDEXATIONS).nullable().optional(),
  marketRegion: marketRegionSchema.nullable().optional(),
  yahooReitConfirmed: z.boolean().default(false),
  quantityEdits: z.array(assetQuantityEditSchema).max(50).optional(),
});

export type AssetInput = z.input<typeof assetSchema>;

const fixedIncomeHoldingSchema = z.object({
  id: z.string().cuid().optional(),
  catalogItemId: z.coerce.number().int().positive().nullable().optional(),
  customTypeName: z.string().trim().min(2).max(120).nullable().optional(),
  issuer: z.string().trim().min(2).max(120),
  productName: z.string().trim().min(2).max(160),
  ...investmentCostShape,
  currentValue: z.coerce.number().min(0),
  rateConvention: z.enum(RATE_CONVENTIONS).nullable().optional(),
  benchmark: z.string().trim().max(40).nullable().optional(),
  rateValue: z.coerce.number().min(-1000).max(10000).nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  maturityDate: z.coerce.date().nullable().optional(),
});

const fixedIncomeGroupSchema = z.object({
  id: z.string().cuid().optional(),
  familyCode: z.string().trim().min(2).max(80),
  indexation: z.enum(FIXED_INCOME_INDEXATIONS),
  investmentClass: z.enum(["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"]).default("FIXED_INCOME"),
  score: z.coerce.number().int().min(-30).max(30).default(0),
});

export type FixedIncomeHoldingInput = z.input<typeof fixedIncomeHoldingSchema>;
export type FixedIncomeGroupInput = z.input<typeof fixedIncomeGroupSchema>;

const fixedIncomeImportSchema = fixedIncomeGroupSchema.omit({ id: true }).extend({
  holding: fixedIncomeHoldingSchema,
});

export type FixedIncomeImportInput = z.input<typeof fixedIncomeImportSchema>;

const brapiApiKeySchema = z.string()
  .trim()
  .transform((value) => value.replace(/^Bearer\s+/i, ""))
  .pipe(z.string().min(8, "Informe uma chave válida da brapi.").max(2000));
const brapiPlanSchema = z.enum(BRAPI_PLANS);

const tickerSearchSchema = z.string().trim().min(1).max(60);
const assetLogoRepairSchema = z.object({
  assetId: z.string().cuid(),
  failedLogoUrls: z.array(z.string().url()).max(5).default([]),
});
const brapiSearchKindSchema = z.enum(["BRAZILIAN_STOCKS", "REAL_ESTATE_FUNDS", "ETF"]);
const yahooSearchKindSchema = z.enum(["INTERNATIONAL_STOCKS", "REITS", "ETF"]);
const contributionCurrencySchema = z.enum(["BRL", "USD"]);
const contributionScopeSchema = z.enum(["ALL_ASSETS", "BRL_ONLY", "USD_ONLY"]);

function inferInstrumentType(investmentClass: InvestmentClassKey): InstrumentType {
  if (investmentClass === "REAL_ESTATE_FUNDS") return "REAL_ESTATE_FUND";
  if (investmentClass === "REITS") return "REIT";
  if (investmentClass === "CRYPTO") return "CRYPTO";
  if (investmentClass === "STORE_OF_VALUE") return "ETF";
  if (investmentClass === "FIXED_INCOME" || investmentClass === "INTERNATIONAL_FIXED_INCOME") return "FIXED_INCOME";
  return "STOCK";
}

function normalizedText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function usesBrapiQuotes(
  investmentClass: InvestmentClassKey,
  instrumentType?: InstrumentType,
  marketRegion?: z.infer<typeof marketRegionSchema> | null,
) {
  if (instrumentType === "ETF") {
    if (investmentClass === "STORE_OF_VALUE") {
      return marketRegion === "BRAZIL";
    }
    return !["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(investmentClass);
  }
  return investmentClass === "BRAZILIAN_STOCKS" || investmentClass === "REAL_ESTATE_FUNDS";
}

function usesYahooQuotes(
  investmentClass: InvestmentClassKey,
  instrumentType?: InstrumentType,
  marketRegion?: z.infer<typeof marketRegionSchema> | null,
) {
  if (instrumentType === "ETF" && investmentClass === "STORE_OF_VALUE") {
    return marketRegion === "INTERNATIONAL";
  }
  return ["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(investmentClass)
    && ["STOCK", "REIT", "ETF"].includes(instrumentType ?? "");
}

function usesBinanceQuotes(investmentClass: InvestmentClassKey, instrumentType?: InstrumentType) {
  return investmentClass === "CRYPTO" && instrumentType === "CRYPTO";
}

function yahooSearchKind(investmentClass: InvestmentClassKey, instrumentType: InstrumentType): YahooSearchKind {
  if (instrumentType === "ETF") return "ETF";
  return investmentClass === "REITS" || instrumentType === "REIT" ? "REITS" : "INTERNATIONAL_STOCKS";
}

async function assertOwnedAsset(userId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, portfolio: { userId } },
  });
  if (!asset) throw new Error("Ativo não encontrado.");
  return asset;
}

export async function saveAssetAction(input: AssetInput) {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "portfolio-save-asset",
    limit: 30,
    windowMs: 10 * 60_000,
  });
  const parsed = assetSchema.parse(input);
  const costData = investmentCostUpdate(parsed);
  if (parsed.quantityEdits?.length && !parsed.id) throw new Error("Selecione um ativo existente para corrigir quantidades conectadas.");
  const portfolio = await ensurePortfolio(userId);
  const instrumentType = (parsed.instrumentType ?? inferInstrumentType(parsed.investmentClass)) as InstrumentType;
  if (instrumentType === "FIXED_INCOME") {
    throw new Error("Use o cadastro de grupo de renda fixa.");
  }
  const classifiesAsStoreOfValue = instrumentType === "ETF" && parsed.investmentClass === "STORE_OF_VALUE";
  if (classifiesAsStoreOfValue && !parsed.marketRegion) {
    throw new Error("Selecione se o ETF de reserva de valor é nacional ou internacional.");
  }
  const classifiesAsFixedIncome = instrumentType === "ETF" && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(parsed.investmentClass);
  if (classifiesAsFixedIncome && (!parsed.fixedIncomeFamilyCode || !parsed.indexation)) {
    throw new Error("Selecione o grupo e a indexação do ETF de renda fixa.");
  }
  if (classifiesAsFixedIncome) {
    const familyExists = await prisma.fixedIncomeFamily.count({ where: { code: parsed.fixedIncomeFamilyCode! } });
    if (!familyExists) throw new Error("Grupo de renda fixa não encontrado.");
  }
  const existingPositions = parsed.id ? await prisma.assetHolding.findMany({
    where: {
      assetId: parsed.id,
      includedInTotals: true,
      positionSource: { in: ["MANUAL", "PLUGGY", "BINANCE", "ACCOUNT_BALANCE"] },
      asset: { portfolio: { userId } },
    },
    orderBy: { createdAt: "asc" },
  }) : [];
  const existingHolding = existingPositions.find((holding) => holding.positionSource === "MANUAL") ?? null;
  const existingQuoteHolding = existingHolding ?? existingPositions[0] ?? null;
  const hasProviderControlledPosition = existingPositions.some((holding) => holding.positionSource !== "MANUAL");
  if (hasProviderControlledPosition && parsed.investedValue !== undefined) {
    throw new Error("O custo de posições conectadas é mantido pelo provedor.");
  }
  if (parsed.id && !existingHolding && !hasProviderControlledPosition) {
    throw new Error("Posição do ativo não encontrada.");
  }
  let brapiQuote: BrapiQuote | undefined;
  let brapiMatch: Awaited<ReturnType<typeof searchBrapiTickers>>[number] | undefined;
  let brapiLogoMetadata: Awaited<ReturnType<typeof persistExactBrapiSearchMetadata>> = null;
  let yahooQuote: YahooQuote | undefined;
  let yahooMatch: Awaited<ReturnType<typeof searchYahooTickers>>[number] | undefined;
  let yahooLogoMetadata: Awaited<ReturnType<typeof persistExactYahooSearchMetadata>> = null;
  let yahooFx: Awaited<ReturnType<typeof fetchYahooFxRates>>[number] | undefined;
  let binanceQuote: BinanceQuote | undefined;
  let binanceMatch: BinanceAssetSearchResult | undefined;
  const selectedPricingSource = classifiesAsStoreOfValue
    ? parsed.marketRegion === "INTERNATIONAL" ? "YAHOO" : "BRAPI"
    : null;
  const mustResolveMarketQuote = !parsed.id
    || existingPositions.some((holding) => holding.positionSource === "MANUAL" && holding.ticker !== parsed.ticker)
    || Boolean(selectedPricingSource && existingQuoteHolding?.pricingSource !== selectedPricingSource);
  if (mustResolveMarketQuote && usesBrapiQuotes(parsed.investmentClass, instrumentType, parsed.marketRegion)) {
    const { apiKey, plan } = await requireBrapiCredentials(userId);
    const matches = instrumentType === "ETF"
      ? await searchBrapiEtfTickers({ query: parsed.ticker })
      : await searchBrapiTickers({ query: parsed.ticker, subType: parsed.investmentClass === "REAL_ESTATE_FUNDS" ? "fii" : undefined });
    brapiLogoMetadata = await persistExactBrapiSearchMetadata(parsed.ticker, matches);
    brapiMatch = matches.find((match) => match.symbol === normalizeBrapiSymbol(parsed.ticker));
    if (!brapiMatch) {
      throw new Error(`${parsed.ticker} não foi identificado como um ativo válido pela brapi.`);
    }
    [brapiQuote] = await fetchBrapiQuotes({ apiKey, plan, tickers: [parsed.ticker] });
    if (!brapiQuote) throw new Error(`A brapi não retornou uma cotação para ${parsed.ticker}.`);
  }
  if (mustResolveMarketQuote && usesYahooQuotes(parsed.investmentClass, instrumentType, parsed.marketRegion)) {
    const kind = yahooSearchKind(parsed.investmentClass, instrumentType);
    const matches = await searchYahooTickers({ query: parsed.ticker, kind });
    yahooLogoMetadata = await persistExactYahooSearchMetadata(parsed.ticker, matches);
    yahooMatch = matches.find((match) => match.symbol === normalizeYahooSymbol(parsed.ticker));
    if (!yahooMatch) {
      throw new Error(`${parsed.ticker} não foi identificado como um ativo internacional válido pelo Yahoo Finance.`);
    }
    [yahooQuote] = await fetchYahooQuotes({ symbols: [yahooMatch.symbol] });
    if (!yahooQuote) throw new Error(`O Yahoo Finance não retornou uma cotação para ${parsed.ticker}.`);

    if (kind !== "ETF") {
      const profile = await fetchYahooAssetProfile({ symbol: yahooMatch.symbol });
      const sector = profile.sector ?? yahooMatch.sector;
      const industry = profile.industry ?? yahooMatch.industry;
      const status = classifyYahooReitMetadata({ sector, industry });
      if (kind === "REITS") {
        if (status === "CONTRADICTED") {
          throw new Error(`${parsed.ticker} não foi identificado como REIT pelo Yahoo Finance.`);
        }
        if (status !== "CONFIRMED" && !parsed.yahooReitConfirmed) {
          throw new Error("Confirme a classificação manual deste ativo como REIT.");
        }
      } else if (status === "CONFIRMED") {
        throw new Error(`${parsed.ticker} foi identificado como REIT. Cadastre-o na classe REITs.`);
      }
      yahooMatch = { ...yahooMatch, sector, industry, reitStatus: status, requiresReitConfirmation: status !== "CONFIRMED" };
    }

    [yahooFx] = await fetchYahooFxRates({ currencies: [yahooQuote.currency] });
    if (!yahooFx) {
      throw new Error(`O Yahoo Finance não retornou o câmbio de ${yahooQuote.currency} para BRL.`);
    }
  }
  if (mustResolveMarketQuote && usesBinanceQuotes(parsed.investmentClass, instrumentType)) {
    const matches = await searchBinanceAssets({ query: parsed.ticker });
    binanceMatch = matches.find((match) => match.symbol === parsed.ticker);
    if (!binanceMatch) {
      throw new Error(`${parsed.ticker} não foi identificado como um criptoativo válido pela Binance.`);
    }
    const result = await fetchBinanceQuotes({ assets: [parsed.ticker] });
    [binanceQuote] = result.quotes;
    if (!binanceQuote) {
      if (result.missingConversion.length) {
        throw new Error(`A Binance não retornou a conversão de ${parsed.ticker} para BRL.`);
      }
      throw new Error(`A Binance não retornou uma cotação para ${parsed.ticker}.`);
    }
  }
  const ticker = brapiQuote?.symbol ?? yahooQuote?.symbol ?? binanceQuote?.symbol ?? parsed.ticker;
  const parentData = {
    investmentClass: parsed.investmentClass as InvestmentClass,
    instrumentType,
    marketRegion: classifiesAsStoreOfValue ? parsed.marketRegion as MarketRegion : null,
    ticker,
    name: brapiQuote?.name ?? yahooQuote?.name ?? parsed.name,
    fixedIncomeFamilyCode: classifiesAsFixedIncome ? parsed.fixedIncomeFamilyCode : null,
    indexation: classifiesAsFixedIncome ? parsed.indexation as FixedIncomeIndexation : null,
    score: parsed.score,
    instrumentSource: "USER_OVERRIDE" as const,
    exposureSource: "USER_OVERRIDE" as const,
    groupSource: classifiesAsFixedIncome ? "USER_OVERRIDE" as const : "AUTO" as const,
  };
  const unitPrice = new Prisma.Decimal(
    brapiQuote?.price
      ?? yahooQuote?.price
      ?? binanceQuote?.price
      ?? existingHolding?.unitPrice
      ?? parsed.unitPrice,
  );
  const fxRateToBrl = yahooFx || binanceQuote?.fxRateToBrl
    ? new Prisma.Decimal(yahooFx?.rateToBrl ?? binanceQuote!.fxRateToBrl!)
    : existingHolding?.fxRateToBrl ?? null;
  const holdingData = {
    issuer: brapiQuote?.name ?? yahooQuote?.name ?? existingHolding?.issuer ?? parsed.name,
    productName: brapiQuote?.name ?? yahooQuote?.name ?? existingHolding?.productName ?? parsed.name,
    pricingSource: (
      brapiQuote ? "BRAPI"
        : yahooQuote ? "YAHOO"
          : binanceQuote ? "BINANCE"
            : existingHolding?.pricingSource ?? "MANUAL"
    ) as "BRAPI" | "YAHOO" | "BINANCE" | "MANUAL",
    ticker,
    providerSymbol: binanceQuote?.pair ?? binanceMatch?.pair ?? existingHolding?.providerSymbol ?? null,
    brapiAssetType: brapiMatch?.assetType ?? existingHolding?.brapiAssetType ?? null,
    brapiSubType: brapiMatch?.subType ?? existingHolding?.brapiSubType ?? null,
    marketExchange: binanceQuote ? "BINANCE" : yahooMatch?.exchange ?? yahooQuote?.exchange ?? existingHolding?.marketExchange ?? null,
    marketQuoteType: binanceQuote ? "SPOT" : yahooMatch?.quoteType ?? yahooQuote?.quoteType ?? existingHolding?.marketQuoteType ?? null,
    marketSector: yahooMatch?.sector ?? existingHolding?.marketSector ?? null,
    marketIndustry: yahooMatch?.industry ?? existingHolding?.marketIndustry ?? null,
    quantity: new Prisma.Decimal(parsed.quantity),
    unitPrice,
    fxRateToBrl,
    fxUpdatedAt: yahooFx?.asOf ?? existingHolding?.fxUpdatedAt ?? null,
    ...costData,
    currentValue: brapiQuote || yahooQuote || binanceQuote || ["BRAPI", "YAHOO", "BINANCE"].includes(existingHolding?.pricingSource ?? "") || parsed.manualValue == null ? null : new Prisma.Decimal(parsed.manualValue),
    currency: brapiQuote?.currency ?? yahooQuote?.currency ?? binanceQuote?.currency ?? existingHolding?.currency ?? parsed.currency.toUpperCase(),
    fractional: allowsFractionalUnits({
      instrumentType,
      investmentClass: parsed.investmentClass,
      pricingSource: brapiQuote ? "BRAPI"
        : yahooQuote ? "YAHOO"
          : binanceQuote ? "BINANCE"
            : existingHolding?.pricingSource,
      fallback: parsed.fractional,
    }),
    logoUrl: brapiLogoMetadata?.status === "VERIFIED"
      ? brapiLogoMetadata.logoUrl
      : yahooLogoMetadata?.status === "VERIFIED"
        ? yahooLogoMetadata.logoUrl
        : existingHolding?.logoUrl ?? null,
    priceUpdatedAt: brapiQuote?.asOf ?? yahooQuote?.asOf ?? binanceQuote?.asOf ?? existingHolding?.priceUpdatedAt ?? new Date(),
  };

  const persist = async (tx: Prisma.TransactionClient, prepared?: PreparedAssetQuantityEdits) => {
    const quantityLinks = prepared ? await validateAssetQuantityEdits(tx, userId, prepared) : null;
    let parent;
    if (parsed.id) {
      const owned = await tx.asset.findFirst({ where: { id: parsed.id, portfolio: { userId } }, select: { id: true } });
      if (!owned) throw new Error("Ativo não encontrado.");
      parent = await tx.asset.update({ where: { id: parsed.id }, data: parentData });
    } else {
      parent = await tx.asset.upsert({
        where: { portfolioId_investmentClass_ticker: { portfolioId: portfolio.id, investmentClass: parentData.investmentClass, ticker } },
        update: parentData,
        create: { ...parentData, portfolioId: portfolio.id },
      });
    }
    const pluggyControlled = await tx.assetHolding.count({
      where: { assetId: parent.id, positionSource: "PLUGGY", includedInTotals: true },
    });
    const providerControlled = await tx.assetHolding.count({
      where: { assetId: parent.id, positionSource: { in: ["PLUGGY", "BINANCE", "ACCOUNT_BALANCE"] }, includedInTotals: true },
    });
    if (pluggyControlled) {
      await tx.pluggyInvestmentDiagramLink.updateMany({
        where: {
          userId,
          holding: { assetId: parent.id },
        },
        data: {
          classificationSource: "USER_OVERRIDE",
          suggestedInstrumentType: instrumentType,
          suggestedInvestmentClass: parsed.investmentClass,
          suggestedMarketRegion: classifiesAsStoreOfValue ? parsed.marketRegion : null,
          suggestedFamilyCode: classifiesAsFixedIncome ? parsed.fixedIncomeFamilyCode : null,
          suggestedIndexation: classifiesAsFixedIncome ? parsed.indexation : null,
          reviewReason: null,
        },
      });
    }
    if (pluggyControlled && (brapiQuote || yahooQuote)) {
      const resolvedLogoUrl = brapiLogoMetadata?.status === "VERIFIED"
        ? brapiLogoMetadata.logoUrl
        : yahooLogoMetadata?.status === "VERIFIED"
          ? yahooLogoMetadata.logoUrl
          : null;
      await tx.assetHolding.updateMany({
        where: {
          assetId: parent.id,
          positionSource: "PLUGGY",
          includedInTotals: true,
        },
        data: {
          pricingSource: brapiQuote ? "BRAPI" : "YAHOO",
          unitPrice,
          currentValue: null,
          currency: brapiQuote?.currency ?? yahooQuote!.currency,
          fxRateToBrl: brapiQuote ? null : fxRateToBrl,
          fxUpdatedAt: brapiQuote ? null : yahooFx?.asOf ?? null,
          fractional: allowsFractionalUnits({
            instrumentType,
            investmentClass: parsed.investmentClass,
            pricingSource: brapiQuote ? "BRAPI" : "YAHOO",
          }),
          marketExchange: brapiQuote ? null : yahooMatch?.exchange ?? yahooQuote?.exchange ?? null,
          marketQuoteType: brapiQuote ? null : yahooMatch?.quoteType ?? yahooQuote?.quoteType ?? null,
          marketSector: brapiQuote ? null : yahooMatch?.sector ?? null,
          marketIndustry: brapiQuote ? null : yahooMatch?.industry ?? null,
          ...(resolvedLogoUrl ? { logoUrl: resolvedLogoUrl } : {}),
          priceUpdatedAt: brapiQuote?.asOf ?? yahooQuote?.asOf ?? new Date(),
        },
      });
    }
    if (!providerControlled) {
      const manualHoldings = await tx.assetHolding.findMany({
        where: {
          assetId: parent.id,
          positionSource: "MANUAL",
          includedInTotals: true,
        },
        orderBy: { createdAt: "asc" },
      });
      if (manualHoldings.length > 1) {
        const totalQuantity = manualHoldings.reduce((total, holding) => total.add(holding.quantity), new Prisma.Decimal(0));
        const totalValue = manualHoldings.reduce((total, holding) => total.add(holdingCurrentValue(holding).toString()), new Prisma.Decimal(0));
        if (!totalQuantity.equals(parsed.quantity) || parsed.investedValue !== undefined
          || (parsed.manualValue != null && !totalValue.equals(parsed.manualValue))) {
          throw new Error("Este ativo possui mais de uma posição manual. Edite as posições pelo ID da aplicação na planilha.");
        }
        // Share the asset identity and resolved quote, never aggregate position values.
        await tx.assetHolding.updateMany({
          where: { assetId: parent.id, positionSource: "MANUAL", includedInTotals: true },
          data: {
            ticker,
            fractional: holdingData.fractional,
            ...(brapiQuote || yahooQuote || binanceQuote ? {
              pricingSource: holdingData.pricingSource,
              unitPrice,
              currentValue: null,
              currency: holdingData.currency,
              fxRateToBrl: brapiQuote || binanceQuote?.currency === "BRL" ? null : fxRateToBrl,
              fxUpdatedAt: yahooFx?.asOf ?? null,
              providerSymbol: binanceQuote?.pair ?? binanceMatch?.pair ?? null,
              brapiAssetType: brapiMatch?.assetType ?? null,
              brapiSubType: brapiMatch?.subType ?? null,
              marketExchange: binanceQuote ? "BINANCE" : yahooMatch?.exchange ?? yahooQuote?.exchange ?? null,
              marketQuoteType: binanceQuote ? "SPOT" : yahooMatch?.quoteType ?? yahooQuote?.quoteType ?? null,
              marketSector: yahooMatch?.sector ?? null,
              marketIndustry: yahooMatch?.industry ?? null,
              logoUrl: brapiLogoMetadata?.status === "VERIFIED" ? brapiLogoMetadata.logoUrl
                : yahooLogoMetadata?.status === "VERIFIED" ? yahooLogoMetadata.logoUrl : null,
              priceUpdatedAt: holdingData.priceUpdatedAt,
            } : {}),
          },
        });
      } else if (manualHoldings[0]) {
        await tx.assetHolding.update({ where: { id: manualHoldings[0].id }, data: holdingData });
      } else {
        await tx.assetHolding.create({ data: { ...holdingData, assetId: parent.id } });
      }
    }
    if (prepared && quantityLinks) await applyAssetQuantityEdits(tx, prepared, quantityLinks);
  };
  if (parsed.quantityEdits?.length) {
    await withUserOperationLease({
      userId, operation: "pluggy-sync", leaseMs: 60_000,
      action: async (lease) => {
        const prepared = await prepareAssetQuantityEdits(userId, {
          id: parsed.id!, ticker, instrumentType, investmentClass: parsed.investmentClass,
          marketRegion: classifiesAsStoreOfValue ? parsed.marketRegion ?? null : null,
        }, parsed.quantityEdits!, lease.signal);
        await lease.runFencedTransaction((tx) => persist(tx, prepared));
      },
    });
    revalidatePath("/open-finance");
  } else {
    await prisma.$transaction((tx) => persist(tx));
  }
  revalidatePath("/carteira");
  revalidatePath("/home");
}

function fixedIncomeHoldingData(parsed: z.output<typeof fixedIncomeHoldingSchema>) {
  if (!parsed.catalogItemId && !parsed.customTypeName) {
    throw new Error("Selecione um tipo do catálogo ou informe um tipo personalizado.");
  }
  if (parsed.purchaseDate && parsed.maturityDate && parsed.maturityDate < parsed.purchaseDate) {
    throw new Error("O vencimento não pode ser anterior à data da compra.");
  }
  return {
    catalogItemId: parsed.catalogItemId ?? null,
    customTypeName: parsed.catalogItemId ? null : parsed.customTypeName ?? null,
    issuer: parsed.issuer,
    productName: parsed.productName,
    pricingSource: "MANUAL" as const,
    ticker: null,
    brapiAssetType: null,
    brapiSubType: null,
    currency: "BRL",
    quantity: new Prisma.Decimal(0),
    unitPrice: new Prisma.Decimal(0),
    ...investmentCostUpdate(parsed),
    currentValue: new Prisma.Decimal(parsed.currentValue),
    fractional: true,
    rateConvention: parsed.rateConvention as RateConvention | null | undefined,
    benchmark: parsed.benchmark || null,
    rateValue: parsed.rateValue == null ? null : new Prisma.Decimal(parsed.rateValue),
    purchaseDate: parsed.purchaseDate ?? null,
    maturityDate: parsed.maturityDate ?? null,
    logoUrl: null,
    priceUpdatedAt: null,
  };
}

async function assertCatalogMatchesFamily(catalogItemId: number | null | undefined, familyCode: string) {
  if (!catalogItemId) return;
  const item = await prisma.assetCatalogItem.findUnique({ where: { id: catalogItemId }, select: { familyCode: true } });
  if (!item || item.familyCode !== familyCode) throw new Error("O tipo selecionado não pertence a esta família de renda fixa.");
}

export async function saveFixedIncomeGroupAction(input: FixedIncomeGroupInput, initialHolding?: FixedIncomeHoldingInput) {
  const userId = await requireUserId();
  const parsed = fixedIncomeGroupSchema.parse(input);
  const holding = initialHolding ? fixedIncomeHoldingSchema.parse(initialHolding) : undefined;
  const portfolio = await ensurePortfolio(userId);
  const family = await prisma.fixedIncomeFamily.findUnique({ where: { code: parsed.familyCode } });
  if (!family) throw new Error("Família de renda fixa não encontrada.");
  if (holding) await assertCatalogMatchesFamily(holding.catalogItemId, family.code);
  const indexationMeta = FIXED_INCOME_INDEXATION_META[parsed.indexation];
  const ticker = `${family.shortCode}-${indexationMeta.suffix}`.toUpperCase();
  const name = `${family.name} · ${indexationMeta.label}`;

  await prisma.$transaction(async (tx) => {
    const duplicate = await tx.asset.findFirst({
      where: {
        portfolioId: portfolio.id,
        fixedIncomeFamilyCode: family.code,
        indexation: parsed.indexation as FixedIncomeIndexation,
        instrumentType: "FIXED_INCOME",
        investmentClass: parsed.investmentClass,
        ...(parsed.id ? { id: { not: parsed.id } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new Error(`Já existe o grupo ${name} nesta carteira. Edite o grupo existente.`);
    }

    let parent;
    if (parsed.id) {
      const owned = await tx.asset.findFirst({ where: { id: parsed.id, portfolio: { userId }, instrumentType: "FIXED_INCOME" } });
      if (!owned) throw new Error("Grupo de renda fixa não encontrado.");
      parent = await tx.asset.update({
        where: { id: parsed.id },
        data: {
          investmentClass: parsed.investmentClass as InvestmentClass,
          fixedIncomeFamilyCode: family.code,
          indexation: parsed.indexation as FixedIncomeIndexation,
          ticker,
          name,
          score: parsed.score,
          exposureSource: "USER_OVERRIDE",
          groupSource: "USER_OVERRIDE",
        },
      });
    } else {
      parent = await tx.asset.create({
        data: {
          portfolioId: portfolio.id,
          investmentClass: parsed.investmentClass as InvestmentClass,
          instrumentType: "FIXED_INCOME",
          ticker,
          name,
          fixedIncomeFamilyCode: family.code,
          indexation: parsed.indexation as FixedIncomeIndexation,
          score: parsed.score,
          instrumentSource: "USER_OVERRIDE",
          exposureSource: "USER_OVERRIDE",
          groupSource: "USER_OVERRIDE",
        },
      });
    }
    if (holding) await tx.assetHolding.create({ data: { ...fixedIncomeHoldingData(holding), assetId: parent.id } });
  });
  revalidatePath("/carteira");
  revalidatePath("/home");
}

export async function saveAssetHoldingAction(assetId: string, input: FixedIncomeHoldingInput) {
  const userId = await requireUserId();
  const parsed = fixedIncomeHoldingSchema.parse(input);
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, portfolio: { userId }, instrumentType: "FIXED_INCOME" },
    select: { id: true, portfolioId: true, fixedIncomeFamilyCode: true },
  });
  if (!asset?.fixedIncomeFamilyCode) throw new Error("Grupo de renda fixa não encontrado.");
  await assertCatalogMatchesFamily(parsed.catalogItemId, asset.fixedIncomeFamilyCode);
  await prisma.$transaction(async (tx) => {
    const data = fixedIncomeHoldingData(parsed);
    if (parsed.id) {
      const owned = await tx.assetHolding.findFirst({
        where: { id: parsed.id, assetId, positionSource: "MANUAL", asset: { portfolio: { userId } } },
      });
      if (!owned) throw new Error("Aplicação não encontrada.");
      await tx.assetHolding.update({ where: { id: parsed.id }, data });
    } else {
      await tx.assetHolding.create({ data: { ...data, assetId } });
    }
    await tx.asset.update({ where: { id: assetId }, data: { updatedAt: new Date() } });
  });
  revalidatePath("/carteira");
  revalidatePath("/home");
}

export async function deleteAssetHoldingAction(holdingId: string) {
  const userId = await requireUserId();
  const holding = await prisma.assetHolding.findFirst({
    where: { id: holdingId, positionSource: "MANUAL", asset: { portfolio: { userId } } },
    select: { id: true, assetId: true, asset: { select: { portfolioId: true } } },
  });
  if (!holding) throw new Error("Aplicação não encontrada.");
  await prisma.$transaction(async (tx) => {
    await tx.assetHolding.delete({ where: { id: holding.id } });
    await tx.asset.update({ where: { id: holding.assetId }, data: { updatedAt: new Date() } });
  });
  revalidatePath("/carteira");
  revalidatePath("/home");
}

const marketAssetImportSchema = assetSchema.omit({ id: true }).extend({
  holdingId: z.string().cuid().optional(),
  manualValueCurrency: z.string().trim().regex(/^[A-Za-z0-9]{3,8}$/).transform((value) => value.toUpperCase()).optional(),
  fxRateToBrl: z.coerce.number().finite().positive().optional(),
  fxUpdatedAt: z.coerce.date().nullable().optional(),
});
export type MarketAssetImportInput = z.input<typeof marketAssetImportSchema>;

const portfolioImportSchema = z.object({
  marketRows: z.array(marketAssetImportSchema).max(1000),
  fixedIncomeRows: z.array(fixedIncomeImportSchema).max(1000),
}).superRefine((value, context) => {
  const total = value.marketRows.length + value.fixedIncomeRows.length;
  if (total < 1) context.addIssue({ code: "custom", message: "A planilha não possui ativos para importar." });
  if (total > 1000) context.addIssue({ code: "custom", message: "A planilha excede o limite de 1.000 linhas." });
});

export async function importPortfolioRowsAction(input: {
  marketRows: MarketAssetImportInput[];
  fixedIncomeRows: FixedIncomeImportInput[];
}) {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "portfolio-import",
    limit: 5,
    windowMs: 60 * 60_000,
  });
  await withUserOperationLease({
    userId,
    operation: "portfolio-import",
    leaseMs: 30 * 60_000,
    action: async (lease) => {
      const parsed = portfolioImportSchema.parse(input);
      for (const row of parsed.marketRows) investmentCostUpdate(row);
      const portfolio = await lease.runFencedTransaction((tx) => tx.portfolio.upsert({
        where: { userId },
        update: {},
        create: { userId },
      }));

      if (parsed.marketRows.some((row) => (row.instrumentType ?? inferInstrumentType(row.investmentClass)) === "FIXED_INCOME")) {
        throw new Error("Renda fixa precisa ser importada com família, indexação e aplicações detalhadas.");
      }
      const fixedIncomeEtfs = parsed.marketRows.filter((row) =>
        row.instrumentType === "ETF"
        && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(row.investmentClass),
      );
      if (fixedIncomeEtfs.some((row) => !row.fixedIncomeFamilyCode || !row.indexation)) {
        throw new Error("ETFs de renda fixa precisam informar família e indexação.");
      }
      const storeOfValueEtfs = parsed.marketRows.filter((row) =>
        (row.instrumentType ?? inferInstrumentType(row.investmentClass)) === "ETF"
        && row.investmentClass === "STORE_OF_VALUE",
      );
      if (storeOfValueEtfs.some((row) => !row.marketRegion)) {
        throw new Error("ETFs de reserva de valor precisam informar o mercado nacional ou internacional.");
      }

      const familyCodes = [...new Set([
        ...parsed.fixedIncomeRows.map((row) => row.familyCode),
        ...fixedIncomeEtfs.flatMap((row) => row.fixedIncomeFamilyCode ? [row.fixedIncomeFamilyCode] : []),
      ])];
      const families = familyCodes.length
        ? await prisma.fixedIncomeFamily.findMany({ where: { code: { in: familyCodes } } })
        : [];
      const familyByCode = new Map(families.map((family) => [family.code, family]));
      if (families.length !== familyCodes.length) throw new Error("Uma ou mais famílias de renda fixa são inválidas.");

      const catalogIds = [...new Set(parsed.fixedIncomeRows.flatMap((row) =>
        row.holding.catalogItemId ? [row.holding.catalogItemId] : [],
      ))];
      const catalogItems = catalogIds.length
        ? await prisma.assetCatalogItem.findMany({
            where: { id: { in: catalogIds } },
            select: { id: true, familyCode: true },
          })
        : [];
      const catalogFamilyById = new Map(catalogItems.map((item) => [item.id, item.familyCode]));
      for (const row of parsed.fixedIncomeRows) {
        if (row.holding.catalogItemId && catalogFamilyById.get(row.holding.catalogItemId) !== row.familyCode) {
          throw new Error(`O item ${row.holding.catalogItemId} não pertence à família ${row.familyCode}.`);
        }
        fixedIncomeHoldingData(row.holding);
      }
      const explicitHoldingIds = [
        ...parsed.fixedIncomeRows.flatMap((row) => row.holding.id ? [row.holding.id] : []),
        ...parsed.marketRows.flatMap((row) => row.holdingId ? [row.holdingId] : []),
      ];
      if (new Set(explicitHoldingIds).size !== explicitHoldingIds.length) {
        throw new Error("A planilha repete o mesmo ID da aplicação em mais de uma linha.");
      }
      if (explicitHoldingIds.length) {
        const ownedHoldingCount = await prisma.assetHolding.count({
          where: {
            id: { in: explicitHoldingIds },
            positionSource: "MANUAL",
            asset: { portfolio: { userId } },
          },
        });
        if (ownedHoldingCount !== explicitHoldingIds.length) {
          throw new Error("Um ou mais IDs de aplicação não pertencem a este usuário.");
        }
      }
      const anonymousMarketRows = parsed.marketRows.filter((row) => !row.holdingId);
      if (anonymousMarketRows.length) {
        const existingAssets = await prisma.asset.findMany({
          where: {
            portfolioId: portfolio.id,
            OR: anonymousMarketRows.map((row) => ({ investmentClass: row.investmentClass, ticker: row.ticker })),
          },
          select: {
            ticker: true,
            holdings: { where: { positionSource: "MANUAL", includedInTotals: true }, select: { id: true } },
          },
        });
        const ambiguous = existingAssets.find((asset) => asset.holdings.length > 1);
        if (ambiguous) throw new Error(`${ambiguous.ticker} possui mais de uma posição manual. Informe o ID da aplicação para importar.`);
      }
      const anonymousFingerprints = new Set<string>();
      for (const row of parsed.fixedIncomeRows) {
        if (row.holding.id) continue;
        const key = `${row.investmentClass}:${row.familyCode}:${row.indexation}:${fixedIncomeHoldingFingerprint(row.holding)}`;
        if (anonymousFingerprints.has(key)) {
          throw new Error(
            `O lote contém aplicações indistinguíveis (${row.holding.productName}). Informe o ID da aplicação.`,
          );
        }
        anonymousFingerprints.add(key);
      }

  const brapiRows = parsed.marketRows.filter((row) =>
    usesBrapiQuotes(
      row.investmentClass,
      (row.instrumentType ?? inferInstrumentType(row.investmentClass)) as InstrumentType,
      row.marketRegion,
    ),
  );
  const brapiQuotes = new Map<string, BrapiQuote>();
  const brapiLogoMetadata = new Map<string, Awaited<ReturnType<typeof resolveBrapiLogo>>>();
  if (brapiRows.length) {
    const { apiKey, plan } = await requireBrapiCredentials(userId);
    const quotes = await fetchBrapiQuotes({
      apiKey,
      plan,
      tickers: brapiRows.map((row) => row.ticker),
      signal: lease.signal,
    });
    for (const quote of quotes) brapiQuotes.set(quote.requestedSymbol, quote);
    const missing = brapiRows
      .filter((row) => !brapiQuotes.has(normalizeBrapiSymbol(row.ticker)))
      .map((row) => row.ticker);
    if (missing.length) throw new Error(`A brapi não retornou cotação para: ${missing.join(", ")}.`);
    const logoMetadata = await Promise.all(
      [...new Set(brapiRows.map((row) => normalizeBrapiSymbol(row.ticker)))]
        .map((ticker) => resolveBrapiLogo(ticker)),
    );
    for (const metadata of logoMetadata) brapiLogoMetadata.set(metadata.symbol, metadata);
  }

  const yahooRows = parsed.marketRows.filter((row) =>
    usesYahooQuotes(
      row.investmentClass,
      (row.instrumentType ?? inferInstrumentType(row.investmentClass)) as InstrumentType,
      row.marketRegion,
    ),
  );
  const yahooQuotes = new Map<string, YahooQuote>();
  const yahooMetadata = new Map<string, Awaited<ReturnType<typeof searchYahooTickers>>[number]>();
  const yahooLogoMetadata = new Map<string, Awaited<ReturnType<typeof persistExactYahooSearchMetadata>>>();
  const yahooFxRates = new Map<string, Awaited<ReturnType<typeof fetchYahooFxRates>>[number]>();
  if (yahooRows.length) {
    const quotes = await fetchAvailableYahooQuotes({
      symbols: yahooRows.map((row) => row.ticker),
      signal: lease.signal,
    });
    for (const quote of quotes) yahooQuotes.set(quote.requestedSymbol, quote);
    const missing = yahooRows
      .filter((row) => !yahooQuotes.has(normalizeYahooSymbol(row.ticker)))
      .map((row) => row.ticker);
    if (missing.length) throw new Error(`O Yahoo Finance não retornou cotação para: ${missing.join(", ")}.`);

    for (const row of yahooRows) {
      const instrumentType = (row.instrumentType ?? inferInstrumentType(row.investmentClass)) as InstrumentType;
      const kind = yahooSearchKind(row.investmentClass, instrumentType);
      const matches = await searchYahooTickers({
        query: row.ticker,
        kind,
        signal: lease.signal,
      });
      const persistedLogo = await persistExactYahooSearchMetadata(row.ticker, matches);
      let match = matches.find((candidate) => candidate.symbol === normalizeYahooSymbol(row.ticker));
      if (!match) throw new Error(`${row.ticker} não foi identificado como ativo internacional válido.`);
      if (kind !== "ETF") {
        const profile = await fetchYahooAssetProfile({
          symbol: match.symbol,
          signal: lease.signal,
        });
        const sector = profile.sector ?? match.sector;
        const industry = profile.industry ?? match.industry;
        const status = classifyYahooReitMetadata({ sector, industry });
        if (kind === "REITS") {
          if (status === "CONTRADICTED" || (status !== "CONFIRMED" && !row.yahooReitConfirmed)) {
            throw new Error(`Confirme a classificação de ${row.ticker} como REIT antes de importar.`);
          }
        } else if (status === "CONFIRMED") {
          throw new Error(`${row.ticker} foi identificado como REIT. Importe-o na classe REITs.`);
        }
        match = { ...match, sector, industry, reitStatus: status, requiresReitConfirmation: status !== "CONFIRMED" };
      }
      yahooMetadata.set(match.symbol, match);
      yahooLogoMetadata.set(match.symbol, persistedLogo);
    }

    const fxRates = await fetchYahooFxRates({
      currencies: quotes.map((quote) => quote.currency),
      signal: lease.signal,
    });
    for (const rate of fxRates) yahooFxRates.set(rate.currency, rate);
    const missingFx = [...new Set(quotes.filter((quote) => !yahooFxRates.has(quote.currency)).map((quote) => quote.currency))];
    if (missingFx.length) throw new Error(`O Yahoo Finance não retornou câmbio para: ${missingFx.join(", ")}.`);
  }

  const binanceRows = parsed.marketRows.filter((row) =>
    usesBinanceQuotes(
      row.investmentClass,
      (row.instrumentType ?? inferInstrumentType(row.investmentClass)) as InstrumentType,
    ),
  );
  const binanceQuotes = new Map<string, BinanceQuote>();
  if (binanceRows.length) {
    const result = await fetchBinanceQuotes({ assets: binanceRows.map((row) => row.ticker) });
    for (const quote of result.quotes) binanceQuotes.set(quote.requestedAsset, quote);
    const missing = [...new Set([...result.missing, ...result.missingConversion])];
    if (missing.length) throw new Error(`A Binance não retornou cotação em BRL para: ${missing.join(", ")}.`);
  }

      await lease.runFencedTransaction(async (tx) => {
    for (const row of parsed.marketRows) {
      const investmentClass = row.investmentClass as InvestmentClass;
      const instrumentType = (row.instrumentType ?? inferInstrumentType(row.investmentClass)) as InstrumentType;
      const brapiQuote = brapiQuotes.get(normalizeBrapiSymbol(row.ticker));
      const brapiLogo = brapiQuote ? brapiLogoMetadata.get(brapiQuote.requestedSymbol) : undefined;
      const yahooQuote = yahooQuotes.get(normalizeYahooSymbol(row.ticker));
      const yahooMatch = yahooQuote ? yahooMetadata.get(yahooQuote.symbol) : undefined;
      const yahooLogo = yahooQuote ? yahooLogoMetadata.get(yahooQuote.symbol) : undefined;
      const resolvedImportLogoUrl = brapiLogo?.status === "VERIFIED"
        ? brapiLogo.logoUrl
        : yahooLogo?.status === "VERIFIED"
          ? yahooLogo.logoUrl
          : null;
      const yahooFx = yahooQuote ? yahooFxRates.get(yahooQuote.currency) : undefined;
      const binanceQuote = binanceQuotes.get(row.ticker);
      const ticker = brapiQuote?.symbol ?? yahooQuote?.symbol ?? binanceQuote?.symbol ?? row.ticker;
      const classifiesAsFixedIncome = instrumentType === "ETF"
        && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(row.investmentClass);
      const classifiesAsStoreOfValue = instrumentType === "ETF"
        && row.investmentClass === "STORE_OF_VALUE";
      const parentData = {
        investmentClass,
        instrumentType,
        marketRegion: classifiesAsStoreOfValue
          ? row.marketRegion as MarketRegion
          : null,
        ticker,
        name: brapiQuote?.name ?? yahooQuote?.name ?? row.name,
        score: row.score,
        fixedIncomeFamilyCode: classifiesAsFixedIncome ? row.fixedIncomeFamilyCode : null,
        indexation: classifiesAsFixedIncome ? row.indexation as FixedIncomeIndexation : null,
      };
      const parent = await tx.asset.upsert({
        where: { portfolioId_investmentClass_ticker: { portfolioId: portfolio.id, investmentClass, ticker } },
        update: parentData,
        create: { ...parentData, portfolioId: portfolio.id },
      });
      const quantity = new Prisma.Decimal(row.quantity);
      const unitPrice = new Prisma.Decimal(brapiQuote?.price ?? yahooQuote?.price ?? binanceQuote?.price ?? row.unitPrice);
      const holdingData = {
        issuer: brapiQuote?.name ?? yahooQuote?.name ?? row.name,
        productName: brapiQuote?.name ?? yahooQuote?.name ?? row.name,
        pricingSource: (
          brapiQuote ? "BRAPI" : yahooQuote ? "YAHOO" : binanceQuote ? "BINANCE" : "MANUAL"
        ) as "BRAPI" | "YAHOO" | "BINANCE" | "MANUAL",
        ticker,
        providerSymbol: binanceQuote?.pair ?? null,
        brapiAssetType: null,
        brapiSubType: null,
        marketExchange: binanceQuote ? "BINANCE" : yahooMatch?.exchange ?? yahooQuote?.exchange ?? null,
        marketQuoteType: binanceQuote ? "SPOT" : yahooMatch?.quoteType ?? yahooQuote?.quoteType ?? null,
        marketSector: yahooMatch?.sector ?? null,
        marketIndustry: yahooMatch?.industry ?? null,
        currency: brapiQuote?.currency ?? yahooQuote?.currency ?? binanceQuote?.currency ?? row.currency.toUpperCase(),
        quantity,
        unitPrice,
        fxRateToBrl: yahooFx?.rateToBrl ?? binanceQuote?.fxRateToBrl ?? null,
        fxUpdatedAt: yahooFx?.asOf ?? (binanceQuote?.fxRateToBrl ? binanceQuote.asOf : null),
        ...investmentCostUpdate(row),
        currentValue: brapiQuote || yahooQuote || binanceQuote || row.manualValue == null ? null : new Prisma.Decimal(row.manualValue),
        fractional: allowsFractionalUnits({
          instrumentType,
          investmentClass,
          pricingSource: brapiQuote ? "BRAPI"
            : yahooQuote ? "YAHOO"
              : binanceQuote ? "BINANCE"
                : "MANUAL",
          fallback: row.fractional,
        }),
        ...(resolvedImportLogoUrl ? { logoUrl: resolvedImportLogoUrl } : {}),
        priceUpdatedAt: brapiQuote?.asOf ?? yahooQuote?.asOf ?? binanceQuote?.asOf ?? new Date(),
      };
      const manualHoldings = await tx.assetHolding.findMany({
        where: {
          assetId: parent.id,
          positionSource: "MANUAL",
          includedInTotals: true,
        },
        orderBy: { createdAt: "asc" },
      });
      const existingHolding = row.holdingId
        ? manualHoldings.find((holding) => holding.id === row.holdingId)
        : manualHoldings[0];
      if (row.holdingId && !existingHolding) {
        throw new Error(`A aplicação ${row.holdingId} não pertence ao ativo informado.`);
      }
      if (!row.holdingId && manualHoldings.length > 1) {
        throw new Error(`${ticker} possui mais de uma posição manual. Informe o ID da aplicação para importar.`);
      }
      const providerControlled = await tx.assetHolding.count({
        where: {
          assetId: parent.id,
          positionSource: { not: "MANUAL" },
          includedInTotals: true,
        },
      });
      if (providerControlled) {
        throw new Error(
          `${ticker} é controlado por um provedor. Ajuste a posição no provedor em vez de importá-la manualmente.`,
        );
      }
      let manualFxData: { fxRateToBrl: Prisma.Decimal | null; fxUpdatedAt: Date | null } | undefined;
      if (!brapiQuote && !yahooQuote && !binanceQuote) {
        const currency = holdingData.currency.trim().toUpperCase();
        if (currency !== "BRL") {
          if (row.manualValue != null && row.manualValueCurrency !== currency) {
            throw new Error(`${ticker}: informe Valor atual nativo na moeda ${currency}; o Valor atual consolidado em BRL não é um saldo nativo.`);
          }
          // Preserve an omitted conversion only for an explicitly identified
          // holding in the same native currency. A new position must supply FX.
          const previousFx = row.holdingId && existingHolding?.currency === currency ? existingHolding : null;
          const rate = row.fxRateToBrl === undefined ? previousFx?.fxRateToBrl : new Prisma.Decimal(row.fxRateToBrl);
          if (!rate?.isFinite() || !rate.gt(0)) {
            throw new Error(`${ticker}: informe um câmbio para BRL válido para a posição manual em ${currency}.`);
          }
          manualFxData = {
            fxRateToBrl: rate,
            fxUpdatedAt: row.fxUpdatedAt !== undefined
              ? row.fxUpdatedAt : row.fxRateToBrl === undefined ? previousFx?.fxUpdatedAt ?? null : null,
          };
        } else {
          manualFxData = { fxRateToBrl: null, fxUpdatedAt: null };
        }
      }
      const savedHoldingData = { ...holdingData, ...manualFxData };
      if (existingHolding) {
        await tx.assetHolding.update({ where: { id: existingHolding.id }, data: savedHoldingData });
      } else {
        await tx.assetHolding.create({ data: { ...savedHoldingData, assetId: parent.id } });
      }
    }

    for (const row of parsed.fixedIncomeRows) {
      const family = familyByCode.get(row.familyCode)!;
      const indexation = row.indexation as FixedIncomeIndexation;
      const meta = FIXED_INCOME_INDEXATION_META[row.indexation];
      const ticker = `${family.shortCode}-${meta.suffix}`.toUpperCase();
      const name = `${family.name} · ${meta.label}`;
      const existing = await tx.asset.findFirst({
        where: {
          portfolioId: portfolio.id,
          fixedIncomeFamilyCode: family.code,
          indexation,
          instrumentType: "FIXED_INCOME",
          investmentClass: row.investmentClass,
        },
      });
      if (
        existing
        && (
          existing.investmentClass !== row.investmentClass
          || existing.score !== row.score
        )
      ) {
        throw new Error(
          `O grupo ${name} já existe com outra classe ou nota. Edite o grupo existente antes de importar aplicações.`,
        );
      }
      const parent = existing ?? await tx.asset.create({
        data: {
          portfolioId: portfolio.id,
          investmentClass: row.investmentClass as InvestmentClass,
          instrumentType: "FIXED_INCOME",
          ticker,
          name,
          fixedIncomeFamilyCode: family.code,
          indexation,
          score: row.score,
        },
      });
      const activeHoldings = await tx.assetHolding.findMany({
        where: {
          assetId: parent.id,
          includedInTotals: true,
        },
        select: {
          id: true,
          positionSource: true,
          catalogItemId: true,
          customTypeName: true,
          issuer: true,
          productName: true,
          purchaseDate: true,
          maturityDate: true,
        },
      });
      const duplicatedProviderHolding = activeHoldings.some((holding) =>
        holding.positionSource === "PLUGGY"
        &&
        normalizedText(holding.issuer) === normalizedText(row.holding.issuer)
        && normalizedText(holding.productName) === normalizedText(row.holding.productName)
        && holding.purchaseDate?.getTime() === row.holding.purchaseDate?.getTime()
        && holding.maturityDate?.getTime() === row.holding.maturityDate?.getTime(),
      );
      if (duplicatedProviderHolding) {
        throw new Error(
          `${row.holding.productName} já é controlado pela Pluggy e não pode ser duplicado pela importação.`,
        );
      }
      const fingerprint = fixedIncomeHoldingFingerprint(row.holding);
      const matchingManual = activeHoldings.filter((holding) =>
        holding.positionSource === "MANUAL"
        && fixedIncomeHoldingFingerprint(holding) === fingerprint,
      );
      const holdingData = fixedIncomeHoldingData(row.holding);
      if (row.holding.id) {
        const explicit = activeHoldings.find((holding) =>
          holding.id === row.holding.id && holding.positionSource === "MANUAL",
        );
        if (!explicit) {
          throw new Error(`A aplicação ${row.holding.id} não pertence ao grupo informado.`);
        }
        await tx.assetHolding.update({
          where: { id: explicit.id },
          data: holdingData,
        });
      } else if (matchingManual.length === 1) {
        await tx.assetHolding.update({
          where: { id: matchingManual[0].id },
          data: holdingData,
        });
      } else if (matchingManual.length > 1) {
        throw new Error(
          `Há mais de uma aplicação compatível com ${row.holding.productName}. Informe o ID da aplicação.`,
        );
      } else {
        await tx.assetHolding.create({
          data: { ...holdingData, assetId: parent.id },
        });
      }
    }

      }, { timeout: 120_000 });
      revalidatePath("/carteira");
      revalidatePath("/home");
    },
  });
}

export async function deleteAssetAction(assetId: string) {
  const userId = await requireUserId();
  const asset = await assertOwnedAsset(userId, assetId);
  await withUserOperationLease({ userId, operation: "pluggy-sync", leaseMs: 60_000, action: (lease) => lease.runFencedTransaction(async (tx) => {
    const accountLinks = await tx.accountInvestmentLink.findMany({ where: { assetHolding: { assetId: asset.id }, account: { userId } } });
    for (const link of accountLinks) await setAccountInvestmentPreference(tx, userId, link.accountId, false);
    const projectedLinks = await tx.pluggyInvestmentDiagramLink.findMany({
      where: { userId, holding: { assetId: asset.id }, contributionBatches: { some: { state: { in: ["WAITING", "CONFLICT"] } } } },
      select: { id: true },
    });
    for (const link of projectedLinks) await resolveContributionQuantity(tx, link.id, "USER_REMOVED");
    await tx.pluggyInvestmentDiagramLink.updateMany({
      where: { holding: { assetId: asset.id } },
      data: reopenDeletedPluggyPositionForReview(
        asset,
        PLUGGY_DIAGRAM_REVIEW_REASON.ASSET_DELETE,
      ),
    });
    await tx.binanceWalletAsset.updateMany({
      where: { holding: { assetId: asset.id } },
      data: { holdingId: null, status: "AVAILABLE" },
    });
    await tx.pendingContribution.deleteMany({ where: { assetId: asset.id } });
    await tx.asset.delete({ where: { id: asset.id } });
  }) });
  revalidatePath("/carteira");
  revalidatePath("/home");
  revalidatePath("/open-finance");
}

export async function deleteAssetClassAction(investmentClass: InvestmentClassKey) {
  const userId = await requireUserId();
  const parsedClass = investmentClassSchema.parse(investmentClass) as InvestmentClass;
  const portfolio = await ensurePortfolio(userId);
  await withUserOperationLease({ userId, operation: "pluggy-sync", leaseMs: 60_000, action: (lease) => lease.runFencedTransaction(async (tx) => {
    const assets = await tx.asset.findMany({
      where: { portfolioId: portfolio.id, investmentClass: parsedClass },
      select: {
        id: true,
        instrumentType: true,
        investmentClass: true,
        marketRegion: true,
        indexation: true,
      },
    });
    for (const asset of assets) {
      const accountLinks = await tx.accountInvestmentLink.findMany({ where: { assetHolding: { assetId: asset.id }, account: { userId } } });
      for (const link of accountLinks) await setAccountInvestmentPreference(tx, userId, link.accountId, false);
      const projectedLinks = await tx.pluggyInvestmentDiagramLink.findMany({
        where: { userId, holding: { assetId: asset.id }, contributionBatches: { some: { state: { in: ["WAITING", "CONFLICT"] } } } },
        select: { id: true },
      });
      for (const link of projectedLinks) await resolveContributionQuantity(tx, link.id, "USER_REMOVED");
      await tx.pluggyInvestmentDiagramLink.updateMany({
        where: { holding: { assetId: asset.id } },
        data: reopenDeletedPluggyPositionForReview(
          asset,
          PLUGGY_DIAGRAM_REVIEW_REASON.CLASS_DELETE,
        ),
      });
    }
    await tx.binanceWalletAsset.updateMany({
      where: { holding: { assetId: { in: assets.map((asset) => asset.id) } } },
      data: { holdingId: null, status: "AVAILABLE" },
    });
    await tx.pendingContribution.deleteMany({ where: { assetId: { in: assets.map((asset) => asset.id) } } });
    await tx.asset.deleteMany({ where: { portfolioId: portfolio.id, investmentClass: parsedClass } });
  }) });
  revalidatePath("/carteira");
  revalidatePath("/home");
  revalidatePath("/open-finance");
}

export async function saveBrapiApiKeyAction(input: string, planInput: BrapiPlan = "FREE") {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "brapi-credential-validation",
    limit: 10,
    windowMs: 60 * 60_000,
  });
  const apiKey = brapiApiKeySchema.parse(input);
  const plan = brapiPlanSchema.parse(planInput);
  await fetchBrapiQuotes({ apiKey, plan, tickers: ["WEGE3"] });
  const status = await storeBrapiApiKey(userId, apiKey, plan);
  revalidatePath("/carteira");
  revalidatePath("/configuracoes");
  return status;
}

export async function saveBrapiPlanAction(input: BrapiPlan) {
  const userId = await requireUserId();
  const plan = brapiPlanSchema.parse(input);
  const status = await storeBrapiPlan(userId, plan);
  revalidatePath("/configuracoes");
  return status;
}

export async function searchBrapiTickersAction(input: string, kind: InvestmentClassKey | "ETF") {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "market-search",
    limit: 120,
    windowMs: 60_000,
  });
  const query = tickerSearchSchema.parse(input);
  const parsedKind = brapiSearchKindSchema.parse(kind);
  const results = parsedKind !== "ETF"
    ? await searchBrapiTickers({ query, subType: parsedKind === "REAL_ESTATE_FUNDS" ? "fii" : undefined })
    : await searchBrapiEtfTickers({ query });
  await persistExactBrapiSearchMetadata(query, results);
  return results;
}

export async function searchYahooTickersAction(input: string, kind: YahooSearchKind) {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "market-search",
    limit: 120,
    windowMs: 60_000,
  });
  const query = tickerSearchSchema.parse(input);
  const results = await searchYahooTickers({ query, kind: yahooSearchKindSchema.parse(kind) });
  await persistExactYahooSearchMetadata(query, results);
  return results;
}

export async function resolveAssetLogoAction(input: {
  assetId: string;
  failedLogoUrls?: string[];
}) {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "market-logo-resolution",
    limit: 120,
    windowMs: 60 * 60_000,
  });
  const parsed = assetLogoRepairSchema.parse(input);
  const asset = await prisma.asset.findFirst({
    where: { id: parsed.assetId, portfolio: { userId } },
    select: {
      ticker: true,
      investmentClass: true,
      instrumentType: true,
      marketRegion: true,
    },
  });
  if (!asset) throw new Error("Ativo não encontrado.");

  const persistResolvedLogo = async (logoUrl: string | null) => {
    if (!logoUrl) return null;
    await prisma.assetHolding.updateMany({
      where: {
        assetId: parsed.assetId,
        OR: [
          { logoUrl: null },
          ...(parsed.failedLogoUrls.length
            ? [{ logoUrl: { in: parsed.failedLogoUrls } }]
            : []),
        ],
      },
      data: { logoUrl },
    });
    revalidatePath("/carteira");
    return logoUrl;
  };

  if (usesBrapiQuotes(
    asset.investmentClass as InvestmentClassKey,
    asset.instrumentType,
    asset.marketRegion,
  )) {
    const metadata = await resolveBrapiLogo(asset.ticker, parsed.failedLogoUrls);
    return persistResolvedLogo(metadata.status === "VERIFIED" ? metadata.logoUrl : null);
  }
  if (usesYahooQuotes(
    asset.investmentClass as InvestmentClassKey,
    asset.instrumentType,
    asset.marketRegion,
  )) {
    const metadata = await resolveYahooLogo(
      asset.ticker,
      yahooSearchKind(asset.investmentClass as InvestmentClassKey, asset.instrumentType),
      parsed.failedLogoUrls,
    );
    return persistResolvedLogo(metadata.status === "VERIFIED" ? metadata.logoUrl : null);
  }
  return null;
}

export async function searchBinanceAssetsAction(input: string) {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "market-search",
    limit: 120,
    windowMs: 60_000,
  });
  const query = tickerSearchSchema.parse(input);
  return searchBinanceAssets({ query });
}

export async function removeBrapiApiKeyAction() {
  const userId = await requireUserId();
  await clearBrapiApiKey(userId);
  revalidatePath("/carteira");
  revalidatePath("/configuracoes");
}

export type ProviderRefreshResult = {
  requested: number;
  updated: number;
  missing: string[];
  error: string | null;
};

export type MarketRefreshResult = {
  updated: number;
  brapi: ProviderRefreshResult;
  yahoo: ProviderRefreshResult & { missingFx: string[] };
  binance: ProviderRefreshResult & { missingConversion: string[] };
};

export type AutomaticMarketRefreshResult = {
  status: "SKIPPED" | "UPDATED" | "PARTIAL" | "FAILED";
  changed: boolean;
  appliedFromCache: number;
  result: MarketRefreshResult | null;
  message: string | null;
};

async function findMarketHoldings(portfolioId: string) {
  return prisma.assetHolding.findMany({
    where: {
      asset: { portfolioId },
      ticker: { not: null },
      includedInTotals: true,
    },
    select: {
      id: true,
      ticker: true,
      providerSymbol: true,
      currentValue: true,
      logoUrl: true,
      pricingSource: true,
      currency: true,
      positionSource: true,
      fractional: true,
      priceUpdatedAt: true,
      asset: { select: { id: true, instrumentType: true, investmentClass: true, marketRegion: true } },
    },
  });
}

type MarketHolding = Awaited<ReturnType<typeof findMarketHoldings>>[number];

function partitionMarketHoldings(holdings: MarketHolding[]) {
  return {
    brapi: holdings.filter((holding) =>
      usesBrapiQuotes(
        holding.asset.investmentClass as InvestmentClassKey,
        holding.asset.instrumentType,
        holding.asset.marketRegion,
      ),
    ),
    yahoo: holdings.filter((holding) =>
      usesYahooQuotes(
        holding.asset.investmentClass as InvestmentClassKey,
        holding.asset.instrumentType,
        holding.asset.marketRegion,
      ),
    ),
    binance: holdings.filter((holding) =>
      usesBinanceQuotes(
        holding.asset.investmentClass as InvestmentClassKey,
        holding.asset.instrumentType,
      ),
    ),
  };
}

function newestDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

async function applyFreshSharedMarketCache({
  userId,
  holdings,
  lease,
  now,
}: {
  userId: string;
  holdings: MarketHolding[];
  lease: UserOperationLeaseContext;
  now: Date;
}) {
  const groups = partitionMarketHoldings(holdings);
  const brapiCacheAllowed = await requireBrapiApiKey(userId).then(() => true).catch(() => false);
  const [brapiCache, yahooCache, binancePairCache] = await Promise.all([
    brapiCacheAllowed
      ? readCachedBrapiQuotes(groups.brapi.flatMap((holding) => holding.ticker ? [holding.ticker] : []))
      : Promise.resolve(new Map()),
    readCachedYahooQuotes(groups.yahoo.flatMap((holding) => holding.ticker ? [holding.ticker] : [])),
    readCachedBinancePairPrices([
      ...groups.binance.flatMap((holding) => holding.providerSymbol ? [holding.providerSymbol] : []),
      ...(groups.binance.some((holding) => holding.providerSymbol?.toUpperCase().endsWith("USDT"))
        ? ["USDTBRL"]
        : []),
    ]),
  ]);
  const yahooCurrencies = [...new Set([...yahooCache.values()].map((entry) => entry.quote.currency))];
  const yahooFxSymbols = yahooCurrencies.flatMap((currency) => {
    const symbol = yahooFxSymbol(currency);
    return symbol ? [symbol] : [];
  });
  const yahooFxCache = await readCachedYahooQuotes(yahooFxSymbols);
  const effectiveUpdatedAt = new Map(holdings.map((holding) => [holding.id, holding.priceUpdatedAt]));
  const brapiUpdates: Array<{
    holding: MarketHolding;
    cachedAt: Date;
    quote: BrapiQuote;
  }> = [];
  const yahooUpdates: Array<{
    holding: MarketHolding;
    cachedAt: Date;
    quote: YahooQuote;
    fxRateToBrl: number;
    fxUpdatedAt: Date | null;
  }> = [];
  const binanceUpdates: Array<{
    holding: MarketHolding;
    cachedAt: Date;
    price: number;
    currency: string;
    fxRateToBrl: number | null;
  }> = [];

  for (const holding of groups.brapi) {
    if (!holding.ticker) continue;
    const cached = brapiCache.get(normalizeBrapiSymbol(holding.ticker));
    if (!cached || isAutomaticRefreshStale(cached.cachedAt, now)) continue;
    effectiveUpdatedAt.set(holding.id, newestDate(effectiveUpdatedAt.get(holding.id) ?? null, cached.cachedAt));
    if (!holding.priceUpdatedAt || cached.cachedAt > holding.priceUpdatedAt) {
      brapiUpdates.push({ holding, cachedAt: cached.cachedAt, quote: cached.quote });
    }
  }

  for (const holding of groups.yahoo) {
    if (!holding.ticker) continue;
    const cached = yahooCache.get(normalizeYahooSymbol(holding.ticker));
    if (!cached) continue;
    const fxSymbol = yahooFxSymbol(cached.quote.currency);
    const cachedFx = fxSymbol ? yahooFxCache.get(fxSymbol) : null;
    const fxRateToBrl = cached.quote.currency === "BRL" ? 1 : cachedFx?.quote.price;
    if (fxRateToBrl == null) continue;
    const cachedAt = cachedFx
      ? new Date(Math.min(cached.cachedAt.getTime(), cachedFx.cachedAt.getTime()))
      : cached.cachedAt;
    if (isAutomaticRefreshStale(cachedAt, now)) continue;
    effectiveUpdatedAt.set(holding.id, newestDate(effectiveUpdatedAt.get(holding.id) ?? null, cachedAt));
    if (!holding.priceUpdatedAt || cachedAt > holding.priceUpdatedAt) {
      yahooUpdates.push({
        holding,
        cachedAt,
        quote: cached.quote,
        fxRateToBrl,
        fxUpdatedAt: cachedFx?.cachedAt ?? null,
      });
    }
  }

  for (const holding of groups.binance) {
    const pair = holding.providerSymbol?.trim().toUpperCase();
    if (!pair) continue;
    const cached = binancePairCache.get(pair);
    if (!cached) continue;
    const usesUsdt = pair.endsWith("USDT");
    const cachedFx = usesUsdt ? binancePairCache.get("USDTBRL") : null;
    if (usesUsdt && !cachedFx) continue;
    const cachedAt = cachedFx
      ? new Date(Math.min(cached.cachedAt.getTime(), cachedFx.cachedAt.getTime()))
      : cached.cachedAt;
    if (isAutomaticRefreshStale(cachedAt, now)) continue;
    effectiveUpdatedAt.set(holding.id, newestDate(effectiveUpdatedAt.get(holding.id) ?? null, cachedAt));
    if (!holding.priceUpdatedAt || cachedAt > holding.priceUpdatedAt) {
      binanceUpdates.push({
        holding,
        cachedAt,
        price: cached.price,
        currency: usesUsdt ? "USDT" : "BRL",
        fxRateToBrl: cachedFx?.price ?? null,
      });
    }
  }

  const applied = brapiUpdates.length + yahooUpdates.length + binanceUpdates.length;
  if (applied) {
    await lease.runFencedTransaction(async (tx) => {
      for (const { holding, quote, cachedAt } of brapiUpdates) {
        await tx.assetHolding.update({
          where: { id: holding.id },
          data: {
            pricingSource: "BRAPI",
            unitPrice: quote.price,
            currentValue: null,
            fractional: false,
            currency: quote.currency,
            fxRateToBrl: null,
            fxUpdatedAt: null,
            priceUpdatedAt: cachedAt,
          },
        });
      }
      for (const { holding, quote, cachedAt, fxRateToBrl, fxUpdatedAt } of yahooUpdates) {
        await tx.assetHolding.update({
          where: { id: holding.id },
          data: {
            pricingSource: "YAHOO",
            unitPrice: quote.price,
            currentValue: null,
            fractional: allowsFractionalUnits({
              instrumentType: holding.asset.instrumentType,
              investmentClass: holding.asset.investmentClass,
              pricingSource: "YAHOO",
              fallback: holding.fractional,
            }),
            currency: quote.currency,
            fxRateToBrl,
            fxUpdatedAt,
            marketExchange: quote.exchange,
            marketQuoteType: quote.quoteType,
            priceUpdatedAt: cachedAt,
          },
        });
      }
      for (const { holding, cachedAt, price, currency, fxRateToBrl } of binanceUpdates) {
        await tx.assetHolding.update({
          where: { id: holding.id },
          data: {
            pricingSource: "BINANCE",
            unitPrice: price,
            currentValue: null,
            fractional: true,
            currency,
            fxRateToBrl,
            fxUpdatedAt: fxRateToBrl ? cachedAt : null,
            marketExchange: "BINANCE",
            marketQuoteType: "SPOT",
            priceUpdatedAt: cachedAt,
          },
        });
      }
    }, { timeout: 120_000 });
  }

  return {
    applied,
    stale: shouldRefreshMarketHoldings(
      holdings.map((holding) => ({
        priceUpdatedAt: effectiveUpdatedAt.get(holding.id) ?? null,
      })),
      now,
    ),
  };
}

async function refreshMarketPricesForUser(
  userId: string,
  lease?: UserOperationLeaseContext,
): Promise<MarketRefreshResult> {
  const portfolio = lease
    ? await lease.runFencedTransaction((tx) => tx.portfolio.upsert({
        where: { userId },
        update: {},
        create: { userId },
      }))
    : await ensurePortfolio(userId);
  const holdings = await findMarketHoldings(portfolio.id);
  const marketGroups = partitionMarketHoldings(holdings);
  const brapiHoldings = marketGroups.brapi;
  const yahooHoldings = marketGroups.yahoo;
  const binanceHoldings = marketGroups.binance;
  const refreshedAt = new Date();

  const [brapiSettled, yahooSettled, binanceSettled] = await Promise.allSettled([
    (async () => {
      if (!brapiHoldings.length) {
        return {
          quotes: [] as BrapiQuote[],
        };
      }
      const { apiKey, plan } = await requireBrapiCredentials(userId);
      const quotes = await fetchAvailableBrapiQuotes({
        apiKey,
        plan,
        tickers: brapiHoldings.flatMap((holding) => holding.ticker ? [holding.ticker] : []),
        signal: lease?.signal,
        cacheMode: "REFRESH",
      });
      return { quotes };
    })(),
    (async () => {
      if (!yahooHoldings.length) {
        return {
          quotes: [] as YahooQuote[],
          fxRates: [] as Awaited<ReturnType<typeof fetchYahooFxRates>>,
        };
      }
      const quotes = await fetchAvailableYahooQuotes({
        symbols: yahooHoldings.flatMap((holding) => holding.ticker ? [holding.ticker] : []),
        signal: lease?.signal,
        cacheMode: "REFRESH",
      });
      const fxRates = await fetchYahooFxRates({
        currencies: quotes.map((quote) => quote.currency),
        signal: lease?.signal,
        cacheMode: "REFRESH",
      });
      return { quotes, fxRates };
    })(),
    (async () => {
      if (!binanceHoldings.length) {
        return { quotes: [] as BinanceQuote[], missing: [] as string[], missingConversion: [] as string[] };
      }
      return fetchBinanceQuotes({
        assets: binanceHoldings.flatMap((holding) => holding.ticker ? [holding.ticker] : []),
        cacheMode: "REFRESH",
      });
    })(),
  ]);

  const brapiError = brapiSettled.status === "rejected"
    ? brapiSettled.reason instanceof Error ? brapiSettled.reason.message : "Não foi possível atualizar a B3."
    : null;
  const yahooError = yahooSettled.status === "rejected"
    ? yahooSettled.reason instanceof Error ? yahooSettled.reason.message : "Não foi possível atualizar os ativos internacionais."
    : null;
  const binanceError = binanceSettled.status === "rejected"
    ? binanceSettled.reason instanceof Error ? binanceSettled.reason.message : "Não foi possível atualizar as criptomoedas."
    : null;

  const brapiQuotes = brapiSettled.status === "fulfilled" ? brapiSettled.value.quotes : [];
  const yahooQuotes = yahooSettled.status === "fulfilled" ? yahooSettled.value.quotes : [];
  const yahooFxRates = yahooSettled.status === "fulfilled" ? yahooSettled.value.fxRates : [];
  const binanceQuotes = binanceSettled.status === "fulfilled" ? binanceSettled.value.quotes : [];
  const brapiQuotesBySymbol = new Map(brapiQuotes.map((quote) => [quote.requestedSymbol, quote]));
  const yahooQuotesBySymbol = new Map(yahooQuotes.map((quote) => [quote.requestedSymbol, quote]));
  const yahooFxByCurrency = new Map(yahooFxRates.map((rate) => [rate.currency, rate]));
  const binanceQuotesByAsset = new Map(binanceQuotes.map((quote) => [quote.requestedAsset, quote]));

  const brapiUpdates = brapiHoldings.flatMap((holding) => {
    const quote = holding.ticker ? brapiQuotesBySymbol.get(normalizeBrapiSymbol(holding.ticker)) : undefined;
    return quote ? [{ holding, quote }] : [];
  });
  const yahooUpdates = yahooHoldings.flatMap((holding) => {
    const quote = holding.ticker ? yahooQuotesBySymbol.get(normalizeYahooSymbol(holding.ticker)) : undefined;
    const fx = quote ? yahooFxByCurrency.get(quote.currency) : undefined;
    return quote && fx ? [{ holding, quote, fx }] : [];
  });
  const binanceUpdates = binanceHoldings.flatMap((holding) => {
    const quote = holding.ticker ? binanceQuotesByAsset.get(holding.ticker.trim().toUpperCase()) : undefined;
    return quote ? [{ holding, quote }] : [];
  });

  if (brapiUpdates.length || yahooUpdates.length || binanceUpdates.length) {
    const updateQuotes = async (tx: Prisma.TransactionClient) => {
      for (const { holding, quote } of brapiUpdates) {
        await tx.assetHolding.update({
          where: { id: holding.id },
          data: {
            pricingSource: "BRAPI",
            unitPrice: quote.price,
            currentValue: null,
            fractional: holding.asset.instrumentType === "CRYPTO",
            currency: quote.currency,
            fxRateToBrl: null,
            fxUpdatedAt: null,
            priceUpdatedAt: refreshedAt,
          },
        });
      }
      for (const { holding, quote, fx } of yahooUpdates) {
        await tx.assetHolding.update({
          where: { id: holding.id },
          data: {
            pricingSource: "YAHOO",
            unitPrice: quote.price,
            currentValue: null,
            fractional: allowsFractionalUnits({
              instrumentType: holding.asset.instrumentType,
              investmentClass: holding.asset.investmentClass,
              pricingSource: "YAHOO",
              fallback: holding.fractional,
            }),
            currency: quote.currency,
            fxRateToBrl: fx.rateToBrl,
            fxUpdatedAt: fx.asOf,
            marketExchange: quote.exchange,
            marketQuoteType: quote.quoteType,
            priceUpdatedAt: refreshedAt,
          },
        });
      }
      for (const { holding, quote } of binanceUpdates) {
        await tx.assetHolding.update({
          where: { id: holding.id },
          data: {
            pricingSource: "BINANCE",
            providerSymbol: quote.pair,
            unitPrice: quote.price,
            currentValue: null,
            fractional: true,
            currency: quote.currency,
            fxRateToBrl: quote.fxRateToBrl,
            fxUpdatedAt: quote.fxRateToBrl ? quote.asOf : null,
            marketExchange: "BINANCE",
            marketQuoteType: "SPOT",
            priceUpdatedAt: refreshedAt,
          },
        });
      }
    };
    if (lease) await lease.runFencedTransaction(updateQuotes, { timeout: 120_000 });
    else await prisma.$transaction(updateQuotes, { timeout: 120_000 });
  }

  const brapiMissing = brapiHoldings.flatMap((holding) =>
    holding.ticker && !brapiQuotesBySymbol.has(normalizeBrapiSymbol(holding.ticker)) ? [holding.ticker] : [],
  );
  const yahooMissing = yahooHoldings.flatMap((holding) =>
    holding.ticker && !yahooQuotesBySymbol.has(normalizeYahooSymbol(holding.ticker)) ? [holding.ticker] : [],
  );
  const yahooMissingFx = [...new Set(yahooQuotes
    .filter((quote) => !yahooFxByCurrency.has(quote.currency))
    .map((quote) => quote.currency))];
  const binanceMissing = binanceSettled.status === "fulfilled"
    ? binanceSettled.value.missing
    : binanceHoldings.flatMap((holding) => holding.ticker ? [holding.ticker] : []);
  const binanceMissingConversion = binanceSettled.status === "fulfilled"
    ? binanceSettled.value.missingConversion
    : [];

  revalidatePath("/carteira");
  revalidatePath("/home");
  return {
    updated: brapiUpdates.length + yahooUpdates.length + binanceUpdates.length,
    brapi: {
      requested: brapiHoldings.length,
      updated: brapiUpdates.length,
      missing: [...new Set(brapiMissing)],
      error: brapiError,
    },
    yahoo: {
      requested: yahooHoldings.length,
      updated: yahooUpdates.length,
      missing: [...new Set(yahooMissing)],
      missingFx: yahooMissingFx,
      error: yahooError,
    },
    binance: {
      requested: binanceHoldings.length,
      updated: binanceUpdates.length,
      missing: [...new Set(binanceMissing)],
      missingConversion: [...new Set(binanceMissingConversion)],
      error: binanceError,
    },
  };
}

export async function refreshMarketPricesAction(): Promise<MarketRefreshResult> {
  const userId = await requireUserId();
  await assertUserOperationRateLimit({
    userId,
    operation: "market-refresh",
    limit: 6,
    windowMs: 10 * 60_000,
  });
  const startedAt = Date.now();
  const result = await withUserOperationLease({
    userId,
    operation: "market-refresh",
    leaseMs: 2 * 60_000,
    action: (lease) => refreshMarketPricesForUser(userId, lease),
  });
  logIntegrationRefresh({
    event: "market-refresh",
    user: anonymizedUserId(userId),
    reason: "MANUAL",
    durationMs: Date.now() - startedAt,
    requested: {
      brapi: result.brapi.requested,
      yahoo: result.yahoo.requested,
      binance: result.binance.requested,
    },
    updated: result.updated,
    failedProviders: [
      result.brapi.error ? "brapi" : null,
      result.yahoo.error ? "yahoo" : null,
      result.binance.error ? "binance" : null,
    ].filter(Boolean),
  });
  return result;
}

export async function refreshStaleMarketPricesAction(): Promise<AutomaticMarketRefreshResult> {
  const userId = await requireUserId();
  return withUserOperationLease({
    userId,
    operation: "market-refresh",
    leaseMs: 2 * 60_000,
    action: async (lease) => {
      const portfolio = await lease.runFencedTransaction((tx) => tx.portfolio.upsert({
        where: { userId },
        update: {},
        create: { userId },
      }));
      const allHoldings = await findMarketHoldings(portfolio.id);
      const groups = partitionMarketHoldings(allHoldings);
      const holdings = [...new Map(
        [...groups.brapi, ...groups.yahoo, ...groups.binance].map((holding) => [holding.id, holding]),
      ).values()];
      if (!holdings.length) {
        return {
          status: "SKIPPED",
          changed: false,
          appliedFromCache: 0,
          result: null,
          message: null,
        };
      }
      const cache = await applyFreshSharedMarketCache({
        userId,
        holdings,
        lease,
        now: new Date(),
      });
      if (!cache.stale) {
        if (cache.applied) {
          revalidatePath("/carteira");
          revalidatePath("/home");
        }
        return {
          status: cache.applied ? "UPDATED" : "SKIPPED",
          changed: cache.applied > 0,
          appliedFromCache: cache.applied,
          result: null,
          message: null,
        };
      }
      const result = await refreshMarketPricesForUser(userId, lease);
      const failedProviders = [result.brapi, result.yahoo, result.binance]
        .filter((provider) => provider.requested > 0 && provider.error);
      const requested = result.brapi.requested + result.yahoo.requested + result.binance.requested;
      const changed = cache.applied + result.updated > 0;
      return {
        status: failedProviders.length
          ? changed ? "PARTIAL" : "FAILED"
          : result.updated < requested ? "PARTIAL" : "UPDATED",
        changed,
        appliedFromCache: cache.applied,
        result,
        message: failedProviders.length
          ? failedProviders.map((provider) => provider.error).filter(Boolean).join(" ")
          : null,
      };
    },
  });
}

export async function saveInvestmentTargetsAction(values: Record<InvestmentClassKey, number>) {
  const userId = await requireUserId();
  const parsed = z.record(investmentClassSchema, z.number().min(0).max(100).refine(
    (value) => targetPercentageCents(value) !== null,
    "As metas precisam usar no máximo duas casas decimais.",
  )).parse(values);
  if (investmentTargetsTotalCents(parsed) !== 10_000) throw new Error("As metas precisam totalizar 100%.");
  await prisma.$transaction(async (tx) => {
    for (const investmentClass of INVESTMENT_CLASSES) {
      await tx.investmentTarget.upsert({
        where: { userId_investmentClass: { userId, investmentClass: investmentClass as InvestmentClass } },
        update: { percentage: parsed[investmentClass] ?? 0 },
        create: { userId, investmentClass: investmentClass as InvestmentClass, percentage: parsed[investmentClass] ?? 0 },
      });
    }
  });
  revalidatePath("/carteira");
}

export async function calculateContributionAction(
  value: number,
  currency: "BRL" | "USD" = "BRL",
  scope: ContributionScopeKey = "ALL_ASSETS",
  budgetPolicy: BudgetPolicy = "TARGET_CAPPED",
) {
  const userId = await requireUserId();
  const inputAmount = z.number().positive().max(100_000_000).refine(
    (amount) => new Prisma.Decimal(amount.toString()).decimalPlaces() <= 2,
    "O valor do aporte precisa usar no máximo duas casas decimais.",
  ).parse(value);
  const inputCurrency = contributionCurrencySchema.parse(currency);
  const allocationScope = contributionScopeSchema.parse(scope);
  const policy = z.enum(BUDGET_POLICIES).parse(budgetPolicy);
  if (!isContributionScopeValid(inputCurrency, allocationScope)) {
    throw new Error(`O filtro de ativos selecionado não é válido para aportes em ${inputCurrency}.`);
  }
  let fxRateToBrl = new Prisma.Decimal(1);
  let fxUpdatedAt: Date | null = null;
  let fxSource: "NATIVE" | "YAHOO" = "NATIVE";
  if (inputCurrency === "USD") {
    const symbol = yahooFxSymbol("USD")!;
    const cached = await readCachedYahooQuotes([symbol]);
    const cachedRate = cached.get(symbol);
    const [fx] = await fetchYahooFxRates({
      currencies: ["USD"],
      cacheMode: isAutomaticRefreshStale(cachedRate?.cachedAt) ? "REFRESH" : "USE_CACHE",
    });
    if (!fx || !Number.isFinite(fx.rateToBrl) || fx.rateToBrl <= 0) {
      throw new Error("Não foi possível obter a cotação atual USD/BRL para calcular o aporte.");
    }
    fxRateToBrl = new Prisma.Decimal(fx.rateToBrl);
    fxUpdatedAt = fx.asOf;
    fxSource = "YAHOO";
  }
  const contribution = new Prisma.Decimal(inputAmount.toString()).mul(fxRateToBrl);
  const portfolio = await getPortfolioData(userId);
  const result = await calculateContribution({
    contribution,
    budgetPolicy: policy,
    capEligibleClassesAtTarget: allocationScope !== "ALL_ASSETS",
    targets: portfolio.targets,
    assets: portfolio.assets.map((asset) => ({
      id: asset.id,
      ticker: asset.ticker,
      name: asset.name,
      investmentClass: asset.investmentClass,
      currentValue: asset.currentValue,
      quantity: asset.quantity,
      unitPrice: asset.unitPrice,
      score: asset.score,
      fractional: asset.fractional,
      instrumentType: asset.instrumentType,
      sourceOrder: asset.sourceOrder,
      eligibleToReceive: assetCanReceiveContribution(asset, allocationScope),
    })),
  }, portfolio.allocationMethod, userId);

  const assetsById = new Map(portfolio.assets.map((asset) => [asset.id, asset]));

  const suggestions = result.suggestions.map((suggestion) => {
    const asset = assetsById.get(suggestion.assetId)!;
    const nativeCurrency = asset.nativeCurrency ?? null;
    const nativeUnitPrice = asset.nativeUnitPrice ? new Prisma.Decimal(asset.nativeUnitPrice) : null;
    const assetFxRate = asset.fxRateToBrl ? new Prisma.Decimal(asset.fxRateToBrl) : null;
    return {
      assetId: asset.id, ticker: asset.ticker, name: asset.name,
      investmentClass: asset.investmentClass as InvestmentClassKey, instrumentType: asset.instrumentType,
      quantity: suggestion.quantity.toDecimalPlaces(10).toString(),
      value: suggestion.value.toDecimalPlaces(10).toString(),
      nativeCurrency, nativeUnitPrice: nativeUnitPrice?.toString() ?? null,
      nativeValue: asset.instrumentType === "FIXED_INCOME" && nativeCurrency && assetFxRate?.gt(0)
        ? suggestion.value.div(assetFxRate.toString()).toDecimalPlaces(10).toString()
        : nativeCurrency && nativeUnitPrice ? suggestion.quantity.mul(nativeUnitPrice.toString()).toDecimalPlaces(10).toString() : null,
      fxRateToBrl: assetFxRate?.toString() ?? null, paidUnitPriceNative: null,
      suggestionPercentage: suggestion.suggestionPercentage.toString(),
      totalAfterSuggestionPercentage: suggestion.totalAfterSuggestionPercentage.toString(),
    };
  });

  return {
    allocationMethod: portfolio.allocationMethod,
    assetSnapshot: result.suggestions.map((suggestion) => assetsById.get(suggestion.assetId)!),
    calculation: result.calculation, budgetPolicy: policy,
    inputAmount: inputAmount.toString(), inputCurrency, allocationScope,
    requestedAmount: contribution.toString(), unallocatedAmount: result.unallocatedAmount.toString(),
    unallocatedInputAmount: result.unallocatedAmount.div(fxRateToBrl.toString()).toString(),
    fxRateToBrl: fxRateToBrl.toString(), fxUpdatedAt: fxUpdatedAt?.toISOString() ?? null, fxSource,
    suggestions: sortContributionSuggestions(suggestions),
  };
}

export async function recordContributionAction(input: {
  assetId: string; quantity: number; paidUnitPrice?: number; holdingId?: string;
  newHolding?: FixedIncomeHoldingInput; fxRateToBrl?: number | null; expectedHoldingQuantity?: string;
}) {
  const userId = await requireUserId();
  const parsed = z.object({
    assetId: z.string().cuid(), holdingId: z.string().cuid().optional(),
    quantity: z.number().finite().positive().max(1e9).refine((value) => new Prisma.Decimal(value.toString()).decimalPlaces() <= 10, "Informe até dez casas decimais."),
    paidUnitPrice: z.number().finite().positive().max(1e9).optional(),
    fxRateToBrl: z.number().finite().positive().max(1e9).nullable().optional(),
    expectedHoldingQuantity: z.string().max(64).refine((value) => {
      try {
        const quantity = new Prisma.Decimal(value);
        return quantity.isFinite() && quantity.gte(0) && quantity.decimalPlaces() <= 10;
      } catch { return false; }
    }, "Informe uma quantidade válida para a posição exibida.").optional(),
    newHolding: fixedIncomeHoldingSchema.optional(),
  }).parse(input);
  const result = await withUserOperationLease({ userId, operation: "pluggy-sync", leaseMs: 60_000, action: (lease) => lease.runFencedTransaction(async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: parsed.assetId, portfolio: { userId } }, include: { holdings: true } });
    if (!asset) throw new Error("O ativo não está mais disponível nesta carteira.");
    const fixed = asset.instrumentType === "FIXED_INCOME";
    if (!fixed && parsed.paidUnitPrice === undefined) throw new Error("Informe o preço unitário pago para registrar o aporte.");
    let holding = parsed.holdingId ? asset.holdings.find((row) => row.id === parsed.holdingId) : undefined;
    if (parsed.holdingId && !holding) throw new Error("Selecione a posição e a instituição deste ativo.");
    if (!holding && parsed.newHolding && fixed) {
      const catalog = parsed.newHolding.catalogItemId ? await tx.assetCatalogItem.findUnique({ where: { id: parsed.newHolding.catalogItemId } }) : null;
      if (parsed.newHolding.catalogItemId && catalog?.familyCode !== asset.fixedIncomeFamilyCode) throw new Error("O tipo selecionado não pertence a esta família de renda fixa.");
      holding = await tx.assetHolding.create({ data: { ...fixedIncomeHoldingData(parsed.newHolding), assetId: asset.id } });
    }
    const external = asset.holdings.filter((row) => row.includedInTotals && row.positionSource !== "MANUAL");
    if (!holding && !fixed) {
      if (external.some((row) => row.positionSource === "PLUGGY") && external.length > 1) throw new Error("Selecione a posição e a instituição que receberam o aporte.");
      holding = external[0] ?? asset.holdings.find((row) => row.includedInTotals && row.positionSource === "MANUAL");
    }
    if (!holding) throw new Error("Selecione ou crie uma aplicação para registrar o aporte.");
    const quantity = new Prisma.Decimal(parsed.quantity.toString());
    const nativePrice = parsed.paidUnitPrice === undefined ? null : new Prisma.Decimal(parsed.paidUnitPrice.toString());
    const fx = holding.currency === "BRL" ? new Prisma.Decimal(1) : new Prisma.Decimal(parsed.fxRateToBrl ?? holding.fxRateToBrl ?? 0);
    if (!fx.gt(0)) throw new Error("A posição não possui câmbio válido para registrar o aporte.");
    const value = fixed ? quantity : quantity.mul(nativePrice!).mul(fx);
    if (holding.positionSource !== "MANUAL") {
      if (!fixed && holding.positionSource === "PLUGGY" && CONTRIBUTION_UNIT_TYPES.includes(asset.instrumentType)) {
        if (parsed.expectedHoldingQuantity === undefined || !holding.quantity.eq(parsed.expectedHoldingQuantity)) {
          return { error: "A quantidade desta posição mudou. Confira a posição antes de registrar a compra." };
        }
        const validation = await registerContributionQuantity(tx, { userId, assetId: asset.id, holdingId: holding.id, quantity, paidUnitPrice: nativePrice! });
        if (validation) return validation;
        return { awaitingSync: true };
      }
      const destinations = fixed || parsed.holdingId ? [holding] : external;
      const links = await tx.pluggyInvestmentDiagramLink.findMany({ where: { userId, assetHoldingId: { in: destinations.map((row) => row.id) } },
        include: { investment: { include: { transactions: { orderBy: { date: "desc" }, take: 1 } } } } });
      const baselines = destinations.map((row) => {
        const investment = links.find((link) => link.assetHoldingId === row.id)?.investment;
        return { holdingId: row.id, quantity: row.positionSource === "PLUGGY" ? investment?.quantity ?? new Prisma.Decimal(0) : row.quantity,
          providerValue: row.providerCurrentValue ?? row.currentValue, currency: row.currency,
          fxRateToBrl: row.currency === "BRL" ? new Prisma.Decimal(1) : row.fxRateToBrl,
          providerLatestTransactionAt: investment?.transactions[0]?.date ?? null };
      });
      if (await tx.pendingContribution.count({ where: { assetId: asset.id } })) throw new Error("Este ativo já possui um aporte aguardando confirmação do provedor.");
      await tx.pendingContribution.create({ data: {
        userId, assetId: asset.id, holdingId: destinations.length === 1 ? holding.id : null,
        quantity, value, paidUnitPrice: nativePrice?.mul(fx), paidUnitPriceNative: nativePrice,
        nativeCurrency: holding.currency === "BRL" ? null : holding.currency,
        nativeValue: holding.currency === "BRL" ? null : fixed ? quantity.div(fx) : quantity.mul(nativePrice!),
        fxRateToBrl: fx, executionFxRateToBrl: fx,
        baselineQuantity: baselines.reduce((total, row) => total.add(row.quantity), new Prisma.Decimal(0)),
        baselineValue: baselines.reduce((total, row) => total.add(row.providerValue ?? 0), new Prisma.Decimal(0)),
        baselines: serializeContributionBaselines(baselines),
      } });
      return { awaitingSync: true };
    }
    const additions = new Map([["BRL", value]]);
    if (holding.currency !== "BRL") additions.set(holding.currency, fixed ? quantity.div(fx) : quantity.mul(nativePrice!));
    const cost = addInvestmentCost({ investedValue: holding.investedValue, investedValueCurrency: holding.investedValueCurrency,
      hasPriorPosition: (fixed ? holding.currentValue ?? holding.quantity.mul(holding.unitPrice) : holding.quantity).gt(0), additions });
    await tx.assetHolding.update({ where: { id: holding.id }, data: { ...cost,
      ...(fixed ? { currentValue: (holding.currentValue ?? holding.quantity.mul(holding.unitPrice)).add(value) }
        : { quantity: { increment: quantity }, ...(holding.currentValue !== null ? { currentValue: holding.currentValue.add(value) } : {}) }),
    } });
    await tx.asset.update({ where: { id: asset.id }, data: { updatedAt: new Date() } });
    return { awaitingSync: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) });
  if ("error" in result) return result;
  revalidatePath("/carteira"); revalidatePath("/home"); revalidatePath("/open-finance");
  return result;
}
export async function saveAwaitingContributionPriceAction(pendingId: string, paidUnitPrice: number) {
  const userId = await requireUserId();
  const id = z.string().cuid().parse(pendingId);
  const price = new Prisma.Decimal(z.number().finite().positive().max(1e9).parse(paidUnitPrice).toString());
  await withUserOperationLease({ userId, operation: "pluggy-sync", leaseMs: 60_000, action: (lease) => lease.runFencedTransaction(async (tx) => {
    const pending = await tx.pendingContribution.findFirst({ where: { id, userId } });
    if (!pending) throw new Error("Este aporte não está mais aguardando sincronização.");
    const fx = pending.nativeCurrency ? pending.executionFxRateToBrl ?? pending.fxRateToBrl : new Prisma.Decimal(1);
    if (!fx?.gt(0)) throw new Error("O aporte não possui câmbio válido.");
    await tx.pendingContribution.update({ where: { id }, data: { paidUnitPrice: price.mul(fx), paidUnitPriceNative: pending.nativeCurrency ? price : null,
      value: pending.quantity.mul(price).mul(fx), nativeValue: pending.nativeCurrency ? pending.quantity.mul(price) : null } });
    await refreshContributionQuantityCost(tx, id);
  }) });
  revalidatePath("/carteira");
}

export async function reviewAwaitingContributionAction(input: { pendingId: string; decision: "PROVIDER" | "PROJECT"; holdingId?: string; expectedQuantity?: number }) {
  const userId = await requireUserId();
  const parsed = z.object({ pendingId: z.string().cuid(), decision: z.enum(["PROVIDER", "PROJECT"]), holdingId: z.string().cuid().optional(), expectedQuantity: z.number().finite().min(0).max(1e15).optional() }).parse(input);
  await withUserOperationLease({ userId, operation: "pluggy-sync", leaseMs: 60_000, action: (lease) => lease.runFencedTransaction(async (tx) => {
    await reviewPendingContribution(tx, { ...parsed, userId, expectedQuantity: parsed.expectedQuantity === undefined ? undefined : new Prisma.Decimal(parsed.expectedQuantity.toString()) });

  }) });
  revalidatePath("/carteira"); revalidatePath("/open-finance"); revalidatePath("/home");
}


async function recomputeScoresForQuestionType(
  tx: Prisma.TransactionClient,
  userId: string,
  type: DiagramType,
) {
  const portfolio = await tx.portfolio.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!portfolio) return;
  const assets = await tx.asset.findMany({
    where: {
      portfolioId: portfolio.id,
      instrumentType: {
        in: type === "CERRADO"
          ? ["STOCK"]
          : ["REAL_ESTATE_FUND", "REIT"],
      },
      investmentClass: {
        in: type === "CERRADO"
          ? ["BRAZILIAN_STOCKS", "INTERNATIONAL_STOCKS"]
          : ["REAL_ESTATE_FUNDS", "REITS"],
      },
    },
    select: {
      id: true,
      answers: {
        where: {
          question: {
            userId,
            type,
            active: true,
          },
        },
        select: { answer: true },
      },
    },
  });
  for (const asset of assets) {
    const score = calculateDiagramScore(asset.answers.map((answer) => answer.answer));
    await tx.asset.update({ where: { id: asset.id }, data: { score } });
  }
}

export async function createQuestionAction(input: { type: DiagramType; criterion: string; text: string }) {
  const userId = await requireUserId();
  const parsed = z.object({
    type: z.enum(["CERRADO", "REAL_ESTATE"]),
    criterion: z.string().trim().min(2).max(80).transform((value) => value.toUpperCase()),
    text: z.string().trim().min(5).max(240),
  }).parse(input);
  await prisma.$transaction(async (tx) => {
    const sortOrder = await tx.diagramQuestion.count({ where: { userId, type: parsed.type } });
    await tx.diagramQuestion.create({
      data: {
        userId,
        type: parsed.type,
        criterion: parsed.criterion,
        text: parsed.text,
        sortOrder,
      },
    });
    await recomputeScoresForQuestionType(tx, userId, parsed.type);
  });
  revalidatePath("/carteira");
}

export async function deleteQuestionAction(questionId: string) {
  const userId = await requireUserId();
  await prisma.$transaction(async (tx) => {
    const question = await tx.diagramQuestion.findFirst({ where: { id: questionId, userId } });
    if (!question) throw new Error("Pergunta não encontrada.");
    if (question.templateKey) {
      await tx.assetQuestionAnswer.deleteMany({ where: { questionId: question.id } });
      await tx.diagramQuestion.update({ where: { id: question.id }, data: { active: false } });
    } else {
      await tx.diagramQuestion.delete({ where: { id: question.id } });
    }
    await recomputeScoresForQuestionType(tx, userId, question.type);
  });
  revalidatePath("/carteira");
}

export async function updateQuestionAction(questionId: string, input: { criterion?: string; text?: string; active?: boolean }) {
  const userId = await requireUserId();
  const parsed = z.object({
    criterion: z.string().trim().min(2).max(80).transform((value) => value.toUpperCase()).optional(),
    text: z.string().trim().min(5).max(240).optional(),
    active: z.boolean().optional(),
  }).refine((value) => value.criterion !== undefined || value.text !== undefined || value.active !== undefined).parse(input);
  await prisma.$transaction(async (tx) => {
    const question = await tx.diagramQuestion.findFirst({ where: { id: questionId, userId } });
    if (!question) throw new Error("Pergunta não encontrada.");
    await tx.diagramQuestion.update({ where: { id: question.id }, data: parsed });
    if (questionChangeAffectsAllocation(question.active, parsed)) {
      await recomputeScoresForQuestionType(tx, userId, question.type);
    }
  });
  revalidatePath("/carteira");
}

async function replaceQuestionsWithModel(userId: string, type: DiagramType) {
  const model = DEFAULT_QUESTIONS.filter((question) => question.type === type);
  await prisma.$transaction(async (tx) => {
    await tx.diagramQuestion.deleteMany({ where: { userId, type } });
    await tx.diagramQuestion.createMany({
      data: model.map((question, sortOrder) => ({
        userId,
        type,
        criterion: question.criterion,
        text: question.text,
        sortOrder,
        templateKey: defaultQuestionTemplateKey(question),
      })),
    });
    await recomputeScoresForQuestionType(tx, userId, type);
  });
  revalidatePath("/carteira");
}

export async function resetQuestionsAction(type: DiagramType) {
  const userId = await requireUserId();
  await replaceQuestionsWithModel(userId, z.enum(["CERRADO", "REAL_ESTATE"]).parse(type));
}

export async function useQuestionModelAction(type: DiagramType) {
  const userId = await requireUserId();
  await replaceQuestionsWithModel(userId, z.enum(["CERRADO", "REAL_ESTATE"]).parse(type));
}

export async function saveAssetAnswersAction(assetId: string, answers: Record<string, boolean>) {
  const userId = await requireUserId();
  const asset = await assertOwnedAsset(userId, assetId);
  const questionIds = Object.keys(answers);
  const questions = await prisma.diagramQuestion.findMany({
    where: { id: { in: questionIds }, active: true, OR: [{ userId: null }, { userId }] },
    select: { id: true },
  });
  const validIds = new Set(questions.map((question) => question.id));
  const validAnswers = Object.entries(answers).filter(([questionId]) => validIds.has(questionId));
  const score = calculateDiagramScore(validAnswers.map(([, answer]) => answer));
  await prisma.$transaction(async (tx) => {
    for (const [questionId, answer] of validAnswers) {
      await tx.assetQuestionAnswer.upsert({
        where: { assetId_questionId: { assetId, questionId } },
        update: { answer },
        create: { assetId, questionId, answer },
      });
    }
    await tx.asset.update({ where: { id: asset.id }, data: { score } });
  });
  revalidatePath("/carteira");
}
