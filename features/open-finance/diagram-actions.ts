"use server";

import { Prisma, type PluggyInvestmentMetadataOverrideField } from "@/generated/prisma/client";
import { projectAccountInvestment } from "@/features/finance/account-investments";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeContributionBatchInclude, resolveContributionQuantity } from "./contribution-quantity";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/current-user";
import {
  assertUserOperationRateLimit,
  OperationInProgressError,
  withUserOperationLease,
} from "@/lib/operation-security";
import {
  FIXED_INCOME_INDEXATIONS,
  INSTRUMENT_TYPES,
  INVESTMENT_CLASSES,
  RATE_CONVENTIONS,
} from "@/features/portfolio/constants";
import { bumpPortfolioAndInvalidateDrafts } from "@/features/portfolio/invalidation";
import { allowsFractionalUnits } from "@/features/portfolio/fractional-assets";
import { reconcilePluggyInvestmentsForUser } from "./diagram-sync";
import { markPluggyItemDisconnected, resolvePluggyItemDisconnection } from "./disconnection";
import { PLUGGY_DIAGRAM_EXCLUSION_REASON } from "./diagram-exclusion";
import { deletePluggyItem, PluggyApiError } from "./pluggy";
import { requirePluggyCredentials } from "./pluggy-credentials";
import { resolvePluggyInstitutionName } from "./institution-logo";
import {
  canEditPluggyInvestmentQuantity,
  hasPluggyQuantityOverride,
  pendingPluggyQuantityChange,
  samePluggyQuantity,
} from "./investment-quantity-override";
import {
  hasPluggyQuantityQuoteFx,
  resolvePluggyQuantityQuote,
  storedPluggyQuantityQuote,
  type PluggyQuantityQuote,
} from "./investment-quantity-quote";

const reviewSchema = z.object({
  linkId: z.string().cuid(),
  instrumentType: z.enum(INSTRUMENT_TYPES),
  investmentClass: z.enum(INVESTMENT_CLASSES),
  marketRegion: z.enum(["BRAZIL", "INTERNATIONAL"]).nullable().optional(),
  familyCode: z.string().trim().min(2).max(80).nullable().optional(),
  indexation: z.enum(FIXED_INCOME_INDEXATIONS).nullable().optional(),
  score: z.coerce.number().int().min(-30).max(30).default(0),
}).superRefine((value, context) => {
  const groupedFixedIncome = value.instrumentType === "FIXED_INCOME"
    || (value.instrumentType === "ETF"
      && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(value.investmentClass));
  if (groupedFixedIncome && (!value.familyCode || !value.indexation)) {
    context.addIssue({
      code: "custom",
      message: "Selecione a família e a indexação da renda fixa.",
    });
  }
  if (
    value.instrumentType === "ETF"
    && value.investmentClass === "STORE_OF_VALUE"
    && !value.marketRegion
  ) {
    context.addIssue({
      code: "custom",
      message: "Selecione se o ETF de reserva de valor é nacional ou internacional.",
    });
  }
});

