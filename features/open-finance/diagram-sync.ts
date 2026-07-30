import {
  Prisma,
  type FixedIncomeIndexation,
  type InstrumentType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { UserOperationLeaseContext } from "@/lib/operation-security";
import { FIXED_INCOME_INDEXATION_META } from "@/features/portfolio/constants";
import { allowsFractionalUnits } from "@/features/portfolio/fractional-assets";
import { fetchYahooFxRates } from "@/features/portfolio/yahoo-finance";
import {
  classifyPluggyInvestment,
  applyExistingAssetClassification,
  fundAssetCode,
  isPluggyPositionActive,
  normalizePluggyTicker,
  type DiagramClassification,
} from "./diagram-classification";
import { shouldReconcileExcludedPluggyPosition } from "./diagram-exclusion";
import { resolvePluggyInvestmentIssuer } from "./institution-logo";

type InvestmentWithItem = Prisma.PluggyInvestmentGetPayload<{
  include: {
    item: { select: { connectorName: true; institutionName: true } };
    diagramLink: { include: { holding: true } };
  };
}>;

function decimal(value: Prisma.Decimal | null | undefined, fallback = 0) {
  return value ?? new Prisma.Decimal(fallback);
}

function sameDecimal(left: Prisma.Decimal | null | undefined, right: Prisma.Decimal | null | undefined) {
  if (left == null || right == null) return left == null && right == null;
  return left.equals(right);
}

function sameDate(left: Date | null | undefined, right: Date | null | undefined) {
  return left?.getTime() === right?.getTime();
}

function normalized(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function isMarketInstrument(instrumentType: InstrumentType | null) {
  return instrumentType === "STOCK"
    || instrumentType === "ETF"
    || instrumentType === "REAL_ESTATE_FUND"
    || instrumentType === "REIT";
}

function providerIssuer(investment: InvestmentWithItem) {
  return resolvePluggyInvestmentIssuer(
    investment.issuer,
    investment.institutionName,
    investment.item.institutionName,
    investment.item.connectorName,
  );
}

function fixedParentIdentity(
  family: { name: string; shortCode: string },
  indexation: FixedIncomeIndexation,
) {
  const meta = FIXED_INCOME_INDEXATION_META[indexation];
  return {
    ticker: `${family.shortCode}-${meta.suffix}`.toUpperCase(),
    name: `${family.name} · ${meta.label}`,
  };
}

function linkedHoldingData(
  investment: InvestmentWithItem,
  classification: DiagramClassification,
  quoteHolding?: {
    unitPrice: Prisma.Decimal;
    logoUrl: string | null;
    brapiAssetType: string | null;
    brapiSubType: string | null;
    marketExchange: string | null;
    marketQuoteType: string | null;
    marketSector: string | null;
    marketIndustry: string | null;
    currency: string;
    fxRateToBrl: Prisma.Decimal | null;
    fxUpdatedAt: Date | null;
    priceUpdatedAt: Date | null;
  } | null,
  providerFx?: {
    rateToBrl: number;
    asOf: Date;
  },
) {
  const market = isMarketInstrument(classification.instrumentType);
  const internationalMarket = market
    && classification.investmentClass != null
    && ["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(classification.investmentClass);
  const quantity = decimal(investment.quantity);
  const providerUnitPrice = investment.value
    ?? (quantity.gt(0) ? investment.balance.div(quantity) : new Prisma.Decimal(0));
  const currency = (
    market
      ? quoteHolding?.currency ?? investment.currencyCode ?? "BRL"
      : investment.currencyCode ?? "BRL"
  ).toUpperCase();
  const fxRateToBrl = currency === "BRL"
    ? null
    : quoteHolding?.fxRateToBrl?.gt(0)
      ? quoteHolding.fxRateToBrl
      : providerFx
        ? new Prisma.Decimal(providerFx.rateToBrl)
        : null;
  const fxUpdatedAt = currency === "BRL"
    ? null
    : quoteHolding?.fxUpdatedAt ?? providerFx?.asOf ?? null;
  return {
    catalogItemId: classification.catalogItemId,
    customTypeName: classification.catalogItemId ? null : investment.subtype ?? investment.type,
    issuer: providerIssuer(investment),
    productName: investment.name,
    pricingSource: market ? internationalMarket ? "YAHOO" as const : "BRAPI" as const : "PLUGGY" as const,
    positionSource: "PLUGGY" as const,
    ticker: market ? normalizePluggyTicker(investment.code) || null : null,
    brapiAssetType: market ? quoteHolding?.brapiAssetType ?? null : null,
    brapiSubType: market ? quoteHolding?.brapiSubType ?? null : null,
    marketExchange: market ? quoteHolding?.marketExchange ?? null : null,
    marketQuoteType: market ? quoteHolding?.marketQuoteType ?? null : null,
    marketSector: market ? quoteHolding?.marketSector ?? null : null,
    marketIndustry: market ? quoteHolding?.marketIndustry ?? null : null,
    currency,
    quantity,
    unitPrice: market && quoteHolding?.unitPrice.gt(0) ? quoteHolding.unitPrice : providerUnitPrice,
    fxRateToBrl,
    fxUpdatedAt,
    investedValue: market
      ? investment.amountOriginal
      : investment.amountOriginal ?? investment.amount,
    currentValue: market ? null : investment.balance,
    providerCurrentValue: investment.balance,
    includedInTotals: investment.providerAvailable && investment.status === "ACTIVE",
    supersededAt: null,
    fractional: allowsFractionalUnits({
      instrumentType: classification.instrumentType,
      investmentClass: classification.investmentClass,
      pricingSource: market ? internationalMarket ? "YAHOO" : "BRAPI" : "PLUGGY",
      fallback: !market,
    }),
    rateConvention: classification.rateConvention,
    benchmark: classification.benchmark,
    rateValue: classification.rateValue === null ? null : new Prisma.Decimal(classification.rateValue),
    purchaseDate: investment.purchaseDate,
    maturityDate: investment.dueDate,
    logoUrl: market ? quoteHolding?.logoUrl ?? null : null,
    priceUpdatedAt: quoteHolding?.priceUpdatedAt ?? investment.quotaDate ?? investment.providerUpdatedAt,
  };
}

async function confirmAwaitingSuggestions(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const suggestions = await tx.contributionSuggestion.findMany({
    where: {
      executionStatus: "AWAITING_SYNC",
      simulation: { userId },
    },
    orderBy: [{ awaitingSyncAt: "asc" }, { id: "asc" }],
    include: {
      simulation: true,
      externalBaselines: true,
      asset: {
        include: {
          holdings: {
            where: { includedInTotals: true },
            include: {
              pluggyDiagramLink: {
                include: {
                  investment: {
                    include: { transactions: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  for (const suggestion of suggestions) {
    const requestedAt = suggestion.awaitingSyncAt ?? suggestion.simulation.createdAt;
    const pluggyHoldings = suggestion.asset.holdings.filter((holding) => holding.positionSource === "PLUGGY");
    const holdingById = new Map(pluggyHoldings.map((holding) => [holding.id, holding]));
    const detailedBaselines = suggestion.externalBaselines;
    const currentQuantity = pluggyHoldings.reduce((total, holding) => total.add(holding.quantity), new Prisma.Decimal(0));
    const quantityIncrease = detailedBaselines.length
      ? detailedBaselines.reduce((total, baseline) => {
          const holding = holdingById.get(baseline.holdingId);
          return holding
            ? total.add(Prisma.Decimal.max(0, holding.quantity.sub(baseline.quantity)))
            : total;
        }, new Prisma.Decimal(0))
      : suggestion.baselineQuantity != null
        ? Prisma.Decimal.max(0, currentQuantity.sub(suggestion.baselineQuantity))
        : new Prisma.Decimal(0);
    const quantityConfirmed = ["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT"].includes(
      suggestion.asset.instrumentType,
    ) && quantityIncrease.gte(suggestion.quantity.mul("0.999999"));
    const currentValue = pluggyHoldings.reduce(
      (total, holding) => total.add(
        holding.providerCurrentValue
        ?? holding.currentValue
        ?? holding.quantity.mul(holding.unitPrice),
      ),
      new Prisma.Decimal(0),
    );
    const nativeValueIncreaseBrl = detailedBaselines.reduce((total, baseline) => {
      const holding = holdingById.get(baseline.holdingId);
      if (!holding || baseline.providerValue == null || baseline.fxRateToBrl == null) return total;
      const currentNative = holding.providerCurrentValue ?? holding.currentValue;
      if (!currentNative) return total;
      return total.add(
        Prisma.Decimal.max(0, currentNative.sub(baseline.providerValue)).mul(baseline.fxRateToBrl),
      );
    }, new Prisma.Decimal(0));
    const valueConfirmed = ["FIXED_INCOME", "MUTUAL_FUND"].includes(suggestion.asset.instrumentType)
      && (
        detailedBaselines.length
          ? nativeValueIncreaseBrl.gte(suggestion.value.mul("0.97"))
          : suggestion.baselineValue != null
            && currentValue.sub(suggestion.baselineValue).gte(suggestion.value.mul("0.97"))
      );
    const matchingBuy = pluggyHoldings.flatMap((holding) =>
      holding.pluggyDiagramLink?.investment.transactions.filter((transaction) => {
        if (transaction.type !== "BUY" || transaction.date < requestedAt) return false;
        const amount = transaction.netAmount ?? transaction.amount;
        if (!amount) return false;
        const baseline = detailedBaselines.find((item) => item.holdingId === holding.id);
        if (
          baseline?.providerLatestTransactionAt
          && transaction.date <= baseline.providerLatestTransactionAt
        ) return false;
        const convertedAmount = baseline?.fxRateToBrl
          ? amount.mul(baseline.fxRateToBrl)
          : holding.currency === "BRL"
            ? amount
            : null;
        if (!convertedAmount) return false;
        const tolerance = Prisma.Decimal.max(new Prisma.Decimal(1), suggestion.value.mul("0.03"));
        return convertedAmount.sub(suggestion.value).abs().lte(tolerance);
      }) ?? [],
    )[0];
    if (!quantityConfirmed && !valueConfirmed && !matchingBuy) continue;
    const confirmationReference = matchingBuy
      ? `PLUGGY_TRANSACTION:${matchingBuy.id}`
      : `PLUGGY_POSITION:${suggestion.assetId}:${requestedAt.toISOString()}:${currentQuantity.toString()}:${currentValue.toString()}`;
    const alreadyConsumed = await tx.contributionSuggestion.count({
      where: { confirmationReference },
    });
    if (alreadyConsumed) continue;
    const confirmed = await tx.contributionSuggestion.updateMany({
      where: { id: suggestion.id, executionStatus: "AWAITING_SYNC" },
      data: {
        executed: true,
        executionStatus: "EXECUTED",
        confirmationReference,
      },
    });
    if (!confirmed.count) continue;
    const remaining = await tx.contributionSuggestion.count({
      where: { simulationId: suggestion.simulationId, executed: false },
    });
    if (remaining === 0) {
      await tx.contributionSimulation.update({
        where: { id: suggestion.simulationId },
        data: { status: "EXECUTED", executedAt: new Date() },
      });
    }
  }
}

export async function reconcilePluggyInvestmentsForUser(
  userId: string,
  lease?: UserOperationLeaseContext,
) {
  const portfolio = lease
    ? await lease.runFencedTransaction((tx) => tx.portfolio.upsert({
        where: { userId },
        update: {},
        create: { userId },
      }))
    : await prisma.portfolio.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });
  const investments = await prisma.pluggyInvestment.findMany({
    where: { item: { userId } },
    include: {
      item: { select: { connectorName: true, institutionName: true } },
      diagramLink: { include: { holding: true } },
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  const foreignCurrencies = [...new Set(investments.flatMap((investment) => {
    if (!isPluggyPositionActive(investment)) return [];
    let classification = classifyPluggyInvestment(investment);
    if (investment.diagramLink?.classificationSource === "USER_OVERRIDE") {
      classification = {
        ...classification,
        instrumentType: investment.diagramLink.suggestedInstrumentType,
        investmentClass: investment.diagramLink.suggestedInvestmentClass,
        familyCode: investment.diagramLink.suggestedFamilyCode,
        indexation: investment.diagramLink.suggestedIndexation,
      };
    }
    if (
      classification.needsReview
      || !classification.instrumentType
      || !classification.investmentClass
      || (classification.instrumentType === "FIXED_INCOME"
        && (!classification.familyCode || !classification.indexation))
    ) {
      return [];
    }
    const market = isMarketInstrument(classification.instrumentType);
    const currency = (
      market
        ? investment.diagramLink?.holding?.currency ?? investment.currencyCode
        : investment.currencyCode
    ).trim().toUpperCase();
    if (
      !currency
      || currency === "BRL"
      || investment.diagramLink?.holding?.fxRateToBrl?.gt(0)
    ) {
      return [];
    }
    return [currency];
  }))];
  const fxRates = foreignCurrencies.length
    ? await fetchYahooFxRates({ currencies: foreignCurrencies, signal: lease?.signal }).catch(() => [])
    : [];
  const fxRateByCurrency = new Map(fxRates.map((rate) => [rate.currency, rate]));
  let mapped = 0;
  let review = 0;
  let changed = false;
  const reconciliationTimeoutMs = Math.min(
    10 * 60_000,
    Math.max(60_000, investments.length * 750),
  );

  const reconcile = async (tx: Prisma.TransactionClient) => {
    for (const investment of investments) {
      const existingLink = await tx.pluggyInvestmentDiagramLink.findUnique({
        where: { pluggyInvestmentDbId: investment.id },
        include: {
          holding: {
            include: { asset: true },
          },
        },
      });
      const active = isPluggyPositionActive(investment);
      if (!active) {
        if (existingLink?.holding?.includedInTotals) {
          await tx.assetHolding.update({
            where: { id: existingLink.holding.id },
            data: {
              includedInTotals: false,
              providerCurrentValue: investment.balance,
              quantity: decimal(investment.quantity),
            },
          });
          changed = true;
        }
        if (existingLink) {
          await tx.pluggyInvestmentDiagramLink.update({
            where: { id: existingLink.id },
            data: { lastReconciledAt: new Date() },
          });
        }
        continue;
      }
      if (existingLink && !shouldReconcileExcludedPluggyPosition(existingLink)) continue;

      let classification = classifyPluggyInvestment(investment);
      if (existingLink?.classificationSource === "USER_OVERRIDE") {
        classification = {
          ...classification,
          instrumentType: existingLink.suggestedInstrumentType,
          investmentClass: existingLink.suggestedInvestmentClass,
          familyCode: existingLink.suggestedFamilyCode,
          indexation: existingLink.suggestedIndexation,
          needsReview: !existingLink.suggestedInstrumentType || !existingLink.suggestedInvestmentClass
            || (existingLink.suggestedInstrumentType === "FIXED_INCOME"
              && (!existingLink.suggestedFamilyCode || !existingLink.suggestedIndexation)),
          reviewReason: null,
        };
      }

      const providerTicker = normalizePluggyTicker(investment.code);
      const marketCandidate = providerTicker && ["EQUITY", "ETF"].includes(investment.type.toUpperCase())
        ? await tx.asset.findFirst({
            where: {
              portfolioId: portfolio.id,
              ticker: { equals: providerTicker, mode: "insensitive" },
            },
            include: { holdings: true },
          })
        : null;

      if (marketCandidate && existingLink?.classificationSource !== "USER_OVERRIDE") {
        classification = applyExistingAssetClassification(classification, marketCandidate);
      }

      if (
        classification.needsReview
        || !classification.instrumentType
        || !classification.investmentClass
        || (classification.instrumentType === "FIXED_INCOME" && (!classification.familyCode || !classification.indexation))
      ) {
        await tx.pluggyInvestmentDiagramLink.upsert({
          where: { pluggyInvestmentDbId: investment.id },
          update: {
            status: "NEEDS_REVIEW",
            suggestedInstrumentType: classification.instrumentType,
            suggestedInvestmentClass: classification.investmentClass,
            suggestedFamilyCode: classification.familyCode,
            suggestedIndexation: classification.indexation,
            reviewReason: classification.reviewReason,
            lastReconciledAt: new Date(),
          },
          create: {
            userId,
            pluggyInvestmentDbId: investment.id,
            status: "NEEDS_REVIEW",
            suggestedInstrumentType: classification.instrumentType,
            suggestedInvestmentClass: classification.investmentClass,
            suggestedFamilyCode: classification.familyCode,
            suggestedIndexation: classification.indexation,
            reviewReason: classification.reviewReason,
            lastReconciledAt: new Date(),
          },
        });
        review += 1;
        continue;
      }

      let asset = marketCandidate;
      if (!asset && classification.instrumentType === "FIXED_INCOME") {
        const family = await tx.fixedIncomeFamily.findUnique({
          where: { code: classification.familyCode! },
        });
        if (!family) {
          await tx.pluggyInvestmentDiagramLink.upsert({
            where: { pluggyInvestmentDbId: investment.id },
            update: {
              status: "NEEDS_REVIEW",
              reviewReason: "O grupo de renda fixa não está cadastrado.",
              lastReconciledAt: new Date(),
            },
            create: {
              userId,
              pluggyInvestmentDbId: investment.id,
              status: "NEEDS_REVIEW",
              reviewReason: "O grupo de renda fixa não está cadastrado.",
              lastReconciledAt: new Date(),
            },
          });
          review += 1;
          continue;
        }
        asset = await tx.asset.findFirst({
          where: {
            portfolioId: portfolio.id,
            instrumentType: "FIXED_INCOME",
            fixedIncomeFamilyCode: family.code,
            indexation: classification.indexation,
          },
          include: { holdings: true },
        });
        if (!asset) {
          const identity = fixedParentIdentity(family, classification.indexation!);
          asset = await tx.asset.create({
            data: {
              portfolioId: portfolio.id,
              investmentClass: classification.investmentClass,
              instrumentType: "FIXED_INCOME",
              ticker: identity.ticker,
              name: identity.name,
              fixedIncomeFamilyCode: family.code,
              indexation: classification.indexation,
              score: 0,
            },
            include: { holdings: true },
          });
          changed = true;
        }
      }
      if (!asset && classification.instrumentType === "MUTUAL_FUND") {
        const ticker = fundAssetCode(investment);
        asset = await tx.asset.findFirst({
          where: {
            portfolioId: portfolio.id,
            ticker: { equals: ticker, mode: "insensitive" },
          },
          include: { holdings: true },
        });
        if (!asset) {
          asset = await tx.asset.create({
            data: {
              portfolioId: portfolio.id,
              investmentClass: classification.investmentClass,
              instrumentType: "MUTUAL_FUND",
              ticker,
              name: investment.name,
              score: 0,
            },
            include: { holdings: true },
          });
          changed = true;
        }
      }
      if (!asset) {
        const ticker = providerTicker || `PLG-${investment.pluggyInvestmentId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
        asset = await tx.asset.create({
          data: {
            portfolioId: portfolio.id,
            investmentClass: classification.investmentClass,
            instrumentType: classification.instrumentType,
            ticker,
            name: investment.name,
            fixedIncomeFamilyCode: classification.familyCode,
            indexation: classification.indexation,
            score: 0,
          },
          include: { holdings: true },
        });
        changed = true;
      } else {
        const userOverride = existingLink?.classificationSource === "USER_OVERRIDE";
        const updateInstrument = asset.instrumentType !== classification.instrumentType
          && (userOverride || asset.instrumentSource === "AUTO");
        const updateExposure = asset.investmentClass !== classification.investmentClass
          && (userOverride || asset.exposureSource === "AUTO");
        const updateGroup = userOverride || asset.groupSource === "AUTO";
        const nextFamilyCode = classification.familyCode ?? null;
        const nextIndexation = classification.indexation ?? null;
        const groupChanged = updateGroup && (
          asset.fixedIncomeFamilyCode !== nextFamilyCode
          || asset.indexation !== nextIndexation
        );
        if (updateInstrument || updateExposure || groupChanged) {
          asset = await tx.asset.update({
            where: { id: asset.id },
            data: {
              ...(updateInstrument ? { instrumentType: classification.instrumentType } : {}),
              ...(updateExposure ? { investmentClass: classification.investmentClass } : {}),
              ...(groupChanged
                ? {
                    fixedIncomeFamilyCode: nextFamilyCode,
                    indexation: nextIndexation,
                  }
                : {}),
            },
            include: { holdings: true },
          });
          changed = true;
        }
      }

      if (
        classification.instrumentType === "FIXED_INCOME"
        && !existingLink?.holding
        && existingLink?.classificationSource !== "USER_OVERRIDE"
      ) {
        const issuer = normalized(providerIssuer(investment));
        const possibleManual = asset.holdings.find((holding) =>
          holding.positionSource === "MANUAL"
          && holding.includedInTotals
          && normalized(holding.issuer) === issuer,
        );
        const exactManual = possibleManual
          && normalized(possibleManual.productName) === normalized(investment.name)
          && sameDate(possibleManual.purchaseDate, investment.purchaseDate)
          && sameDate(possibleManual.maturityDate, investment.dueDate)
          ? possibleManual
          : null;
        if (possibleManual && !exactManual) {
          await tx.pluggyInvestmentDiagramLink.upsert({
            where: { pluggyInvestmentDbId: investment.id },
            update: {
              status: "NEEDS_REVIEW",
              suggestedInstrumentType: classification.instrumentType,
              suggestedInvestmentClass: classification.investmentClass,
              suggestedFamilyCode: classification.familyCode,
              suggestedIndexation: classification.indexation,
              reviewReason: "Existe uma aplicação manual do mesmo emissor. Confirme se é a mesma posição.",
              lastReconciledAt: new Date(),
            },
            create: {
              userId,
              pluggyInvestmentDbId: investment.id,
              status: "NEEDS_REVIEW",
              suggestedInstrumentType: classification.instrumentType,
              suggestedInvestmentClass: classification.investmentClass,
              suggestedFamilyCode: classification.familyCode,
              suggestedIndexation: classification.indexation,
              reviewReason: "Existe uma aplicação manual do mesmo emissor. Confirme se é a mesma posição.",
              lastReconciledAt: new Date(),
            },
          });
          review += 1;
          continue;
        }
      }

      let holding = existingLink?.holding
        ? await tx.assetHolding.findUnique({ where: { id: existingLink.holding.id } })
        : null;
      const marketInstrument = isMarketInstrument(classification.instrumentType);
      const localQuoteHolding = marketInstrument
        ? asset.holdings.find((candidate) => candidate.positionSource === "MANUAL") ?? null
        : null;
      if (!holding && classification.instrumentType === "FIXED_INCOME") {
        holding = asset.holdings.find((candidate) =>
          candidate.positionSource === "MANUAL"
          && normalized(candidate.issuer) === normalized(providerIssuer(investment))
          && normalized(candidate.productName) === normalized(investment.name)
          && sameDate(candidate.purchaseDate, investment.purchaseDate)
          && sameDate(candidate.maturityDate, investment.dueDate),
        ) ?? null;
      }
      const quoteHolding = localQuoteHolding ?? existingLink?.holding;
      const holdingCurrency = (
        marketInstrument
          ? quoteHolding?.currency ?? investment.currencyCode ?? "BRL"
          : investment.currencyCode ?? "BRL"
      ).trim().toUpperCase();
      const previousFx = existingLink?.holding?.currency === holdingCurrency
        ? existingLink.holding.fxRateToBrl
        : null;
      const resolvedFx = fxRateByCurrency.get(holdingCurrency)
        ?? (previousFx?.gt(0)
          ? {
              currency: holdingCurrency,
              rateToBrl: previousFx.toNumber(),
              asOf: existingLink?.holding?.fxUpdatedAt ?? new Date(0),
            }
          : undefined);
      if (
        holdingCurrency !== "BRL"
        && !quoteHolding?.fxRateToBrl?.gt(0)
        && !resolvedFx
      ) {
        await tx.pluggyInvestmentDiagramLink.upsert({
          where: { pluggyInvestmentDbId: investment.id },
          update: {
            status: "NEEDS_REVIEW",
            suggestedInstrumentType: classification.instrumentType,
            suggestedInvestmentClass: classification.investmentClass,
            suggestedFamilyCode: classification.familyCode,
            suggestedIndexation: classification.indexation,
            reviewReason: `Não foi possível converter ${holdingCurrency} para BRL.`,
            lastReconciledAt: new Date(),
          },
          create: {
            userId,
            pluggyInvestmentDbId: investment.id,
            status: "NEEDS_REVIEW",
            suggestedInstrumentType: classification.instrumentType,
            suggestedInvestmentClass: classification.investmentClass,
            suggestedFamilyCode: classification.familyCode,
            suggestedIndexation: classification.indexation,
            reviewReason: `Não foi possível converter ${holdingCurrency} para BRL.`,
            lastReconciledAt: new Date(),
          },
        });
        review += 1;
        continue;
      }
      const data = linkedHoldingData(
        investment,
        classification,
        quoteHolding,
        resolvedFx,
      );
      if (holding) {
        changed ||= holding.assetId !== asset.id
          || !sameDecimal(holding.quantity, data.quantity)
          || !sameDecimal(holding.providerCurrentValue, data.providerCurrentValue)
          || holding.includedInTotals !== data.includedInTotals
          || holding.positionSource !== "PLUGGY";
        holding = await tx.assetHolding.update({
          where: { id: holding.id },
          data: { ...data, assetId: asset.id },
        });
      } else {
        holding = await tx.assetHolding.create({ data: { ...data, assetId: asset.id } });
        changed = true;
      }

      if (isMarketInstrument(classification.instrumentType)) {
        await tx.assetHolding.updateMany({
          where: {
            assetId: asset.id,
            id: { not: holding.id },
            positionSource: "MANUAL",
            includedInTotals: true,
          },
          data: { includedInTotals: false, supersededAt: new Date() },
        });
      }

      await tx.pluggyInvestmentDiagramLink.upsert({
        where: { pluggyInvestmentDbId: investment.id },
        update: {
          assetHoldingId: holding.id,
          status: "MAPPED",
          suggestedInstrumentType: classification.instrumentType,
          suggestedInvestmentClass: classification.investmentClass,
          suggestedFamilyCode: classification.familyCode,
          suggestedIndexation: classification.indexation,
          reviewReason: null,
          lastReconciledAt: new Date(),
        },
        create: {
          userId,
          pluggyInvestmentDbId: investment.id,
          assetHoldingId: holding.id,
          status: "MAPPED",
          suggestedInstrumentType: classification.instrumentType,
          suggestedInvestmentClass: classification.investmentClass,
          suggestedFamilyCode: classification.familyCode,
          suggestedIndexation: classification.indexation,
          reviewReason: null,
          lastReconciledAt: new Date(),
        },
      });
      mapped += 1;
    }

    await confirmAwaitingSuggestions(tx, userId);
    if (changed) {
      await tx.portfolio.update({
        where: { id: portfolio.id },
        data: { version: { increment: 1 } },
      });
      await tx.contributionSimulation.updateMany({
        where: {
          userId,
          status: "DRAFT",
          suggestions: { none: { executionStatus: "AWAITING_SYNC" } },
        },
        data: { status: "STALE" },
      });
    }
  };
  if (lease) {
    await lease.runFencedTransaction(reconcile, { timeout: reconciliationTimeoutMs });
  } else {
    await prisma.$transaction(reconcile, { timeout: reconciliationTimeoutMs });
  }

  return { mapped, review, changed };
}
