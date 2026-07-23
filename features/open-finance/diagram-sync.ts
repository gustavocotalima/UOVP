import {
  Prisma,
  type FixedIncomeIndexation,
  type InstrumentType,
  type PluggyInvestment,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FIXED_INCOME_INDEXATION_META } from "@/features/portfolio/constants";
import {
  classifyPluggyInvestment,
  applyExistingAssetClassification,
  fundAssetCode,
  isPluggyPositionActive,
  normalizePluggyTicker,
  type DiagramClassification,
} from "./diagram-classification";

type InvestmentWithItem = PluggyInvestment & {
  item: {
    connectorName: string;
    institutionName: string | null;
  };
};

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
  return investment.issuer
    ?? investment.institutionName
    ?? investment.item.institutionName
    ?? investment.item.connectorName;
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
) {
  const market = isMarketInstrument(classification.instrumentType);
  const internationalMarket = market
    && classification.investmentClass != null
    && ["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(classification.investmentClass);
  const quantity = decimal(investment.quantity);
  const providerUnitPrice = investment.value
    ?? (quantity.gt(0) ? investment.balance.div(quantity) : new Prisma.Decimal(0));
  return {
    catalogItemId: classification.catalogItemId,
    customTypeName: classification.catalogItemId ? null : investment.subtype ?? investment.type,
    issuer: providerIssuer(investment),
    productName: investment.name,
    pricingSource: market ? internationalMarket ? "YAHOO" as const : "BRAPI" as const : "PLUGGY" as const,
    positionSource: "PLUGGY" as const,
    ticker: market ? normalizePluggyTicker(investment.code) || null : null,
    brapiAssetType: quoteHolding?.brapiAssetType ?? null,
    brapiSubType: quoteHolding?.brapiSubType ?? null,
    marketExchange: quoteHolding?.marketExchange ?? null,
    marketQuoteType: quoteHolding?.marketQuoteType ?? null,
    marketSector: quoteHolding?.marketSector ?? null,
    marketIndustry: quoteHolding?.marketIndustry ?? null,
    currency: (quoteHolding?.currency ?? investment.currencyCode) || "BRL",
    quantity,
    unitPrice: market && quoteHolding?.unitPrice.gt(0) ? quoteHolding.unitPrice : providerUnitPrice,
    fxRateToBrl: internationalMarket ? quoteHolding?.fxRateToBrl ?? null : null,
    fxUpdatedAt: internationalMarket ? quoteHolding?.fxUpdatedAt ?? null : null,
    investedValue: market
      ? investment.amountOriginal
      : investment.amountOriginal ?? investment.amount,
    currentValue: market ? null : investment.balance,
    providerCurrentValue: investment.balance,
    includedInTotals: investment.providerAvailable && investment.status === "ACTIVE",
    supersededAt: null,
    fractional: classification.instrumentType === "ETF" ? false : internationalMarket || !market,
    rateConvention: classification.rateConvention,
    benchmark: classification.benchmark,
    rateValue: classification.rateValue === null ? null : new Prisma.Decimal(classification.rateValue),
    purchaseDate: investment.purchaseDate,
    maturityDate: investment.dueDate,
    logoUrl: quoteHolding?.logoUrl ?? null,
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
    include: {
      simulation: true,
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
    const currentQuantity = pluggyHoldings.reduce((total, holding) => total.add(holding.quantity), new Prisma.Decimal(0));
    const quantityConfirmed = suggestion.baselineQuantity != null
      && currentQuantity.sub(suggestion.baselineQuantity).gte(suggestion.quantity.mul("0.999999"));
    const matchingBuy = pluggyHoldings.some((holding) =>
      holding.pluggyDiagramLink?.investment.transactions.some((transaction) => {
        if (transaction.type !== "BUY" || transaction.date < requestedAt) return false;
        const amount = transaction.netAmount ?? transaction.amount;
        if (!amount) return false;
        const tolerance = Prisma.Decimal.max(new Prisma.Decimal(1), suggestion.value.mul("0.03"));
        return amount.sub(suggestion.value).abs().lte(tolerance);
      }),
    );
    if (!quantityConfirmed && !matchingBuy) continue;
    await tx.contributionSuggestion.update({
      where: { id: suggestion.id },
      data: { executed: true, executionStatus: "EXECUTED" },
    });
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

export async function reconcilePluggyInvestmentsForUser(userId: string) {
  const portfolio = await prisma.portfolio.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  const investments = await prisma.pluggyInvestment.findMany({
    where: { item: { userId } },
    include: { item: { select: { connectorName: true, institutionName: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  let mapped = 0;
  let review = 0;
  let changed = false;

  await prisma.$transaction(async (tx) => {
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
      if (existingLink?.status === "EXCLUDED") continue;

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

      if (marketCandidate) {
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
            update: { status: "NEEDS_REVIEW", reviewReason: "O grupo de renda fixa não está cadastrado.", lastReconciledAt: new Date() },
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
      } else if (
        asset.instrumentType !== classification.instrumentType
        && asset.instrumentSource === "AUTO"
      ) {
        asset = await tx.asset.update({
          where: { id: asset.id },
          data: { instrumentType: classification.instrumentType },
          include: { holdings: true },
        });
        changed = true;
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

      let holding = existingLink?.holding && existingLink.holding.assetId === asset.id
        ? await tx.assetHolding.findUnique({ where: { id: existingLink.holding.id } })
        : null;
      const localQuoteHolding = asset.holdings.find((candidate) => candidate.positionSource === "MANUAL") ?? null;
      if (!holding && classification.instrumentType === "FIXED_INCOME") {
        holding = asset.holdings.find((candidate) =>
          candidate.positionSource === "MANUAL"
          && normalized(candidate.issuer) === normalized(providerIssuer(investment))
          && normalized(candidate.productName) === normalized(investment.name)
          && sameDate(candidate.purchaseDate, investment.purchaseDate)
          && sameDate(candidate.maturityDate, investment.dueDate),
        ) ?? null;
      }
      const data = linkedHoldingData(investment, classification, localQuoteHolding ?? existingLink?.holding);
      if (holding) {
        changed ||= !sameDecimal(holding.quantity, data.quantity)
          || !sameDecimal(holding.providerCurrentValue, data.providerCurrentValue)
          || holding.includedInTotals !== data.includedInTotals
          || holding.positionSource !== "PLUGGY";
        holding = await tx.assetHolding.update({ where: { id: holding.id }, data });
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
  }, { timeout: 30_000 });

  return { mapped, review, changed };
}