const overrideModeSchema = z.enum(["PROVIDER", "CUSTOM"]);
const overrideTextSchema = z.object({
  mode: overrideModeSchema,
  value: z.string().trim().max(160).nullable(),
});
const overrideDateSchema = z.object({
  mode: overrideModeSchema,
  value: z.coerce.date().nullable(),
});
const metadataOverrideSchema = z.object({
  linkId: z.string().cuid(),
  expectedUpdatedAt: z.coerce.date(),
  productName: overrideTextSchema,
  issuer: overrideTextSchema,
  productType: z.object({
    mode: overrideModeSchema,
    catalogItemId: z.coerce.number().int().positive().nullable(),
    customTypeName: z.string().trim().max(120).nullable(),
  }),
  rateTerms: z.object({
    mode: overrideModeSchema,
    rateConvention: z.enum(RATE_CONVENTIONS).nullable(),
    benchmark: z.string().trim().max(40).nullable(),
    rateValue: z.coerce.number().min(-1000).max(10000).nullable(),
  }),
  purchaseDate: overrideDateSchema,
  maturityDate: overrideDateSchema,
  quantity: z.object({
    mode: overrideModeSchema,
    value: z.number().finite().min(0).max(1e15).refine(
      (value) => new Prisma.Decimal(value).decimalPlaces() <= 10,
      "Informe uma quantidade com no máximo 10 casas decimais.",
    ).nullable(),
  }).optional(),
}).superRefine((value, context) => {
  if (value.quantity?.mode === "CUSTOM" && value.quantity.value === null) {
    context.addIssue({ code: "custom", path: ["quantity", "value"], message: "Informe a quantidade temporária." });
  }
  if (value.productName.mode === "CUSTOM" && (!value.productName.value || value.productName.value.length < 2)) {
    context.addIssue({ code: "custom", path: ["productName", "value"], message: "Informe o nome do produto." });
  }
  if (value.issuer.mode === "CUSTOM" && (!value.issuer.value || value.issuer.value.length < 2)) {
    context.addIssue({ code: "custom", path: ["issuer", "value"], message: "Informe o emissor." });
  }
  if (
    value.productType.mode === "CUSTOM"
    && !value.productType.catalogItemId
    && (!value.productType.customTypeName || value.productType.customTypeName.length < 2)
  ) {
    context.addIssue({ code: "custom", path: ["productType"], message: "Selecione ou informe o tipo do produto." });
  }
  if (value.rateTerms.mode !== "CUSTOM") return;
  const { rateConvention, benchmark, rateValue } = value.rateTerms;
  if (rateConvention === null) {
    if (benchmark !== null || rateValue !== null) {
      context.addIssue({ code: "custom", path: ["rateTerms"], message: "Limpe o indexador e a taxa quando o formato não estiver informado." });
    }
    return;
  }
  if (rateValue === null) context.addIssue({ code: "custom", path: ["rateTerms", "rateValue"], message: "Informe a taxa." });
  if (rateConvention === "FIXED_ANNUAL" && benchmark) {
    context.addIssue({ code: "custom", path: ["rateTerms", "benchmark"], message: "Uma taxa prefixada não possui indexador." });
  }
  if (rateConvention !== "FIXED_ANNUAL" && !benchmark) {
    context.addIssue({ code: "custom", path: ["rateTerms", "benchmark"], message: "Informe o indexador." });
  }
});

export type PluggyDiagramReviewInput = z.input<typeof reviewSchema>;
export type PluggyInvestmentMetadataOverrideInput = z.input<typeof metadataOverrideSchema>;

const metadataLinkInclude = {
  contributionBatches: activeContributionBatchInclude,
  investment: {
    include: { item: { select: { userId: true, status: true, disconnectedAt: true } } },
  },
  holding: {
    include: {
      asset: { include: { portfolio: { select: { userId: true } }, holdings: true } },
    },
  },
} satisfies Prisma.PluggyInvestmentDiagramLinkInclude;

async function readOwnedMetadataLink(
  client: Pick<Prisma.TransactionClient, "pluggyInvestmentDiagramLink">,
  userId: string,
  parsed: z.output<typeof metadataOverrideSchema>,
) {
  const link = await client.pluggyInvestmentDiagramLink.findFirst({
    where: { id: parsed.linkId, userId },
    include: metadataLinkInclude,
  });
  if (!link?.holding
    || link.userId !== userId
    || link.investment.item.userId !== userId
    || link.holding.asset.portfolio.userId !== userId) {
    throw new Error("Investimento conectado não encontrado na carteira.");
  }
  if (link.updatedAt.getTime() !== parsed.expectedUpdatedAt.getTime()) {
    throw new Error("Os dados deste investimento mudaram. Reabra a edição e tente novamente.");
  }
  return { ...link, holding: link.holding };
}

function assertCustomQuantityAllowed(link: Awaited<ReturnType<typeof readOwnedMetadataLink>>, value: number) {
  if (!canEditPluggyInvestmentQuantity({ link, investment: link.investment, holding: link.holding })) {
    throw new Error("A quantidade temporária está disponível apenas para posições de mercado vinculadas a uma conexão ativa.");
  }
  if (!allowsFractionalUnits({
    instrumentType: link.holding.asset.instrumentType,
    investmentClass: link.holding.asset.investmentClass,
    pricingSource: link.holding.pricingSource,
    fallback: link.holding.fractional,
  }) && !new Prisma.Decimal(value).isInteger()) {
    throw new Error("Este investimento aceita apenas quantidades inteiras.");
  }
}

const connectionDisplayNameSchema = z.object({
  itemId: z.string().cuid(),
  displayName: z.string().trim().min(2).max(120).nullable(),
});

export type PluggyConnectionDisplayNameInput = z.input<typeof connectionDisplayNameSchema>;

