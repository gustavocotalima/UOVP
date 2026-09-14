"use server";

import { Prisma, type PluggyInvestmentMetadataOverrideField } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/current-user";
import { assertUserOperationRateLimit, withUserOperationLease } from "@/lib/operation-security";
import {
  FIXED_INCOME_INDEXATIONS,
  INSTRUMENT_TYPES,
  INVESTMENT_CLASSES,
  RATE_CONVENTIONS,
} from "@/features/portfolio/constants";
import { bumpPortfolioAndInvalidateDrafts } from "@/features/portfolio/invalidation";
import { reconcilePluggyInvestmentsForUser } from "./diagram-sync";
import { markPluggyItemDisconnected, resolvePluggyItemDisconnection } from "./disconnection";
import { PLUGGY_DIAGRAM_EXCLUSION_REASON } from "./diagram-exclusion";
import { deletePluggyItem, PluggyApiError } from "./pluggy";
import { requirePluggyCredentials } from "./pluggy-credentials";

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
}).superRefine((value, context) => {
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

export async function reviewPluggyDiagramLinkAction(input: PluggyDiagramReviewInput) {
  const userId = await requireUserId();
  const parsed = reviewSchema.parse(input);
  const link = await prisma.pluggyInvestmentDiagramLink.findFirst({
    where: { id: parsed.linkId, userId },
    select: { id: true },
  });
  if (!link) throw new Error("Investimento pendente não encontrado.");
  if (parsed.familyCode) {
    const family = await prisma.fixedIncomeFamily.findUnique({ where: { code: parsed.familyCode } });
    if (!family) throw new Error("Família de renda fixa não encontrada.");
  }
  const classifiesAsStoreOfValue = parsed.instrumentType === "ETF"
    && parsed.investmentClass === "STORE_OF_VALUE";
  await prisma.pluggyInvestmentDiagramLink.update({
    where: { id: link.id },
    data: {
      status: "NEEDS_REVIEW",
      classificationSource: "USER_OVERRIDE",
      suggestedInstrumentType: parsed.instrumentType,
      suggestedInvestmentClass: parsed.investmentClass,
      suggestedMarketRegion: classifiesAsStoreOfValue
        ? parsed.marketRegion
        : null,
      suggestedFamilyCode: parsed.familyCode ?? null,
      suggestedIndexation: parsed.indexation ?? null,
      reviewReason: null,
    },
  });
  await reconcilePluggyInvestmentsForUser(userId);
  const mapped = await prisma.pluggyInvestmentDiagramLink.findFirst({
    where: { id: link.id, userId },
    include: { holding: { select: { assetId: true } } },
  });
  if (!mapped?.holding) throw new Error("Não foi possível integrar este investimento.");
  const assetId = mapped.holding.assetId;
  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.update({
      where: { id: assetId },
      data: {
        score: parsed.score,
        marketRegion: classifiesAsStoreOfValue
          ? parsed.marketRegion
          : null,
        instrumentSource: "USER_OVERRIDE",
        exposureSource: "USER_OVERRIDE",
        groupSource: parsed.familyCode ? "USER_OVERRIDE" : "AUTO",
      },
      select: { portfolioId: true },
    });
    await bumpPortfolioAndInvalidateDrafts(tx, asset.portfolioId, userId);
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
      await lease.runFencedTransaction(async (tx) => {
        const link = await tx.pluggyInvestmentDiagramLink.findFirst({
          where: { id: parsed.linkId, userId },
          include: {
            investment: {
              include: {
                item: { select: { userId: true } },
              },
            },
            holding: {
              include: {
                asset: {
                  include: { portfolio: { select: { userId: true } } },
                },
              },
            },
          },
        });
        if (!link?.holding) throw new Error("Investimento conectado não encontrado na carteira.");
        if (link.investment.item.userId !== userId || link.holding.asset.portfolio.userId !== userId) {
          throw new Error("Investimento conectado não encontrado na carteira.");
        }
        if (link.updatedAt.getTime() !== parsed.expectedUpdatedAt.getTime()) {
          throw new Error("Os dados deste investimento mudaram. Reabra a edição e tente novamente.");
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

export async function excludePluggyDiagramLinkAction(linkId: string) {
  const userId = await requireUserId();
  const parsedId = z.string().cuid().parse(linkId);
  const link = await prisma.pluggyInvestmentDiagramLink.findFirst({
    where: { id: parsedId, userId },
    include: { holding: { select: { id: true, includedInTotals: true, asset: { select: { portfolioId: true } } } } },
  });
  if (!link) throw new Error("Investimento pendente não encontrado.");
  await prisma.$transaction(async (tx) => {
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
  const item = await prisma.pluggyItem.findFirst({
    where: {
      userId,
      pluggyItemId: parsedItemId,
      status: { not: "DELETED" },
    },
    select: { id: true },
  });
  if (!item) throw new Error("Conexão não encontrada.");

  const credentials = await requirePluggyCredentials(userId);
  try {
    await deletePluggyItem(credentials, parsedItemId);
  } catch (error) {
    if (!(error instanceof PluggyApiError) || error.status !== 404) throw error;
  }
  await markPluggyItemDisconnected(parsedItemId);

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
