import { Prisma, type InstrumentType, type PluggyInvestmentMetadataOverrideField } from "@/generated/prisma/client";
import { calculateHoldingAveragePrice } from "@/features/portfolio/average-price";
import { allowsFractionalUnits } from "@/features/portfolio/fractional-assets";
import { hasPluggyQuantityOverride, pendingPluggyQuantityChange } from "./investment-quantity-override";

export const CONTRIBUTION_UNIT_TYPES: InstrumentType[] = ["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT", "MUTUAL_FUND", "CRYPTO"];
export const activeContributionBatchInclude = {
  where: { state: { in: ["WAITING", "CONFLICT"] } },
  include: { suggestions: { orderBy: [{ expectedQuantityAfter: "asc" as const }, { id: "asc" as const }] } },
} satisfies Prisma.PluggyContributionBatchFindManyArgs;

const linkInclude = {
  investment: { include: { item: true } },
  holding: { include: { asset: { include: { portfolio: { select: { userId: true } } } } } },
  contributionBatches: activeContributionBatchInclude,
} satisfies Prisma.PluggyInvestmentDiagramLinkInclude;
type Link = Prisma.PluggyInvestmentDiagramLinkGetPayload<{ include: typeof linkInclude }>;
type Batch = Link["contributionBatches"][number];

export function sameContributionQuantity(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.toDecimalPlaces(10).eq(right.toDecimalPlaces(10));
}

function knownStartingCost(link: Link, quantity: Prisma.Decimal) {
  if (quantity.eq(0)) return new Prisma.Decimal(0);
  const summary = calculateHoldingAveragePrice({
    positionSource: "PLUGGY", quantity,
    investedValue: link.holding!.investedValue, providerCurrency: link.investment.currencyCode,
    amountOriginal: link.investment.amountOriginal,
    purchaseSummary: { version: link.investment.purchaseSummaryVersion, quantity: link.investment.purchaseQuantityTotal, cost: link.investment.purchaseCostTotal },
  });
  return summary.price && summary.coverage >= 1 && summary.currency === link.holding!.currency
    ? new Prisma.Decimal(summary.price.mul(quantity.toString()).toString()) : null;
}

function available(link: Link) {
  return link.status === "MAPPED" && link.holding?.positionSource === "PLUGGY"
    && link.holding.asset.portfolio.userId === link.userId && link.investment.item.userId === link.userId
    && CONTRIBUTION_UNIT_TYPES.includes(link.holding.asset.instrumentType)
    && link.investment.source === "INVESTMENTS_API" && link.investment.providerAvailable
    && link.investment.item.status !== "DELETED" && !link.investment.item.disconnectedAt;
}

async function setQuantity(tx: Prisma.TransactionClient, link: Link, quantity: Prisma.Decimal) {
  const holding = link.holding!;
  const batch = await tx.pluggyContributionBatch.findFirst({ where: { linkId: link.id, state: { in: ["WAITING", "CONFLICT"] } }, include: { suggestions: true } });
  const projectedCost = batch ? contributionCostProjection(batch) : null;
  const providerCost = link.investment.amountOriginal
    ?? (holding.pricingSource === "PLUGGY" ? link.investment.amount : null);
  await tx.assetHolding.update({ where: { id: holding.id }, data: {
    quantity,
    investedValue: batch ? projectedCost?.toDecimalPlaces(2) ?? null : providerCost,
    investedValueCurrency: batch ? projectedCost !== null ? batch.currency : null
      : providerCost !== null ? link.investment.currencyCode : null,
    currentValue: holding.pricingSource === "PLUGGY"
      ? batch ? quantity.mul(holding.unitPrice).toDecimalPlaces(2) : link.investment.balance
      : null,
    includedInTotals: quantity.gt(0) && holding.unitPrice.gt(0)
      && (holding.currency === "BRL" || Boolean(holding.fxRateToBrl?.gt(0))),
  } });
}

async function writeOverride(tx: Prisma.TransactionClient, link: Link, quantity: Prisma.Decimal, acknowledged: Prisma.Decimal) {
  await tx.pluggyInvestmentDiagramLink.update({ where: { id: link.id }, data: {
    metadataOverrideFields: { set: [...new Set<PluggyInvestmentMetadataOverrideField>([...link.metadataOverrideFields, "QUANTITY"])] },
    overrideQuantity: quantity, overrideQuantityProviderQuantity: acknowledged,
    overrideQuantityAcknowledgedAt: new Date(), metadataOverrideUpdatedAt: new Date(),
  } });
  await setQuantity(tx, link, quantity);
}