export async function savePluggyConnectionDisplayNameAction(
  input: PluggyConnectionDisplayNameInput,
) {
  const userId = await requireUserId();
  const parsed = connectionDisplayNameSchema.parse(input);
  await assertUserOperationRateLimit({
    userId,
    operation: "pluggy-connection-display-name",
    limit: 20,
    windowMs: 60_000,
  });

  const result = await withUserOperationLease({
    userId,
    operation: "pluggy-sync",
    leaseMs: 30_000,
    action: async (lease) => lease.runFencedTransaction(async (tx) => {
      const item = await tx.pluggyItem.findFirst({
        where: { id: parsed.itemId, userId, status: { not: "DELETED" } },
        select: {
          id: true,
          pluggyItemId: true,
          connectorName: true,
          institutionName: true,
        },
      });
      if (!item) throw new Error("Conexão não encontrada.");

      const accounts = await tx.financialAccount.findMany({
        where: {
          userId,
          source: "PLUGGY",
          providerItemId: item.pluggyItemId,
        },
        select: { id: true, bankCode: true },
      });
      const automaticName = resolvePluggyInstitutionName(
        item.institutionName,
        item.connectorName,
        accounts.map((account) => account.bankCode),
      );
      const effectiveName = parsed.displayName ?? automaticName;

      await tx.pluggyItem.update({
        where: { id: item.id },
        data: { displayName: parsed.displayName },
      });
      await tx.financialAccount.updateMany({
        where: {
          userId,
          source: "PLUGGY",
          providerItemId: item.pluggyItemId,
        },
        data: { institutionName: effectiveName },
      });
      for (const account of accounts) await projectAccountInvestment(tx, account.id);

      return { displayName: parsed.displayName, effectiveName };
    }),
  }).catch((error: unknown) => {
    if (error instanceof OperationInProgressError) return null;
    throw error;
  });
  if (!result) {
    const automaticLease = await prisma.userOperationLease.findUnique({
      where: { userId_operation: { userId, operation: "pluggy-bootstrap" } },
      select: { lockedUntil: true },
    }).catch(() => null);
    return {
      status: "BUSY" as const,
      source: automaticLease && automaticLease.lockedUntil.getTime() > Date.now()
        ? "AUTOMATIC" as const
        : "OTHER" as const,
    };
  }

  [
    "/open-finance",
    "/contas",
    "/transacoes",
    "/faturas",
    "/home",
    "/orcamento-domestico",
  ].forEach((path) => revalidatePath(path));

  return { status: "SAVED" as const, ...result };
}

export async function reviewPluggyDiagramLinkAction(input: PluggyDiagramReviewInput) {
  const userId = await requireUserId();
  const parsed = reviewSchema.parse(input);
  const classifiesAsStoreOfValue = parsed.instrumentType === "ETF"
    && parsed.investmentClass === "STORE_OF_VALUE";
  await withUserOperationLease({
    userId,
    operation: "pluggy-sync",
    leaseMs: 10 * 60_000,
    action: async (lease) => {
      await lease.runFencedTransaction(async (tx) => {
        const link = await tx.pluggyInvestmentDiagramLink.findFirst({
          where: { id: parsed.linkId, userId },
          select: { id: true },
        });
        if (!link) throw new Error("Investimento pendente não encontrado.");
        if (parsed.familyCode) {
          const family = await tx.fixedIncomeFamily.findUnique({ where: { code: parsed.familyCode } });
          if (!family) throw new Error("Família de renda fixa não encontrada.");
        }
        await tx.pluggyInvestmentDiagramLink.update({
          where: { id: link.id },
          data: {
            status: "NEEDS_REVIEW",
            classificationSource: "USER_OVERRIDE",
            suggestedInstrumentType: parsed.instrumentType,
            suggestedInvestmentClass: parsed.investmentClass,
            suggestedMarketRegion: classifiesAsStoreOfValue ? parsed.marketRegion : null,
            suggestedFamilyCode: parsed.familyCode ?? null,
            suggestedIndexation: parsed.indexation ?? null,
            reviewReason: null,
          },
        });
      });
      await reconcilePluggyInvestmentsForUser(userId, lease);
      await lease.runFencedTransaction(async (tx) => {
        const mapped = await tx.pluggyInvestmentDiagramLink.findFirst({
          where: { id: parsed.linkId, userId },
          include: { holding: { select: { assetId: true } } },
        });
        if (!mapped?.holding) throw new Error("Não foi possível integrar este investimento.");
        const asset = await tx.asset.update({
          where: { id: mapped.holding.assetId },
          data: {
            score: parsed.score,
            marketRegion: classifiesAsStoreOfValue ? parsed.marketRegion : null,
            instrumentSource: "USER_OVERRIDE",
            exposureSource: "USER_OVERRIDE",
            groupSource: parsed.familyCode ? "USER_OVERRIDE" : "AUTO",
          },
          select: { portfolioId: true },
        });
        await bumpPortfolioAndInvalidateDrafts(tx, asset.portfolioId, userId);
      });
    },
  });
  revalidatePath("/carteira");
  revalidatePath("/open-finance");
}

