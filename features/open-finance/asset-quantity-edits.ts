import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { allowsFractionalUnits } from "@/features/portfolio/fractional-assets";
import { isPluggyPositionActive } from "./diagram-classification";
import { canEditPluggyInvestmentQuantity, hasPluggyQuantityOverride, samePluggyQuantity } from "./investment-quantity-override";
import { hasPluggyQuantityQuoteFx, resolvePluggyQuantityQuote, storedPluggyQuantityQuote, type PluggyQuantityQuote } from "./investment-quantity-quote";

export const assetQuantityEditSchema = z.object({
  linkId: z.string().cuid(),
  expectedUpdatedAt: z.coerce.date(),
  expectedProviderQuantity: z.string().max(64).nullable().refine((value) => {
    if (value === null) return true;
    try { return new Prisma.Decimal(value).isFinite(); } catch { return false; }
  }),
  mode: z.enum(["PROVIDER", "CUSTOM"]),
  value: z.number().finite().min(0).max(1e15).refine((value) => new Prisma.Decimal(value).decimalPlaces() <= 10).nullable(),
}).refine((value) => value.mode !== "CUSTOM" || value.value !== null, "Informe a quantidade temporária.");

type QuantityEdit = z.output<typeof assetQuantityEditSchema>;
type AssetContext = {
  id: string;
  ticker: string;
  instrumentType: string;
  investmentClass: string;
  marketRegion: string | null;
};
const include = {
  investment: { include: { item: { select: { userId: true, status: true, disconnectedAt: true } } } },
  holding: { include: { asset: { include: { portfolio: { select: { userId: true } }, holdings: true } } } },
} satisfies Prisma.PluggyInvestmentDiagramLinkInclude;

async function readQuantityLinks(
  client: Pick<Prisma.TransactionClient, "pluggyInvestmentDiagramLink">,
  userId: string,
  asset: AssetContext,
  edits: QuantityEdit[],
) {
  if (new Set(edits.map((edit) => edit.linkId)).size !== edits.length) throw new Error("Posição repetida na edição de quantidades.");
  const links = await client.pluggyInvestmentDiagramLink.findMany({
    where: { userId, id: { in: edits.map((edit) => edit.linkId) }, holding: { assetId: asset.id } }, include,
  });
  return edits.map((edit) => {
    const link = links.find((row) => row.id === edit.linkId);
    if (!link?.holding || link.userId !== userId || link.holding.assetId !== asset.id
      || link.investment.item.userId !== userId || link.holding.asset.portfolio.userId !== userId) {
      throw new Error("Posição conectada não encontrada neste ativo.");
    }
    if (link.updatedAt.getTime() !== edit.expectedUpdatedAt.getTime()
      || !samePluggyQuantity(link.investment.quantity, edit.expectedProviderQuantity === null ? null : new Prisma.Decimal(edit.expectedProviderQuantity))) {
      throw new Error("A posição mudou. Reabra a edição do ativo e confira as quantidades.");
    }
    if (!canEditPluggyInvestmentQuantity({ link, investment: link.investment, holding: link.holding })) {
      throw new Error("Esta posição não permite editar a quantidade temporária.");
    }
    const current = link.holding.asset;
    if (current.ticker !== asset.ticker || current.instrumentType !== asset.instrumentType
      || current.investmentClass !== asset.investmentClass || current.marketRegion !== asset.marketRegion) {
      throw new Error("Salve a classificação do ativo antes de alterar as quantidades.");
    }
    if (edit.mode === "CUSTOM" && !allowsFractionalUnits({
      instrumentType: current.instrumentType, investmentClass: current.investmentClass,
      pricingSource: link.holding.pricingSource, fallback: link.holding.fractional,
    }) && !new Prisma.Decimal(edit.value!).isInteger()) throw new Error("Este investimento aceita apenas quantidades inteiras.");
    return { ...link, holding: link.holding };
  });
}

export type PreparedAssetQuantityEdits = {
  edits: QuantityEdit[];
  quotes: Array<PluggyQuantityQuote | null>;
  asset: AssetContext;
};

/** Resolve only missing prices, before entering the fenced SQL transaction. */
export async function prepareAssetQuantityEdits(userId: string, asset: AssetContext, edits: QuantityEdit[], signal: AbortSignal) {
  const links = await readQuantityLinks(prisma, userId, asset, edits);
  const quotes: PreparedAssetQuantityEdits["quotes"] = [];
  for (const [index, edit] of edits.entries()) {
    const link = links[index];
    quotes.push(edit.mode === "CUSTOM" && edit.value! > 0
      ? await resolvePluggyQuantityQuote({
          userId, ticker: asset.ticker, holding: link.holding,
          manualHoldings: link.holding.asset.holdings.filter((holding) => holding.positionSource === "MANUAL"), signal,
        })
      : null);
  }
  return { edits, quotes, asset } satisfies PreparedAssetQuantityEdits;
}

export async function validateAssetQuantityEdits(tx: Prisma.TransactionClient, userId: string, prepared: PreparedAssetQuantityEdits) {
  return readQuantityLinks(tx, userId, prepared.asset, prepared.edits);
}

export async function applyAssetQuantityEdits(
  tx: Prisma.TransactionClient,
  prepared: PreparedAssetQuantityEdits,
  links: Awaited<ReturnType<typeof validateAssetQuantityEdits>>,
) {
  for (const [index, edit] of prepared.edits.entries()) {
    const link = links[index];
    const now = new Date();
    const custom = edit.mode === "CUSTOM";
    const quantity = custom ? new Prisma.Decimal(edit.value!) : link.investment.quantity ?? new Prisma.Decimal(0);
    const fields: typeof link.metadataOverrideFields = link.metadataOverrideFields.filter((field) => field !== "QUANTITY");
    if (custom) fields.push("QUANTITY");
    const recovered = prepared.quotes[index];
    const stored = recovered ? storedPluggyQuantityQuote([
      link.holding, ...link.holding.asset.holdings.filter((holding) => holding.positionSource === "MANUAL"),
    ]) : null;
    const quote = stored && recovered && hasPluggyQuantityQuoteFx(stored)
      && stored.priceUpdatedAt!.getTime() >= recovered.priceUpdatedAt!.getTime() ? stored : recovered;
    await tx.pluggyInvestmentDiagramLink.update({
      where: { id: link.id },
      data: {
        metadataOverrideFields: { set: fields }, overrideQuantity: custom ? quantity : null,
        ...(!custom ? { overrideQuantityProviderQuantity: null, overrideQuantityAcknowledgedAt: null }
          : !hasPluggyQuantityOverride(link) || !link.overrideQuantity!.eq(quantity) || !link.overrideQuantityAcknowledgedAt
            ? { overrideQuantityProviderQuantity: link.investment.quantity, overrideQuantityAcknowledgedAt: now } : {}),
        metadataOverrideUpdatedAt: fields.length ? now : null,
      },
    });
    await tx.assetHolding.update({
      where: { id: link.holding.id },
      data: {
        quantity, currentValue: null,
        includedInTotals: quantity.gt(0) && (custom || isPluggyPositionActive(link.investment)),
        ...(quote ? {
          pricingSource: quote.pricingSource, unitPrice: quote.unitPrice, currency: quote.currency,
          fxRateToBrl: quote.fxRateToBrl, fxUpdatedAt: quote.fxUpdatedAt, priceUpdatedAt: quote.priceUpdatedAt,
        } : {}),
      },
    });
  }
}
