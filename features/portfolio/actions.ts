"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type DiagramType, type FixedIncomeIndexation, type InstrumentType, type InvestmentClass, type RateConvention } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/current-user";
import { allocateContribution } from "./allocation";
import { applyManualFixedIncomeContribution } from "./asset-groups";
import { fetchAvailableBrapiQuotes, fetchBrapiQuotes, normalizeBrapiSymbol, searchBrapiEtfTickers, searchBrapiTickers, type BrapiQuote } from "./brapi";
import { clearBrapiApiKey, requireBrapiApiKey, storeBrapiApiKey } from "./brapi-credentials";
import { ensurePortfolio, getPortfolioData } from "./data";
import { FIXED_INCOME_INDEXATIONS, INSTRUMENT_TYPES, INVESTMENT_CLASSES, RATE_CONVENTIONS, FIXED_INCOME_INDEXATION_META, type InvestmentClassKey } from "./constants";
import { DEFAULT_QUESTIONS } from "./questions";
import {
  classifyYahooReitMetadata,
  fetchAvailableYahooQuotes,
  fetchYahooAssetProfile,
  fetchYahooFxRates,
  fetchYahooQuotes,
  normalizeYahooSymbol,
  searchYahooTickers,
  type YahooQuote,
  type YahooSearchKind,
} from "./yahoo-finance";

const investmentClassSchema = z.enum(INVESTMENT_CLASSES);
const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES);
const assetSchema = z.object({
  id: z.string().cuid().optional(),
  investmentClass: investmentClassSchema,
  instrumentType: instrumentTypeSchema.optional(),
  ticker: z.string().trim().min(1).max(24).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  quantity: z.coerce.number().min(0),
  unitPrice: z.coerce.number().min(0),
  manualValue: z.coerce.number().min(0).nullable().optional(),
  currency: z.string().trim().length(3).default("BRL"),
  fractional: z.boolean().default(false),
  score: z.coerce.number().int().min(-30).max(30).default(0),
  fixedIncomeFamilyCode: z.string().trim().min(2).max(80).nullable().optional(),
  indexation: z.enum(FIXED_INCOME_INDEXATIONS).nullable().optional(),
  yahooReitConfirmed: z.boolean().default(false),
});

export type AssetInput = z.input<typeof assetSchema>;

const fixedIncomeHoldingSchema = z.object({
  id: z.string().cuid().optional(),
  catalogItemId: z.coerce.number().int().positive().nullable().optional(),
  customTypeName: z.string().trim().min(2).max(120).nullable().optional(),
  issuer: z.string().trim().min(2).max(120),
  productName: z.string().trim().min(2).max(160),
  investedValue: z.coerce.number().min(0).nullable().optional(),
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
  holding: fixedIncomeHoldingSchema.omit({ id: true }),
});

export type FixedIncomeImportInput = z.input<typeof fixedIncomeImportSchema>;

const brapiApiKeySchema = z.string()
  .trim()
  .transform((value) => value.replace(/^Bearer\s+/i, ""))
  .pipe(z.string().min(8, "Informe uma chave válida da brapi.").max(2000));

const tickerSearchSchema = z.string().trim().min(1).max(60);
const brapiSearchKindSchema = z.enum(["BRAZILIAN_STOCKS", "REAL_ESTATE_FUNDS", "ETF"]);
const yahooSearchKindSchema = z.enum(["INTERNATIONAL_STOCKS", "REITS", "ETF"]);

function inferInstrumentType(investmentClass: InvestmentClassKey): InstrumentType {
  if (investmentClass === "REAL_ESTATE_FUNDS") return "REAL_ESTATE_FUND";
  if (investmentClass === "REITS") return "REIT";
  if (investmentClass === "CRYPTO") return "CRYPTO";
  if (investmentClass === "FIXED_INCOME" || investmentClass === "INTERNATIONAL_FIXED_INCOME") return "FIXED_INCOME";
  return "STOCK";
}