export async function savePluggyInvestmentMetadataOverridesAction(
  input: PluggyInvestmentMetadataOverrideInput,
) {
  const userId = await requireUserId();
  const parsed = metadataOverrideSchema.parse(input);
  await assertUserOperationRateLimit({
    userId,
    operation: "pluggy-investment-metadata",
    limit: 30,
    windowMs: 60_000,
  });

  await withUserOperationLease({
    userId,
    operation: "pluggy-sync",
    leaseMs: 60_000,
    action: async (lease) => {
      let recoveredQuote: { quote: PluggyQuantityQuote; assetId: string; ticker: string } | null = null;
      if (parsed.quantity?.mode === "CUSTOM" && parsed.quantity.value! > 0) {
        // Validate before any public quote access, and keep network work outside SQL.
        const ownedLink = await readOwnedMetadataLink(prisma, userId, parsed);
        assertCustomQuantityAllowed(ownedLink, parsed.quantity.value!);
        recoveredQuote = {
          assetId: ownedLink.holding.assetId,
          ticker: ownedLink.holding.asset.ticker,
          quote: await resolvePluggyQuantityQuote({
            userId,
            ticker: ownedLink.holding.asset.ticker,
            holding: ownedLink.holding,
            manualHoldings: ownedLink.holding.asset.holdings.filter((candidate) => candidate.positionSource === "MANUAL"),
            signal: lease.signal,
          }),
        };
      }
      await lease.runFencedTransaction(async (tx) => {
        // Re-read ownership, eligibility and the optimistic version after recovery.
        const link = await readOwnedMetadataLink(tx, userId, parsed);

        if (parsed.quantity) {
          let quantityChanged = false;
          const batch = link.contributionBatches[0];
          if (batch && parsed.quantity.mode === "CUSTOM" && !batch.expectedQuantity.eq(parsed.quantity.value!)) {
            throw new Error("Esta quantidade inclui aportes pendentes. Resolva a revisão de sincronização antes de alterá-la.");
          }
          if (batch && parsed.quantity.mode === "PROVIDER") {
            quantityChanged = await resolveContributionQuantity(tx, link.id, "PROVIDER");
          }
          const canEditQuantity = canEditPluggyInvestmentQuantity({
            link,
            investment: link.investment,
            holding: link.holding,
          });
          if (parsed.quantity.mode === "CUSTOM") assertCustomQuantityAllowed(link, parsed.quantity.value!);
          if (parsed.quantity.mode === "PROVIDER"
            && link.metadataOverrideFields.includes("QUANTITY")
            && !canEditQuantity) {
            // Clearing a correction must stay possible after removal or exclusion;
            // it must not make that position active again.
            await tx.assetHolding.update({
              where: { id: link.holding.id },
              data: {
                quantity: link.investment.quantity ?? new Prisma.Decimal(0),
                includedInTotals: false,
              },
            });
            quantityChanged = true;
          }
          if (parsed.quantity.mode === "CUSTOM") {
            const quantity = new Prisma.Decimal(parsed.quantity.value!);
            if (quantity.gt(0)) {
              if (!recoveredQuote
                || recoveredQuote.assetId !== link.holding.assetId
                || recoveredQuote.ticker !== link.holding.asset.ticker) {
                throw new Error("Os dados deste investimento mudaram. Reabra a edição e tente novamente.");
              }
              const stored = storedPluggyQuantityQuote([
                link.holding,
                ...link.holding.asset.holdings.filter((candidate) => candidate.positionSource === "MANUAL"),
              ]);
              const quote = stored && hasPluggyQuantityQuoteFx(stored)
                && stored.priceUpdatedAt!.getTime() >= recoveredQuote.quote.priceUpdatedAt!.getTime()
                ? stored
                : recoveredQuote.quote;
              await tx.assetHolding.update({
                where: { id: link.holding.id },
                data: {
                  pricingSource: quote.pricingSource,
                  unitPrice: quote.unitPrice,
                  currency: quote.currency,
                  fxRateToBrl: quote.fxRateToBrl,
                  fxUpdatedAt: quote.fxUpdatedAt,
                  priceUpdatedAt: quote.priceUpdatedAt,
                },
              });
            }
          }
          if (quantityChanged) await bumpPortfolioAndInvalidateDrafts(tx, link.holding.asset.portfolioId, userId);
        }

        const fixedIncome = link.holding.asset.instrumentType === "FIXED_INCOME";
        if (!fixedIncome && (
          parsed.productType.mode === "CUSTOM"
          || parsed.rateTerms.mode === "CUSTOM"
          || parsed.purchaseDate.mode === "CUSTOM"
          || parsed.maturityDate.mode === "CUSTOM"
        )) {
          throw new Error("Tipo, rentabilidade e datas personalizados são permitidos apenas para renda fixa.");
        }
        if (parsed.productType.mode === "CUSTOM" && parsed.productType.catalogItemId) {
          const catalogItem = await tx.assetCatalogItem.findUnique({
            where: { id: parsed.productType.catalogItemId },
            select: { familyCode: true },
          });
          if (!catalogItem || catalogItem.familyCode !== link.holding.asset.fixedIncomeFamilyCode) {
            throw new Error("O tipo selecionado não pertence ao grupo de renda fixa deste investimento.");
          }
        }

        const purchaseDate = parsed.purchaseDate.mode === "CUSTOM"
          ? parsed.purchaseDate.value
          : link.investment.purchaseDate;
        const maturityDate = parsed.maturityDate.mode === "CUSTOM"
          ? parsed.maturityDate.value
          : link.investment.dueDate;
        if (purchaseDate && maturityDate && maturityDate < purchaseDate) {
          throw new Error("O vencimento não pode ser anterior à data da compra.");
        }

        const fields: PluggyInvestmentMetadataOverrideField[] = [];
        if (parsed.productName.mode === "CUSTOM") fields.push("PRODUCT_NAME");
        if (parsed.issuer.mode === "CUSTOM") fields.push("ISSUER");
        if (parsed.productType.mode === "CUSTOM") fields.push("PRODUCT_TYPE");
        if (parsed.rateTerms.mode === "CUSTOM") fields.push("RATE_TERMS");
        if (parsed.purchaseDate.mode === "CUSTOM") fields.push("PURCHASE_DATE");
        if (parsed.maturityDate.mode === "CUSTOM") fields.push("MATURITY_DATE");
        if (parsed.quantity?.mode === "CUSTOM"
          || (!parsed.quantity && link.metadataOverrideFields.includes("QUANTITY"))) {
          fields.push("QUANTITY");
        }
        const now = new Date();

        if (link.metadataOverrideFields.includes("RATE_TERMS") && parsed.rateTerms.mode === "PROVIDER") {
          await tx.assetHolding.update({
            where: { id: link.holding.id },
            data: { rateConvention: null, benchmark: null, rateValue: null },
          });
        }

        await tx.pluggyInvestmentDiagramLink.update({
          where: { id: link.id },
          data: {
            metadataOverrideFields: { set: fields },
            overrideProductName: parsed.productName.mode === "CUSTOM" ? parsed.productName.value : null,
            overrideIssuer: parsed.issuer.mode === "CUSTOM" ? parsed.issuer.value : null,
            overrideCatalogItemId: parsed.productType.mode === "CUSTOM" ? parsed.productType.catalogItemId : null,
            overrideCustomTypeName: parsed.productType.mode === "CUSTOM" && !parsed.productType.catalogItemId
              ? parsed.productType.customTypeName
              : null,
            overrideRateConvention: parsed.rateTerms.mode === "CUSTOM" ? parsed.rateTerms.rateConvention : null,
            overrideBenchmark: parsed.rateTerms.mode === "CUSTOM" ? parsed.rateTerms.benchmark : null,
            overrideRateValue: parsed.rateTerms.mode === "CUSTOM" && parsed.rateTerms.rateValue !== null
              ? new Prisma.Decimal(parsed.rateTerms.rateValue)
              : null,
            overridePurchaseDate: parsed.purchaseDate.mode === "CUSTOM" ? parsed.purchaseDate.value : null,
            overrideMaturityDate: parsed.maturityDate.mode === "CUSTOM" ? parsed.maturityDate.value : null,
            ...(parsed.quantity ? {
              overrideQuantity: parsed.quantity.mode === "CUSTOM"
                ? new Prisma.Decimal(parsed.quantity.value!)
                : null,
              ...(parsed.quantity.mode === "PROVIDER" ? {
                overrideQuantityProviderQuantity: null,
                overrideQuantityAcknowledgedAt: null,
              } : !hasPluggyQuantityOverride(link)
                || !link.overrideQuantity!.eq(parsed.quantity.value!)
                || !link.overrideQuantityAcknowledgedAt ? {
                  overrideQuantityProviderQuantity: link.investment.quantity,
                  overrideQuantityAcknowledgedAt: now,
                } : {}),
            } : {}),
            metadataOverrideUpdatedAt: fields.length ? now : null,
          },
        });
      });
      await reconcilePluggyInvestmentsForUser(userId, lease);
    },
  });

  revalidatePath("/carteira");
  revalidatePath("/open-finance");
  revalidatePath("/home");
}