async function clearOverride(tx: Prisma.TransactionClient, link: Link) {
  const fields = link.metadataOverrideFields.filter((field) => field !== "QUANTITY");
  await tx.pluggyInvestmentDiagramLink.update({ where: { id: link.id }, data: {
    metadataOverrideFields: { set: fields }, overrideQuantity: null,
    overrideQuantityProviderQuantity: null, overrideQuantityAcknowledgedAt: null,
    metadataOverrideUpdatedAt: fields.length ? new Date() : null,
  } });
}

async function finishSuggestions(tx: Prisma.TransactionClient, suggestions: Batch["suggestions"], reason: string) {
  for (const suggestion of suggestions) {
    if (suggestion.executionStatus !== "AWAITING_SYNC") continue;
    await tx.contributionSuggestion.updateMany({
      where: { id: suggestion.id, executionStatus: "AWAITING_SYNC" },
      data: { executed: true, executionStatus: "EXECUTED", syncResolution: reason,
        confirmationReference: `PLUGGY_QUANTITY:${reason}:${suggestion.id}` },
    });
    const remaining = await tx.contributionSuggestion.count({ where: { simulationId: suggestion.simulationId, executed: false } });
    if (!remaining) await tx.contributionSimulation.update({ where: { id: suggestion.simulationId }, data: { status: "EXECUTED", executedAt: new Date() } });
  }
}

/** The batch owns an absolute position, not an amount repeatedly added to raw snapshots. */
export async function registerContributionQuantity(tx: Prisma.TransactionClient, input: {
  userId: string; assetId: string; suggestionId: string; holdingId: string;
  quantity: Prisma.Decimal; paidUnitPrice: Prisma.Decimal;
}) {
  const link = await tx.pluggyInvestmentDiagramLink.findFirst({
    where: { userId: input.userId, assetHoldingId: input.holdingId }, include: linkInclude,
  });
  if (!link?.holding || link.holding.assetId !== input.assetId || link.investment.item.userId !== input.userId
    || link.holding.asset.portfolio.userId !== input.userId
    || !available(link)) throw new Error("Selecione uma posição Open Finance ativa deste ativo.");
  const raw = link.investment.quantity;
  if (!raw || !raw.isFinite() || raw.lt(0)) throw new Error("A instituição não informou uma quantidade válida para esta posição.");
  if (!input.quantity.isFinite() || !input.quantity.gt(0) || input.quantity.decimalPlaces() > 10) throw new Error("Informe uma quantidade positiva com até dez casas decimais.");
  if (!input.paidUnitPrice.isFinite() || !input.paidUnitPrice.gt(0) || input.paidUnitPrice.decimalPlaces() > 10) throw new Error("Informe um preço positivo com até dez casas decimais.");
  if (!allowsFractionalUnits({ ...link.holding.asset, pricingSource: link.holding.pricingSource, fallback: link.holding.fractional }) && !input.quantity.isInteger()) {
    throw new Error("Este investimento aceita apenas quantidades inteiras.");
  }
  let batch = link.contributionBatches[0];
  if (batch?.state === "CONFLICT" || (!batch && pendingPluggyQuantityChange(raw, link))) {
    throw new Error("Resolva a revisão de quantidade desta posição antes de registrar outro aporte.");
  }
  const legacy = await tx.contributionSuggestion.count({ where: {
    assetId: input.assetId, executionStatus: "AWAITING_SYNC", usesQuantityProjection: false,
  } });
  if (legacy) throw new Error("Revise o aporte anterior aguardando sincronização antes de registrar outro.");
  const fx = link.holding.currency === "BRL" ? new Prisma.Decimal(1) : link.holding.fxRateToBrl;
  if (!fx?.gt(0)) throw new Error("A posição não possui câmbio válido. Sincronize e tente novamente.");
  if (!batch) {
    const baselineCost = knownStartingCost(link, link.holding.quantity);
    batch = await tx.pluggyContributionBatch.create({ data: {
      linkId: link.id, holdingId: link.holding.id, startingQuantity: link.holding.quantity,
      providerBaselineQuantity: raw, expectedQuantity: link.holding.quantity,
      acknowledgedQuantity: raw, observedQuantity: raw, providerUpdatedAt: link.investment.providerUpdatedAt,
      baselineCostNative: baselineCost, currency: link.holding.currency,
    }, include: { suggestions: true } });
  }
  if (batch.holdingId !== link.holding.id || batch.currency !== link.holding.currency) throw new Error("A posição mudou. Revise seus aportes antes de continuar.");
  const expected = batch.expectedQuantity.add(input.quantity);
  const valueNative = input.quantity.mul(input.paidUnitPrice);
  const claim = await tx.contributionSuggestion.updateMany({ where: {
    id: input.suggestionId, assetId: input.assetId, simulation: { userId: input.userId }, executionStatus: "PENDING", executed: false,
  }, data: {
    quantity: input.quantity, value: valueNative.mul(fx), paidUnitPrice: input.paidUnitPrice.mul(fx),
    nativeCurrency: link.holding.currency === "BRL" ? null : link.holding.currency,
    nativeValue: valueNative, nativeUnitPrice: link.holding.unitPrice,
    paidUnitPriceNative: input.paidUnitPrice, executionFxRateToBrl: fx, fxRateToBrl: fx,
    awaitingSyncAt: new Date(), baselineQuantity: raw, baselineValue: link.investment.balance,
    executionStatus: "AWAITING_SYNC", usesQuantityProjection: true, contributionBatchId: batch.id,
    expectedQuantityAfter: expected,
  } });
  if (claim.count !== 1) throw new Error("Esta sugestão já foi registrada ou mudou. Calcule novamente.");
  await tx.contributionExternalBaseline.create({ data: {
    suggestionId: input.suggestionId, holdingId: link.holding.id, quantity: raw,
    providerValue: link.investment.balance, currency: link.holding.currency, fxRateToBrl: fx,
  } });
  await tx.pluggyContributionBatch.update({ where: { id: batch.id }, data: { expectedQuantity: expected, revision: { increment: 1 } } });
  await writeOverride(tx, link, expected, batch.acknowledgedQuantity);
}

