"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/current-user";
import { assertUserOperationRateLimit } from "@/lib/operation-security";
import {
  FIXED_INCOME_INDEXATIONS,
  INSTRUMENT_TYPES,
  INVESTMENT_CLASSES,
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
});

export type PluggyDiagramReviewInput = z.input<typeof reviewSchema>;

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
  await prisma.pluggyInvestmentDiagramLink.update({
    where: { id: link.id },
    data: {
      status: "NEEDS_REVIEW",
      classificationSource: "USER_OVERRIDE",
      suggestedInstrumentType: parsed.instrumentType,
      suggestedInvestmentClass: parsed.investmentClass,
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