const quantityChangeDecisionSchema = z.object({
  linkId: z.string().cuid(),
  contributionBatchId: z.string().cuid().optional(),
  expectedRevision: z.number().int().positive().optional(),
  expectedUpdatedAt: z.coerce.date(),
  expectedProviderQuantity: z.string().max(64).nullable().refine((value) => {
    if (value === null) return true;
    try {
      const quantity = new Prisma.Decimal(value);
      return quantity.isFinite() && quantity.gte(0);
    } catch { return false; }
  }),
  decision: z.enum(["PROVIDER", "KEEP_MANUAL"]),
});

export type PluggyQuantityChangeDecisionInput = z.input<typeof quantityChangeDecisionSchema>;

export async function resolvePluggyQuantityChangeAction(input: PluggyQuantityChangeDecisionInput) {
  const userId = await requireUserId();
  const parsed = quantityChangeDecisionSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" as const };
  const value = parsed.data;
  await assertUserOperationRateLimit({
    userId, operation: "pluggy-investment-metadata", limit: 30, windowMs: 60_000,
  });
  const result = await withUserOperationLease({
    userId,
    operation: "pluggy-sync",
    leaseMs: 60_000,
    action: async (lease) => {
      const decision = await lease.runFencedTransaction(async (tx) => {
        const link = await tx.pluggyInvestmentDiagramLink.findFirst({
          where: { id: value.linkId, userId },
          include: metadataLinkInclude,
        });
        if (!link?.holding || link.userId !== userId
          || link.investment.item.userId !== userId
          || link.holding.asset.portfolio.userId !== userId) return { status: "NOT_FOUND" as const };
        const expected = value.expectedProviderQuantity === null
          ? null : new Prisma.Decimal(value.expectedProviderQuantity);
        if (link.updatedAt.getTime() !== value.expectedUpdatedAt.getTime()
          || !samePluggyQuantity(link.investment.quantity, expected)) return { status: "CONFLICT" as const };
        const batch = link.contributionBatches[0];
        if (batch) {
          if (batch.state !== "CONFLICT" || value.contributionBatchId !== batch.id || value.expectedRevision !== batch.revision) return { status: "CONFLICT" as const };
          if (link.status !== "MAPPED" || !link.investment.providerAvailable || link.investment.item.disconnectedAt
            || link.investment.item.status === "DELETED") return { status: "UNAVAILABLE" as const };
          await resolveContributionQuantity(tx, link.id, value.decision);
          if (value.decision === "PROVIDER") await bumpPortfolioAndInvalidateDrafts(tx, link.holding.asset.portfolioId, userId);
          return { status: "SAVED" as const };
        }
        if (value.contributionBatchId) return { status: "CONFLICT" as const };
        if (!canEditPluggyInvestmentQuantity({ link, investment: link.investment, holding: link.holding })
          || !pendingPluggyQuantityChange(link.investment.quantity, link)) return { status: "UNAVAILABLE" as const };

        const now = new Date();
        const fields = link.metadataOverrideFields.filter((field) => field !== "QUANTITY");
        await tx.pluggyInvestmentDiagramLink.update({
          where: { id: link.id },
          data: value.decision === "KEEP_MANUAL" ? {
            overrideQuantityProviderQuantity: link.investment.quantity,
            overrideQuantityAcknowledgedAt: now,
          } : {
            metadataOverrideFields: { set: fields },
            overrideQuantity: null,
            overrideQuantityProviderQuantity: null,
            overrideQuantityAcknowledgedAt: null,
            metadataOverrideUpdatedAt: fields.length ? now : null,
          },
        });
        return { status: "SAVED" as const };
      });
      if (decision.status === "SAVED" && value.decision === "PROVIDER") {
        await reconcilePluggyInvestmentsForUser(userId, lease);
      }
      return decision;
    },
  }).catch((error: unknown) => {
    if (error instanceof OperationInProgressError) return { status: "BUSY" as const };
    throw error;
  });
  revalidatePath("/carteira");
  revalidatePath("/open-finance");
  if (result.status === "SAVED" && value.decision === "PROVIDER") revalidatePath("/home");
  return result;
}