/** Missing/ambiguous legacy records remain pending and are explicitly exposed for review. */
async function initializeLegacy(tx: Prisma.TransactionClient, userId: string, assetIds?: readonly string[]) {
  let changed = false;
  const legacy = await tx.contributionSuggestion.findMany({ where: {
    executionStatus: "AWAITING_SYNC", usesQuantityProjection: false,
    simulation: { userId }, asset: { instrumentType: { in: CONTRIBUTION_UNIT_TYPES } },
    ...(assetIds ? { assetId: { in: [...assetIds] } } : {}),
    OR: [
      { externalBaselines: { some: { holding: { positionSource: "PLUGGY" } } } },
      { externalBaselines: { none: {} }, asset: { holdings: { some: { positionSource: "PLUGGY" } } } },
    ],
  }, include: { externalBaselines: true } });
  for (const suggestion of legacy) {
    const baseline = suggestion.externalBaselines.length === 1 ? suggestion.externalBaselines[0] : null;
    const link = baseline ? await tx.pluggyInvestmentDiagramLink.findFirst({ where: { userId, assetHoldingId: baseline.holdingId }, include: linkInclude }) : null;
    if (!baseline || !link?.holding || !available(link) || hasPluggyQuantityOverride(link) || link.contributionBatches.length
      || !link.investment.quantity || !suggestion.quantity.gt(0)
      || (!sameContributionQuantity(link.investment.quantity, baseline.quantity)
        && (!link.investment.providerUpdatedAt || !suggestion.awaitingSyncAt || link.investment.providerUpdatedAt < suggestion.awaitingSyncAt))) {
      if (suggestion.syncResolution !== "NEEDS_REVIEW") await tx.contributionSuggestion.update({ where: { id: suggestion.id }, data: { syncResolution: "NEEDS_REVIEW" } });
      continue;
    }
    const expected = baseline.quantity.add(suggestion.quantity);
    // Only a still-unchanged snapshot known before registration can supply
    // historical starting cost; newer or missing versions are ambiguous.
    const knownBaseline = baseline.currency === link.holding.currency
      && sameContributionQuantity(link.investment.quantity, baseline.quantity)
      && sameContributionQuantity(link.holding.quantity, baseline.quantity)
      && (baseline.quantity.eq(0) || Boolean(link.investment.providerUpdatedAt && suggestion.awaitingSyncAt
        && link.investment.providerUpdatedAt <= suggestion.awaitingSyncAt));
    const batch = await tx.pluggyContributionBatch.create({ data: {
      linkId: link.id, holdingId: link.holding.id, startingQuantity: baseline.quantity,
      providerBaselineQuantity: baseline.quantity, expectedQuantity: expected,
      acknowledgedQuantity: baseline.quantity, observedQuantity: baseline.quantity,
      providerUpdatedAt: link.investment.providerUpdatedAt,
      createdAt: suggestion.awaitingSyncAt ?? new Date(), currency: link.holding.currency,
      baselineCostNative: knownBaseline ? knownStartingCost(link, baseline.quantity) : null,
    } });
    await tx.contributionSuggestion.update({ where: { id: suggestion.id }, data: {
      usesQuantityProjection: true, contributionBatchId: batch.id, expectedQuantityAfter: expected, syncResolution: null,
    } });
    await writeOverride(tx, link, expected, baseline.quantity);
    changed = true;
  }
  return changed;
}