function usesBrapiQuotes(investmentClass: InvestmentClassKey, instrumentType?: InstrumentType) {
  if (instrumentType === "ETF") {
    return !["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(investmentClass);
  }
  return investmentClass === "BRAZILIAN_STOCKS" || investmentClass === "REAL_ESTATE_FUNDS";
}

function usesYahooQuotes(investmentClass: InvestmentClassKey, instrumentType?: InstrumentType) {
  return ["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(investmentClass)
    && ["STOCK", "REIT", "ETF"].includes(instrumentType ?? "");
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
  const parsed = assetSchema.parse(input);
  const portfolio = await ensurePortfolio(userId);
  const instrumentType = (parsed.instrumentType ?? inferInstrumentType(parsed.investmentClass)) as InstrumentType;
  if (instrumentType === "FIXED_INCOME") {
    throw new Error("Use o cadastro de grupo de renda fixa.");
  }
  const classifiesAsFixedIncome = instrumentType === "ETF" && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(parsed.investmentClass);
  if (classifiesAsFixedIncome && (!parsed.fixedIncomeFamilyCode || !parsed.indexation)) {
    throw new Error("Selecione o grupo e a indexação do ETF de renda fixa.");
  }
  if (classifiesAsFixedIncome) {
    const familyExists = await prisma.fixedIncomeFamily.count({ where: { code: parsed.fixedIncomeFamilyCode! } });
    if (!familyExists) throw new Error("Grupo de renda fixa não encontrado.");
  }
  const existingHolding = parsed.id ? await prisma.assetHolding.findFirst({
    where: { assetId: parsed.id, asset: { portfolio: { userId } } },
    orderBy: { createdAt: "asc" },
  }) : null;
  if (parsed.id && !existingHolding) throw new Error("Posição do ativo não encontrada.");
  let brapiQuote: BrapiQuote | undefined;
  let brapiMatch: Awaited<ReturnType<typeof searchBrapiTickers>>[number] | undefined;
  let yahooQuote: YahooQuote | undefined;
  let yahooMatch: Awaited<ReturnType<typeof searchYahooTickers>>[number] | undefined;
  let yahooFx: Awaited<ReturnType<typeof fetchYahooFxRates>>[number] | undefined;
  if (!parsed.id && usesBrapiQuotes(parsed.investmentClass, instrumentType)) {
    const apiKey = await requireBrapiApiKey(userId);
    const matches = instrumentType === "ETF"
      ? await searchBrapiEtfTickers({ query: parsed.ticker })
      : await searchBrapiTickers({ query: parsed.ticker, subType: parsed.investmentClass === "REAL_ESTATE_FUNDS" ? "fii" : undefined });
    brapiMatch = matches.find((match) => match.symbol === normalizeBrapiSymbol(parsed.ticker));
    if (!brapiMatch) {
      throw new Error(`${parsed.ticker} não foi identificado como um ativo válido pela brapi.`);
    }
    [brapiQuote] = await fetchBrapiQuotes({ apiKey, tickers: [parsed.ticker] });
    if (!brapiQuote) throw new Error(`A brapi não retornou uma cotação para ${parsed.ticker}.`);
  }
  if (!parsed.id && usesYahooQuotes(parsed.investmentClass, instrumentType)) {
    const kind = yahooSearchKind(parsed.investmentClass, instrumentType);
    const matches = await searchYahooTickers({ query: parsed.ticker, kind });
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
  const ticker = brapiQuote?.symbol ?? yahooQuote?.symbol ?? parsed.ticker;
  const parentData = {
    investmentClass: parsed.investmentClass as InvestmentClass,
    instrumentType,
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
      ?? existingHolding?.unitPrice
      ?? parsed.unitPrice,
  );
  const quantity = new Prisma.Decimal(parsed.quantity);
  const fxRateToBrl = yahooFx
    ? new Prisma.Decimal(yahooFx.rateToBrl)
    : existingHolding?.fxRateToBrl ?? null;
  const effectiveUnitPrice = yahooQuote && fxRateToBrl ? unitPrice.mul(fxRateToBrl) : unitPrice;
  const holdingData = {
    issuer: brapiQuote?.name ?? yahooQuote?.name ?? existingHolding?.issuer ?? parsed.name,
    productName: brapiQuote?.name ?? yahooQuote?.name ?? existingHolding?.productName ?? parsed.name,
    pricingSource: (brapiQuote ? "BRAPI" : yahooQuote ? "YAHOO" : existingHolding?.pricingSource ?? "MANUAL") as "BRAPI" | "YAHOO" | "MANUAL",
    ticker: brapiQuote?.symbol ?? yahooQuote?.symbol ?? existingHolding?.ticker ?? ticker,
    brapiAssetType: brapiMatch?.assetType ?? existingHolding?.brapiAssetType ?? null,
    brapiSubType: brapiMatch?.subType ?? existingHolding?.brapiSubType ?? null,
    marketExchange: yahooMatch?.exchange ?? yahooQuote?.exchange ?? existingHolding?.marketExchange ?? null,
    marketQuoteType: yahooMatch?.quoteType ?? yahooQuote?.quoteType ?? existingHolding?.marketQuoteType ?? null,
    marketSector: yahooMatch?.sector ?? existingHolding?.marketSector ?? null,
    marketIndustry: yahooMatch?.industry ?? existingHolding?.marketIndustry ?? null,
    quantity: new Prisma.Decimal(parsed.quantity),
    unitPrice,
    fxRateToBrl,
    fxUpdatedAt: yahooFx?.asOf ?? existingHolding?.fxUpdatedAt ?? null,
    investedValue: existingHolding?.investedValue ?? (parsed.manualValue == null ? quantity.mul(effectiveUnitPrice) : new Prisma.Decimal(parsed.manualValue)),
    currentValue: brapiQuote || yahooQuote || ["BRAPI", "YAHOO"].includes(existingHolding?.pricingSource ?? "") || parsed.manualValue == null ? null : new Prisma.Decimal(parsed.manualValue),
    currency: brapiQuote?.currency ?? yahooQuote?.currency ?? existingHolding?.currency ?? parsed.currency.toUpperCase(),
    fractional: instrumentType === "ETF" ? false : yahooQuote ? true : parsed.fractional,
    logoUrl: brapiMatch?.logoUrl ?? brapiQuote?.logoUrl ?? yahooQuote?.logoUrl ?? existingHolding?.logoUrl ?? null,
    priceUpdatedAt: brapiQuote?.asOf ?? yahooQuote?.asOf ?? existingHolding?.priceUpdatedAt ?? new Date(),
  };

  await prisma.$transaction(async (tx) => {
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
    if (!pluggyControlled) {
      const existingHolding = await tx.assetHolding.findFirst({
        where: { assetId: parent.id, positionSource: "MANUAL" },
        orderBy: { createdAt: "asc" },
      });
      if (existingHolding) await tx.assetHolding.update({ where: { id: existingHolding.id }, data: holdingData });
      else await tx.assetHolding.create({ data: { ...holdingData, assetId: parent.id } });
    }
    await tx.portfolio.update({ where: { id: portfolio.id }, data: { version: { increment: 1 } } });
  });
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
    investedValue: parsed.investedValue == null ? null : new Prisma.Decimal(parsed.investedValue),
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
      const existing = await tx.asset.findFirst({
        where: { portfolioId: portfolio.id, fixedIncomeFamilyCode: family.code, indexation: parsed.indexation as FixedIncomeIndexation, instrumentType: "FIXED_INCOME" },
      });
      parent = existing ? await tx.asset.update({
        where: { id: existing.id },
        data: {
          investmentClass: parsed.investmentClass as InvestmentClass,
          ticker,
          name,
          score: parsed.score,
          exposureSource: "USER_OVERRIDE",
          groupSource: "USER_OVERRIDE",
        },
      }) : await tx.asset.create({
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
    await tx.portfolio.update({ where: { id: portfolio.id }, data: { version: { increment: 1 } } });
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
    await tx.portfolio.update({ where: { id: asset.portfolioId }, data: { version: { increment: 1 } } });
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
    await tx.portfolio.update({ where: { id: holding.asset.portfolioId }, data: { version: { increment: 1 } } });
  });
  revalidatePath("/carteira");
  revalidatePath("/home");
}

const portfolioImportSchema = z.object({
  marketRows: z.array(assetSchema.omit({ id: true })).max(1000),
  fixedIncomeRows: z.array(fixedIncomeImportSchema).max(1000),
}).superRefine((value, context) => {
  const total = value.marketRows.length + value.fixedIncomeRows.length;
  if (total < 1) context.addIssue({ code: "custom", message: "A planilha não possui ativos para importar." });
  if (total > 1000) context.addIssue({ code: "custom", message: "A planilha excede o limite de 1.000 linhas." });
});

export async function importPortfolioRowsAction(input: {
  marketRows: AssetInput[];
  fixedIncomeRows: FixedIncomeImportInput[];
}) {
  const userId = await requireUserId();
  const parsed = portfolioImportSchema.parse(input);
  const portfolio = await ensurePortfolio(userId);

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

  const brapiRows = parsed.marketRows.filter((row) =>
    usesBrapiQuotes(
      row.investmentClass,
      (row.instrumentType ?? inferInstrumentType(row.investmentClass)) as InstrumentType,
    ),
  );
  const brapiQuotes = new Map<string, BrapiQuote>();
  if (brapiRows.length) {
    const apiKey = await requireBrapiApiKey(userId);
    const quotes = await fetchBrapiQuotes({ apiKey, tickers: brapiRows.map((row) => row.ticker) });
    for (const quote of quotes) brapiQuotes.set(quote.requestedSymbol, quote);
    const missing = brapiRows
      .filter((row) => !brapiQuotes.has(normalizeBrapiSymbol(row.ticker)))
      .map((row) => row.ticker);
    if (missing.length) throw new Error(`A brapi não retornou cotação para: ${missing.join(", ")}.`);
  }

  const yahooRows = parsed.marketRows.filter((row) =>
    usesYahooQuotes(
      row.investmentClass,
      (row.instrumentType ?? inferInstrumentType(row.investmentClass)) as InstrumentType,
    ),
  );
  const yahooQuotes = new Map<string, YahooQuote>();
  const yahooMetadata = new Map<string, Awaited<ReturnType<typeof searchYahooTickers>>[number]>();
  const yahooFxRates = new Map<string, Awaited<ReturnType<typeof fetchYahooFxRates>>[number]>();
  if (yahooRows.length) {
    const quotes = await fetchAvailableYahooQuotes({ symbols: yahooRows.map((row) => row.ticker) });
    for (const quote of quotes) yahooQuotes.set(quote.requestedSymbol, quote);
    const missing = yahooRows
      .filter((row) => !yahooQuotes.has(normalizeYahooSymbol(row.ticker)))
      .map((row) => row.ticker);
    if (missing.length) throw new Error(`O Yahoo Finance não retornou cotação para: ${missing.join(", ")}.`);

    for (const row of yahooRows) {
      const instrumentType = (row.instrumentType ?? inferInstrumentType(row.investmentClass)) as InstrumentType;
      const kind = yahooSearchKind(row.investmentClass, instrumentType);
      const matches = await searchYahooTickers({ query: row.ticker, kind });
      let match = matches.find((candidate) => candidate.symbol === normalizeYahooSymbol(row.ticker));
      if (!match) throw new Error(`${row.ticker} não foi identificado como ativo internacional válido.`);
      if (kind !== "ETF") {
        const profile = await fetchYahooAssetProfile({ symbol: match.symbol });
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
    }

    const fxRates = await fetchYahooFxRates({ currencies: quotes.map((quote) => quote.currency) });
    for (const rate of fxRates) yahooFxRates.set(rate.currency, rate);
    const missingFx = [...new Set(quotes.filter((quote) => !yahooFxRates.has(quote.currency)).map((quote) => quote.currency))];
    if (missingFx.length) throw new Error(`O Yahoo Finance não retornou câmbio para: ${missingFx.join(", ")}.`);
  }

  await prisma.$transaction(async (tx) => {
    for (const row of parsed.marketRows) {
      const investmentClass = row.investmentClass as InvestmentClass;
      const instrumentType = (row.instrumentType ?? inferInstrumentType(row.investmentClass)) as InstrumentType;
      const brapiQuote = brapiQuotes.get(normalizeBrapiSymbol(row.ticker));
      const yahooQuote = yahooQuotes.get(normalizeYahooSymbol(row.ticker));
      const yahooMatch = yahooQuote ? yahooMetadata.get(yahooQuote.symbol) : undefined;
      const yahooFx = yahooQuote ? yahooFxRates.get(yahooQuote.currency) : undefined;
      const ticker = brapiQuote?.symbol ?? yahooQuote?.symbol ?? row.ticker;
      const classifiesAsFixedIncome = instrumentType === "ETF"
        && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(row.investmentClass);
      const parentData = {
        investmentClass,
        instrumentType,
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
      const unitPrice = new Prisma.Decimal(brapiQuote?.price ?? yahooQuote?.price ?? row.unitPrice);
      const effectiveUnitPrice = yahooFx ? unitPrice.mul(yahooFx.rateToBrl) : unitPrice;
      const holdingData = {
        issuer: brapiQuote?.name ?? yahooQuote?.name ?? row.name,
        productName: brapiQuote?.name ?? yahooQuote?.name ?? row.name,
        pricingSource: (brapiQuote ? "BRAPI" : yahooQuote ? "YAHOO" : "MANUAL") as "BRAPI" | "YAHOO" | "MANUAL",
        ticker,
        brapiAssetType: null,
        brapiSubType: null,
        marketExchange: yahooMatch?.exchange ?? yahooQuote?.exchange ?? null,
        marketQuoteType: yahooMatch?.quoteType ?? yahooQuote?.quoteType ?? null,
        marketSector: yahooMatch?.sector ?? null,
        marketIndustry: yahooMatch?.industry ?? null,
        currency: brapiQuote?.currency ?? yahooQuote?.currency ?? row.currency.toUpperCase(),
        quantity,
        unitPrice,
        fxRateToBrl: yahooFx?.rateToBrl ?? null,
        fxUpdatedAt: yahooFx?.asOf ?? null,
        investedValue: row.manualValue == null ? quantity.mul(effectiveUnitPrice) : new Prisma.Decimal(row.manualValue),
        currentValue: brapiQuote || yahooQuote || row.manualValue == null ? null : new Prisma.Decimal(row.manualValue),
        fractional: instrumentType === "ETF" ? false : yahooQuote ? true : row.fractional,
        logoUrl: brapiQuote?.logoUrl ?? yahooQuote?.logoUrl ?? null,
        priceUpdatedAt: brapiQuote?.asOf ?? yahooQuote?.asOf ?? new Date(),
      };
      const existingHolding = await tx.assetHolding.findFirst({
        where: { assetId: parent.id },
        orderBy: { createdAt: "asc" },
      });
      if (existingHolding) {
        await tx.assetHolding.update({ where: { id: existingHolding.id }, data: holdingData });
      } else {
        await tx.assetHolding.create({ data: { ...holdingData, assetId: parent.id } });
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
        },
      });
      const parent = existing
        ? await tx.asset.update({
            where: { id: existing.id },
            data: { investmentClass: row.investmentClass as InvestmentClass, ticker, name, score: row.score },
          })
        : await tx.asset.create({
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
      await tx.assetHolding.create({
        data: { ...fixedIncomeHoldingData(row.holding), assetId: parent.id },
      });
    }

    await tx.portfolio.update({
      where: { id: portfolio.id },
      data: { version: { increment: 1 } },
    });
  });
  revalidatePath("/carteira");
  revalidatePath("/home");
}

export async function importAssetsAction(rows: AssetInput[]) {
  return importPortfolioRowsAction({ marketRows: rows, fixedIncomeRows: [] });
}

export async function importFixedIncomeHoldingsAction(rows: FixedIncomeImportInput[]) {
  return importPortfolioRowsAction({ marketRows: [], fixedIncomeRows: rows });
}

export async function deleteAssetAction(assetId: string) {
  const userId = await requireUserId();
  const asset = await assertOwnedAsset(userId, assetId);
  await prisma.$transaction(async (tx) => {
    await tx.pluggyInvestmentDiagramLink.updateMany({
      where: { holding: { assetId: asset.id } },
      data: {
        status: "EXCLUDED",
        classificationSource: "USER_OVERRIDE",
        reviewReason: "Ativo removido do diagrama pelo usuário.",
      },
    });
    await tx.contributionSuggestion.deleteMany({ where: { assetId: asset.id } });
    await tx.asset.delete({ where: { id: asset.id } });
    await tx.portfolio.update({ where: { id: asset.portfolioId }, data: { version: { increment: 1 } } });
  });
  revalidatePath("/carteira");
  revalidatePath("/home");
}

export async function deleteAssetClassAction(investmentClass: InvestmentClassKey) {
  const userId = await requireUserId();
  const parsedClass = investmentClassSchema.parse(investmentClass) as InvestmentClass;
  const portfolio = await ensurePortfolio(userId);
  await prisma.$transaction(async (tx) => {
    const assets = await tx.asset.findMany({ where: { portfolioId: portfolio.id, investmentClass: parsedClass }, select: { id: true } });
    await tx.contributionSuggestion.deleteMany({ where: { assetId: { in: assets.map((asset) => asset.id) } } });
    await tx.asset.deleteMany({ where: { portfolioId: portfolio.id, investmentClass: parsedClass } });
    await tx.portfolio.update({ where: { id: portfolio.id }, data: { version: { increment: 1 } } });
  });
  revalidatePath("/carteira");
  revalidatePath("/home");
}

export async function saveBrapiApiKeyAction(input: string) {
  const userId = await requireUserId();
  const apiKey = brapiApiKeySchema.parse(input);
  await fetchBrapiQuotes({ apiKey, tickers: ["WEGE3"] });
  const status = await storeBrapiApiKey(userId, apiKey);
  revalidatePath("/carteira");
  revalidatePath("/configuracoes");
  return status;
}

export async function searchBrapiTickersAction(input: string, kind: InvestmentClassKey | "ETF") {
  await requireUserId();
  const query = tickerSearchSchema.parse(input);
  const parsedKind = brapiSearchKindSchema.parse(kind);
  if (parsedKind !== "ETF") {
    return searchBrapiTickers({ query, subType: parsedKind === "REAL_ESTATE_FUNDS" ? "fii" : undefined });
  }
  return searchBrapiEtfTickers({ query });
}

export async function searchYahooTickersAction(input: string, kind: YahooSearchKind) {
  await requireUserId();
  const query = tickerSearchSchema.parse(input);
  return searchYahooTickers({ query, kind: yahooSearchKindSchema.parse(kind) });
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
};

export async function refreshMarketPricesAction(): Promise<MarketRefreshResult> {
  const userId = await requireUserId();
  const portfolio = await ensurePortfolio(userId);
  const holdings = await prisma.assetHolding.findMany({
    where: {
      asset: { portfolioId: portfolio.id },
      ticker: { not: null },
      includedInTotals: true,
    },
    select: {
      id: true,
      ticker: true,
      currentValue: true,
      logoUrl: true,
      pricingSource: true,
      positionSource: true,
      asset: { select: { id: true, instrumentType: true, investmentClass: true } },
    },
  });

  const brapiHoldings = holdings.filter((holding) =>
    holding.pricingSource === "BRAPI"
    && usesBrapiQuotes(holding.asset.investmentClass as InvestmentClassKey, holding.asset.instrumentType),
  );
  const yahooHoldings = holdings.filter((holding) =>
    usesYahooQuotes(holding.asset.investmentClass as InvestmentClassKey, holding.asset.instrumentType),
  );

  const [brapiSettled, yahooSettled] = await Promise.allSettled([
    (async () => {
      if (!brapiHoldings.length) return { quotes: [] as BrapiQuote[] };
      const apiKey = await requireBrapiApiKey(userId);
      const quotes = await fetchAvailableBrapiQuotes({
        apiKey,
        tickers: brapiHoldings.flatMap((holding) => holding.ticker ? [holding.ticker] : []),
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
      });
      const fxRates = await fetchYahooFxRates({ currencies: quotes.map((quote) => quote.currency) });
      return { quotes, fxRates };
    })(),
  ]);

  const brapiError = brapiSettled.status === "rejected"
    ? brapiSettled.reason instanceof Error ? brapiSettled.reason.message : "Não foi possível atualizar a B3."
    : null;
  const yahooError = yahooSettled.status === "rejected"
    ? yahooSettled.reason instanceof Error ? yahooSettled.reason.message : "Não foi possível atualizar os ativos internacionais."
    : null;

  const brapiQuotes = brapiSettled.status === "fulfilled" ? brapiSettled.value.quotes : [];
  const yahooQuotes = yahooSettled.status === "fulfilled" ? yahooSettled.value.quotes : [];
  const yahooFxRates = yahooSettled.status === "fulfilled" ? yahooSettled.value.fxRates : [];
  const brapiQuotesBySymbol = new Map(brapiQuotes.map((quote) => [quote.requestedSymbol, quote]));
  const yahooQuotesBySymbol = new Map(yahooQuotes.map((quote) => [quote.requestedSymbol, quote]));
  const yahooFxByCurrency = new Map(yahooFxRates.map((rate) => [rate.currency, rate]));

  const brapiUpdates = brapiHoldings.flatMap((holding) => {
    const quote = holding.ticker ? brapiQuotesBySymbol.get(normalizeBrapiSymbol(holding.ticker)) : undefined;
    return quote ? [{ holding, quote }] : [];
  });
  const yahooUpdates = yahooHoldings.flatMap((holding) => {
    const quote = holding.ticker ? yahooQuotesBySymbol.get(normalizeYahooSymbol(holding.ticker)) : undefined;
    const fx = quote ? yahooFxByCurrency.get(quote.currency) : undefined;
    return quote && fx ? [{ holding, quote, fx }] : [];
  });

  if (brapiUpdates.length || yahooUpdates.length) {
    await prisma.$transaction(async (tx) => {
      for (const { holding, quote } of brapiUpdates) {
        await tx.assetHolding.update({
          where: { id: holding.id },
          data: {
            pricingSource: "BRAPI",
            unitPrice: quote.price,
            currentValue: null,
            fractional: holding.asset.instrumentType === "CRYPTO",
            ...(holding.positionSource === "MANUAL"
              ? {
                  issuer: quote.name,
                  productName: quote.name,
                }
              : {}),
            currency: quote.currency,
            fxRateToBrl: null,
            fxUpdatedAt: null,
            logoUrl: quote.logoUrl ?? holding.logoUrl,
            priceUpdatedAt: quote.asOf,
          },
        });
        if (holding.positionSource === "MANUAL") {
          await tx.asset.update({ where: { id: holding.asset.id }, data: { name: quote.name } });
        }
      }
      for (const { holding, quote, fx } of yahooUpdates) {
        await tx.assetHolding.update({
          where: { id: holding.id },
          data: {
            pricingSource: "YAHOO",
            unitPrice: quote.price,
            currentValue: null,
            fractional: holding.asset.instrumentType !== "ETF",
            ...(holding.positionSource === "MANUAL"
              ? {
                  issuer: quote.name,
                  productName: quote.name,
                }
              : {}),
            currency: quote.currency,
            fxRateToBrl: fx.rateToBrl,
            fxUpdatedAt: fx.asOf,
            marketExchange: quote.exchange,
            marketQuoteType: quote.quoteType,
            logoUrl: quote.logoUrl ?? holding.logoUrl,
            priceUpdatedAt: quote.asOf,
          },
        });
        if (holding.positionSource === "MANUAL") {
          await tx.asset.update({ where: { id: holding.asset.id }, data: { name: quote.name } });
        }
      }
      await tx.portfolio.update({ where: { id: portfolio.id }, data: { version: { increment: 1 } } });
    });
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

  revalidatePath("/carteira");
  revalidatePath("/home");
  return {
    updated: brapiUpdates.length + yahooUpdates.length,
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
  };
}

/**
 * Kept temporarily for callers outside the portfolio UI. New code should use
 * refreshMarketPricesAction so B3 and international quotes refresh together.
 */
export async function refreshBrapiMarketPricesAction() {
  const result = await refreshMarketPricesAction();
  return {
    updated: result.brapi.updated,
    missing: result.brapi.missing,
  };
}

export async function saveInvestmentTargetsAction(values: Record<InvestmentClassKey, number>) {
  const userId = await requireUserId();
  const parsed = z.record(investmentClassSchema, z.number().min(0).max(100)).parse(values);
  const total = INVESTMENT_CLASSES.reduce((sum, key) => sum + (parsed[key] ?? 0), 0);
  if (Math.abs(total - 100) > 0.001) throw new Error("As metas precisam totalizar 100%.");
  await prisma.$transaction(
    INVESTMENT_CLASSES.map((investmentClass) =>
      prisma.investmentTarget.upsert({
        where: { userId_investmentClass: { userId, investmentClass: investmentClass as InvestmentClass } },
        update: { percentage: parsed[investmentClass] ?? 0 },
        create: { userId, investmentClass: investmentClass as InvestmentClass, percentage: parsed[investmentClass] ?? 0 },
      }),
    ),
  );
  revalidatePath("/carteira");
}

export async function simulateContributionAction(value: number) {
  const userId = await requireUserId();
  const contribution = z.number().positive().max(100_000_000).parse(value);
  const portfolio = await getPortfolioData(userId);
  const result = allocateContribution({
    contribution,
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
    })),
  });

  const simulation = await prisma.contributionSimulation.create({
    data: {
      userId,
      portfolioVersion: portfolio.version,
      requestedAmount: contribution,
      unallocatedAmount: result.unallocatedAmount.toFixed(2),
      suggestions: {
        create: result.suggestions.map((suggestion) => ({
          assetId: suggestion.assetId,
          quantity: suggestion.quantity.toString(),
          value: suggestion.value.toString(),
          suggestionPercentage: suggestion.suggestionPercentage.toString(),
          totalAfterSuggestionPercentage: suggestion.totalAfterSuggestionPercentage.toString(),
        })),
      },
    },
    include: { suggestions: { include: { asset: true } } },
  });

  return {
    id: simulation.id,
    requestedAmount: simulation.requestedAmount.toString(),
    unallocatedAmount: simulation.unallocatedAmount.toString(),
    suggestions: simulation.suggestions.map((suggestion) => ({
      id: suggestion.id,
      assetId: suggestion.assetId,
      ticker: suggestion.asset.ticker,
      name: suggestion.asset.name,
      investmentClass: suggestion.asset.investmentClass as InvestmentClassKey,
      instrumentType: suggestion.asset.instrumentType,
      quantity: suggestion.quantity.toString(),
      value: suggestion.value.toString(),
      suggestionPercentage: suggestion.suggestionPercentage.toString(),
      totalAfterSuggestionPercentage: suggestion.totalAfterSuggestionPercentage.toString(),
      executed: suggestion.executed,
      executionStatus: suggestion.executionStatus,
    })),
  };
}

export async function executeContributionAction(
  simulationId: string,
  suggestionId?: string,
  customQuantity?: number,
  destination?: { holdingId?: string; newHolding?: FixedIncomeHoldingInput },
) {
  const userId = await requireUserId();
  const parsedSimulationId = z.string().cuid().parse(simulationId);
  const parsedSuggestionId = suggestionId ? z.string().cuid().parse(suggestionId) : undefined;
  const parsedQuantity = customQuantity == null
    ? undefined
    : z.number().positive().max(1_000_000_000).parse(customQuantity);
  if (parsedQuantity !== undefined && !parsedSuggestionId) throw new Error("Selecione um ativo para informar a quantidade.");
  try {
    await prisma.$transaction(async (tx) => {
      const simulation = await tx.contributionSimulation.findFirst({
        where: { id: parsedSimulationId, userId, status: "DRAFT" },
        include: { user: { include: { portfolio: true } }, suggestions: { include: { asset: { include: { holdings: true } } } } },
      });
      const portfolio = simulation?.user.portfolio;
      if (!simulation || !portfolio) throw new Error("Simulação não encontrada.");
      if (simulation.portfolioVersion !== portfolio.version) {
        throw new Error("A carteira mudou. Calcule novamente antes de aportar.");
      }
      const selected = simulation.suggestions.filter(
        (suggestion) => suggestion.executionStatus === "PENDING"
          && (!parsedSuggestionId || suggestion.id === parsedSuggestionId),
      );
      if (!selected.length) throw new Error("Nenhuma sugestão disponível para executar.");

      const externalSuggestion = selected.find((suggestion) => {
        if (suggestion.asset.instrumentType !== "FIXED_INCOME") {
          return suggestion.asset.holdings.some((holding) => holding.positionSource === "PLUGGY");
        }
        return destination?.holdingId
          ? suggestion.asset.holdings.some((holding) =>
              holding.id === destination.holdingId && holding.positionSource === "PLUGGY",
            )
          : false;
      });
      if (externalSuggestion) {
        if (selected.length !== 1) throw new Error("Planeje aportes de posições Pluggy individualmente.");
        const quantity = parsedQuantity === undefined
          ? externalSuggestion.quantity
          : new Prisma.Decimal(parsedQuantity.toString());
        const marketHolding = externalSuggestion.asset.holdings.find((holding) =>
          holding.positionSource === "PLUGGY" && holding.unitPrice.gt(0),
        );
        const value = parsedQuantity === undefined
          ? externalSuggestion.value
          : externalSuggestion.asset.instrumentType === "FIXED_INCOME"
            ? quantity
            : quantity.mul(marketHolding?.unitPrice ?? 0);
        const baselineQuantity = externalSuggestion.asset.holdings
          .filter((holding) => holding.positionSource === "PLUGGY" && holding.includedInTotals)
          .reduce((total, holding) => total.add(holding.quantity), new Prisma.Decimal(0));
        const baselineValue = externalSuggestion.asset.holdings
          .filter((holding) => holding.positionSource === "PLUGGY" && holding.includedInTotals)
          .reduce(
            (total, holding) => total.add(
              holding.providerCurrentValue
              ?? holding.currentValue
              ?? holding.quantity.mul(holding.unitPrice),
            ),
            new Prisma.Decimal(0),
          );
        await tx.contributionSuggestion.update({
          where: { id: externalSuggestion.id },
          data: {
            quantity,
            value,
            executionStatus: "AWAITING_SYNC",
            awaitingSyncAt: new Date(),
            baselineQuantity,
            baselineValue,
          },
        });
        return;
      }

      const versionClaim = await tx.portfolio.updateMany({
        where: { id: portfolio.id, version: portfolio.version },
        data: { version: { increment: 1 } },
      });
      if (versionClaim.count !== 1) throw new Error("A carteira mudou. Calcule novamente antes de aportar.");
      const newVersion = portfolio.version + 1;

      for (const suggestion of selected) {
        const suggestionClaim = await tx.contributionSuggestion.updateMany({
          where: { id: suggestion.id, simulationId: simulation.id, executed: false },
          data: { executed: true, executionStatus: "EXECUTED" },
        });
        if (suggestionClaim.count !== 1) {
          throw new Error("Esta sugestão já foi executada.");
        }

        let quantity: Prisma.Decimal;
        let value: Prisma.Decimal;
        if (suggestion.asset.instrumentType === "FIXED_INCOME") {
          if (!parsedSuggestionId) throw new Error("Registre aportes de renda fixa individualmente.");
          value = parsedQuantity === undefined ? suggestion.value : new Prisma.Decimal(parsedQuantity.toString());
          quantity = value;
          let holding = destination?.holdingId
            ? suggestion.asset.holdings.find((candidate) => candidate.id === destination.holdingId)
            : undefined;
          if (!holding && destination?.newHolding) {
            const parsedHolding = fixedIncomeHoldingSchema.parse(destination.newHolding);
            if (!suggestion.asset.fixedIncomeFamilyCode) throw new Error("Grupo de renda fixa inválido.");
            const catalogItem = parsedHolding.catalogItemId
              ? await tx.assetCatalogItem.findUnique({ where: { id: parsedHolding.catalogItemId }, select: { familyCode: true } })
              : null;
            if (parsedHolding.catalogItemId && catalogItem?.familyCode !== suggestion.asset.fixedIncomeFamilyCode) {
              throw new Error("O tipo selecionado não pertence a esta família de renda fixa.");
            }
            holding = await tx.assetHolding.create({ data: { ...fixedIncomeHoldingData(parsedHolding), assetId: suggestion.assetId } });
          }
          if (!holding) throw new Error("Selecione ou crie uma aplicação para registrar o aporte.");
          const nextValues = applyManualFixedIncomeContribution({
            investedValue: holding.investedValue,
            currentValue: holding.currentValue ?? holding.quantity.mul(holding.unitPrice),
            amount: value,
          });
          await tx.assetHolding.update({
            where: { id: holding.id },
            data: {
              investedValue: new Prisma.Decimal(nextValues.investedValue.toString()),
              currentValue: new Prisma.Decimal(nextValues.currentValue.toString()),
            },
          });
        } else {
          const holding = suggestion.asset.holdings[0];
          if (!holding) throw new Error("A posição de mercado não foi encontrada.");
          quantity = parsedQuantity === undefined ? suggestion.quantity : new Prisma.Decimal(parsedQuantity.toString());
          value = parsedQuantity === undefined ? suggestion.value : quantity.mul(holding.unitPrice);
          await tx.assetHolding.update({
            where: { id: holding.id },
            data: {
              quantity: { increment: quantity },
              investedValue: new Prisma.Decimal(holding.investedValue ?? 0).add(value),
              ...(holding.currentValue != null ? { currentValue: holding.currentValue.add(value) } : {}),
            },
          });
        }
        await tx.asset.update({ where: { id: suggestion.assetId }, data: { updatedAt: new Date() } });
        await tx.contributionSuggestion.update({ where: { id: suggestion.id }, data: { quantity, value } });
      }
      const remainingCount = await tx.contributionSuggestion.count({
        where: { simulationId: simulation.id, executed: false },
      });
      await tx.contributionSimulation.update({
        where: { id: simulation.id },
        data: {
          portfolioVersion: newVersion,
          status: remainingCount === 0 ? "EXECUTED" : "DRAFT",
          executedAt: remainingCount === 0 ? new Date() : null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new Error("A carteira foi atualizada ao mesmo tempo. Recarregue e tente novamente.");
    }
    throw error;
  }
  revalidatePath("/carteira");
  revalidatePath("/home");
  return { awaitingSync: Boolean(parsedSuggestionId && await prisma.contributionSuggestion.count({
    where: {
      id: parsedSuggestionId,
      simulation: { userId },
      executionStatus: "AWAITING_SYNC",
    },
  })) };
}

export async function createQuestionAction(input: { type: DiagramType; criterion: string; text: string }) {
  const userId = await requireUserId();
  const parsed = z.object({
    type: z.enum(["CERRADO", "REAL_ESTATE"]),
    criterion: z.string().trim().min(2).max(80).transform((value) => value.toUpperCase()),
    text: z.string().trim().min(5).max(240),
  }).parse(input);
  const sortOrder = await prisma.diagramQuestion.count({ where: { userId, type: parsed.type } });
  await prisma.diagramQuestion.create({ data: { userId, type: parsed.type, criterion: parsed.criterion, text: parsed.text, sortOrder } });
  revalidatePath("/carteira");
}

export async function deleteQuestionAction(questionId: string) {
  const userId = await requireUserId();
  const result = await prisma.diagramQuestion.deleteMany({ where: { id: questionId, userId } });
  if (!result.count) throw new Error("Pergunta não encontrada.");
  revalidatePath("/carteira");
}

export async function updateQuestionAction(questionId: string, input: { criterion?: string; text?: string; active?: boolean }) {
  const userId = await requireUserId();
  const parsed = z.object({
    criterion: z.string().trim().min(2).max(80).transform((value) => value.toUpperCase()).optional(),
    text: z.string().trim().min(5).max(240).optional(),
    active: z.boolean().optional(),
  }).refine((value) => value.criterion !== undefined || value.text !== undefined || value.active !== undefined).parse(input);
  const result = await prisma.diagramQuestion.updateMany({ where: { id: questionId, userId }, data: parsed });
  if (!result.count) throw new Error("Pergunta não encontrada.");
  revalidatePath("/carteira");
}

export async function moveQuestionAction(questionId: string, direction: -1 | 1) {
  const userId = await requireUserId();
  await prisma.$transaction(async (tx) => {
    const question = await tx.diagramQuestion.findFirst({ where: { id: questionId, userId } });
    if (!question) throw new Error("Pergunta não encontrada.");
    const neighbor = await tx.diagramQuestion.findFirst({
      where: {
        userId,
        type: question.type,
        ...(direction < 0 ? { sortOrder: { lt: question.sortOrder } } : { sortOrder: { gt: question.sortOrder } }),
      },
      orderBy: { sortOrder: direction < 0 ? "desc" : "asc" },
    });
    if (!neighbor) return;
    await tx.diagramQuestion.update({ where: { id: question.id }, data: { sortOrder: neighbor.sortOrder } });
    await tx.diagramQuestion.update({ where: { id: neighbor.id }, data: { sortOrder: question.sortOrder } });
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
      })),
    });
    const portfolio = await tx.portfolio.findUnique({ where: { userId }, select: { id: true } });
    if (portfolio) {
      await tx.asset.updateMany({
        where: {
          portfolioId: portfolio.id,
          investmentClass: {
            in: type === "CERRADO"
              ? ["BRAZILIAN_STOCKS", "INTERNATIONAL_STOCKS"]
              : ["REAL_ESTATE_FUNDS", "REITS"],
          },
        },
        data: { score: 0 },
      });
    }
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
  const score = validAnswers.reduce((total, [, answer]) => total + (answer ? 1 : -1), 0);
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