export async function excludePluggyDiagramLinkAction(linkId: string) {
  const userId = await requireUserId();
  const parsedId = z.string().cuid().parse(linkId);
  await withUserOperationLease({
    userId,
    operation: "pluggy-sync",
    leaseMs: 60_000,
    action: (lease) => lease.runFencedTransaction(async (tx) => {
      const link = await tx.pluggyInvestmentDiagramLink.findFirst({
        where: { id: parsedId, userId },
        include: { holding: { select: { id: true, includedInTotals: true, asset: { select: { portfolioId: true } } } } },
      });
      if (!link) throw new Error("Investimento pendente não encontrado.");
      await resolveContributionQuantity(tx, link.id, "USER_REMOVED");
      await tx.pluggyInvestmentDiagramLink.update({
        where: { id: link.id },
        data: {
          status: "EXCLUDED",
          classificationSource: "USER_OVERRIDE",
          reviewReason: PLUGGY_DIAGRAM_EXCLUSION_REASON.USER,
        },
      });
      if (link.holding?.includedInTotals) {
        await tx.assetHolding.update({
          where: { id: link.holding.id },
          data: { includedInTotals: false },
        });
        await bumpPortfolioAndInvalidateDrafts(tx, link.holding.asset.portfolioId, userId);
      }
    }),
  });
  revalidatePath("/carteira");
  revalidatePath("/open-finance");
}