export async function reconcileContributionQuantities(tx: Prisma.TransactionClient, userId: string, assetIds?: readonly string[]) {
  if (assetIds && !assetIds.length) return false;
  const initialized = await initializeLegacy(tx, userId, assetIds);
  const links = await tx.pluggyInvestmentDiagramLink.findMany({ where: {
    userId, contributionBatches: { some: { state: { in: ["WAITING", "CONFLICT"] } } },
    ...(assetIds ? { holding: { assetId: { in: [...assetIds] } } } : {}),
  }, include: linkInclude });
  let changed = initialized;
  for (const link of links) {
    const batch = link.contributionBatches[0];
    if (!batch || !available(link) || batch.holdingId !== link.holding!.id) continue;
    const raw = link.investment.quantity, asOf = link.investment.providerUpdatedAt;
    const pending = batch.suggestions.filter((s) => s.executionStatus === "AWAITING_SYNC");
    const validChange = raw?.isFinite() && raw.gte(0) && !sameContributionQuantity(raw, batch.acknowledgedQuantity);
    if (raw && validChange && !asOf && (!batch.observedQuantity || !sameContributionQuantity(raw, batch.observedQuantity))) {
      // Without a provider version we cannot prove freshness, even for an
      // exact match. Expose the observation for an explicit user decision.
      await tx.pluggyContributionBatch.update({ where: { id: batch.id }, data: {
        state: "CONFLICT", observedQuantity: raw, revision: { increment: 1 },
      } });
      changed = true;
    }
    // A purchase can predate its manual registration. Compare the source's
    // version with the captured provider baseline, not the user's entry time.
    if (raw && validChange && asOf && asOf >= (batch.providerUpdatedAt ?? batch.createdAt)) {
      const index = pending.findIndex((s) => s.expectedQuantityAfter && sameContributionQuantity(raw, s.expectedQuantityAfter));
      if (index >= 0) {
        await finishSuggestions(tx, pending.slice(0, index + 1), "PROVIDER_MATCH");
        const complete = index === pending.length - 1;
        await tx.pluggyContributionBatch.update({ where: { id: batch.id }, data: {
          state: complete ? "RESOLVED" : "WAITING", resolvedAt: complete ? new Date() : null,
          acknowledgedQuantity: raw, observedQuantity: raw, providerUpdatedAt: asOf, revision: { increment: 1 },
        } });
        if (complete) { await clearOverride(tx, link); await setQuantity(tx, link, raw); changed = true; continue; }
        await writeOverride(tx, link, batch.expectedQuantity, raw);
        changed = true;
      } else if (!batch.observedQuantity || !sameContributionQuantity(raw, batch.observedQuantity)) {
        await tx.pluggyContributionBatch.update({ where: { id: batch.id }, data: {
          state: "CONFLICT", observedQuantity: raw, providerUpdatedAt: asOf, revision: { increment: 1 },
        } });
        changed = true;
      }
    }
    if (!link.holding!.quantity.eq(batch.expectedQuantity)) changed = true;
    await setQuantity(tx, link, batch.expectedQuantity);
  }
  return changed;
}

export async function resolveContributionQuantity(tx: Prisma.TransactionClient, linkId: string, decision: "PROVIDER" | "KEEP_MANUAL" | "DISCONNECTED_MANUAL" | "USER_REMOVED") {
  const link = await tx.pluggyInvestmentDiagramLink.findUnique({ where: { id: linkId }, include: linkInclude });
  const batch = link?.contributionBatches[0];
  if (!link || !batch) return false;
  if (decision === "KEEP_MANUAL") {
    const raw = link.investment.quantity;
    if (!raw) throw new Error("A instituição não informou uma quantidade válida.");
    await tx.pluggyContributionBatch.update({ where: { id: batch.id }, data: {
      state: "WAITING", acknowledgedQuantity: raw, observedQuantity: raw,
      providerUpdatedAt: link.investment.providerUpdatedAt ?? batch.providerUpdatedAt, revision: { increment: 1 },
    } });
    await writeOverride(tx, link, batch.expectedQuantity, raw);
  } else {
    await finishSuggestions(tx, batch.suggestions, decision === "PROVIDER" ? "USER_PROVIDER" : decision);
    await tx.pluggyContributionBatch.update({ where: { id: batch.id }, data: { state: "RESOLVED", resolvedAt: new Date(), revision: { increment: 1 } } });
    await clearOverride(tx, link);
    if (decision === "PROVIDER" && link.holding && link.investment.quantity) await setQuantity(tx, link, link.investment.quantity);
  }
  return true;
}

export async function refreshContributionQuantityCost(tx: Prisma.TransactionClient, suggestionId: string) {
  const link = await tx.pluggyInvestmentDiagramLink.findFirst({ where: {
    contributionBatches: { some: { state: { in: ["WAITING", "CONFLICT"] }, suggestions: { some: { id: suggestionId } } } },
  }, include: linkInclude });
  const batch = link?.contributionBatches[0];
  if (link && batch && available(link) && batch.holdingId === link.holding!.id) await setQuantity(tx, link, batch.expectedQuantity);
}

/** Explicit review is the only way to adopt an ambiguous historical baseline. */
export async function reviewLegacyContribution(tx: Prisma.TransactionClient, input: {
  userId: string; suggestionId: string; decision: "PROVIDER" | "PROJECT"; holdingId?: string; expectedQuantity?: Prisma.Decimal;
}) {
  const suggestion = await tx.contributionSuggestion.findFirst({ where: {
    id: input.suggestionId, simulation: { userId: input.userId }, executionStatus: "AWAITING_SYNC",
    usesQuantityProjection: false, syncResolution: "NEEDS_REVIEW", asset: { instrumentType: { in: CONTRIBUTION_UNIT_TYPES } },
  } });
  if (!suggestion) throw new Error("O aporte não está mais disponível para revisão.");
  const link = await tx.pluggyInvestmentDiagramLink.findFirst({ where: {
    userId: input.userId, assetHoldingId: input.holdingId ?? "", holding: { assetId: suggestion.assetId, asset: { portfolio: { userId: input.userId } } },
  }, include: linkInclude });
  const expected = input.expectedQuantity;
  if (!link?.holding || !available(link) || !link.investment.quantity || link.contributionBatches.length
    || !link.investment.quantity.isFinite() || link.investment.quantity.lt(0)) throw new Error("Selecione uma posição válida com quantidade informada pela instituição.");
  if (input.decision === "PROVIDER" || expected?.eq(link.investment.quantity)) {
    await finishSuggestions(tx, [suggestion], "USER_PROVIDER");
    await clearOverride(tx, link); await setQuantity(tx, link, link.investment.quantity);
    return;
  }
  if (!expected?.isFinite() || expected.lt(suggestion.quantity) || expected.decimalPlaces() > 10) throw new Error("Informe a quantidade total correta, incluindo este aporte.");
  if (!allowsFractionalUnits({ ...link.holding.asset, pricingSource: link.holding.pricingSource, fallback: link.holding.fractional }) && !expected.isInteger()) throw new Error("Este investimento aceita apenas quantidades inteiras.");
  const batch = await tx.pluggyContributionBatch.create({ data: {
    linkId: link.id, holdingId: link.holding.id, startingQuantity: expected.sub(suggestion.quantity),
    providerBaselineQuantity: link.investment.quantity, expectedQuantity: expected,
    acknowledgedQuantity: link.investment.quantity, observedQuantity: link.investment.quantity,
    providerUpdatedAt: link.investment.providerUpdatedAt, currency: link.holding.currency,
  } });
  await tx.contributionSuggestion.update({ where: { id: suggestion.id }, data: {
    contributionBatchId: batch.id, usesQuantityProjection: true, expectedQuantityAfter: expected, syncResolution: null,
  } });
  await writeOverride(tx, link, expected, link.investment.quantity);
}

/** Frozen starting cost + recorded purchases, including partially synced ones.
 * Raw provider cost changes must not add the same purchase a second time. */
export function contributionCostProjection(batch: {
  baselineCostNative: { toString(): string } | null;
  currency: string;
  suggestions: { quantity: { toString(): string }; paidUnitPriceNative: { toString(): string } | null; paidUnitPrice: { toString(): string } | null }[];
} | undefined) {
  if (!batch || batch.baselineCostNative === null) return null;
  let cost = new Prisma.Decimal(batch.baselineCostNative.toString());
  for (const s of batch.suggestions) {
    const price = s.paidUnitPriceNative ?? (batch.currency === "BRL" ? s.paidUnitPrice : null);
    if (!price) return null;
    cost = cost.add(new Prisma.Decimal(s.quantity.toString()).mul(price.toString()));
  }
  return cost;
}