export async function setShowSoldInvestmentsAction(show: boolean) {
  const userId = await requireUserId();
  const parsed = z.boolean().parse(show);
  await prisma.userPreference.upsert({
    where: { userId },
    update: { showSoldInvestments: parsed },
    create: { userId, showSoldInvestments: parsed },
  });
  revalidatePath("/open-finance");
}

export async function resolvePluggyItemDisconnectionAction(
  itemId: string,
  resolution: "KEEP_MANUAL" | "REMOVE",
) {
  const userId = await requireUserId();
  const parsed = z.object({
    itemId: z.string().cuid(),
    resolution: z.enum(["KEEP_MANUAL", "REMOVE"]),
  }).parse({ itemId, resolution });
  await resolvePluggyItemDisconnection(userId, parsed.itemId, parsed.resolution);
  revalidatePath("/open-finance");
  revalidatePath("/carteira");
  revalidatePath("/home");
}

export async function deletePluggyConnectionAction(pluggyItemId: string) {
  const userId = await requireUserId();
  const parsedItemId = z.string().uuid().parse(pluggyItemId);
  await assertUserOperationRateLimit({
    userId,
    operation: "pluggy-disconnect",
    limit: 10,
    windowMs: 60 * 60_000,
  });
  await withUserOperationLease({
    userId,
    operation: "pluggy-sync",
    leaseMs: 10 * 60_000,
    action: async (lease) => {
      const item = await prisma.pluggyItem.findFirst({
        where: { userId, pluggyItemId: parsedItemId, status: { not: "DELETED" } },
        select: { id: true },
      });
      if (!item) throw new Error("Conexão não encontrada.");
      const credentials = await requirePluggyCredentials(userId);
      try {
        await deletePluggyItem(credentials, parsedItemId);
      } catch (error) {
        if (!(error instanceof PluggyApiError) || error.status !== 404) throw error;
      }
      await markPluggyItemDisconnected(parsedItemId, lease);
    },
  });

  [
    "/open-finance",
    "/contas",
    "/home",
    "/orcamento-domestico",
    "/transacoes",
    "/carteira",
    "/faturas",
  ].forEach((path) => revalidatePath(path));
}
