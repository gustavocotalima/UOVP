import type { FixedIncomeIndexation, InstrumentType, InvestmentClass, MarketRegion } from "@prisma/client";

export const PLUGGY_DIAGRAM_EXCLUSION_REASON = {
  USER: "Excluído pelo usuário.",
  CONNECTION_REMOVE: "Posição removida do diagrama após a desconexão da instituição.",
  CONNECTION_KEEP_MANUAL: "Posição mantida manualmente após a desconexão da instituição.",
} as const;

export const PLUGGY_DIAGRAM_REVIEW_REASON = {
  ASSET_DELETE: "Ativo removido da carteira. Revise a classificação para adicioná-lo novamente.",
  CLASS_DELETE: "Classe removida da carteira. Revise a classificação para adicionar o investimento novamente.",
} as const;

type DeletedPluggyAssetClassification = {
  instrumentType: InstrumentType;
  investmentClass: InvestmentClass;
  marketRegion: MarketRegion | null;
  indexation: FixedIncomeIndexation | null;
};

export function reopenDeletedPluggyPositionForReview(
  asset: DeletedPluggyAssetClassification,
  reviewReason: string,
) {
  const fixedIncome = asset.instrumentType === "FIXED_INCOME";
  return {
    status: "NEEDS_REVIEW" as const,
    classificationSource: "USER_OVERRIDE" as const,
    suggestedInstrumentType: asset.instrumentType,
    suggestedInvestmentClass: fixedIncome ? asset.investmentClass : null,
    suggestedMarketRegion: null,
    suggestedFamilyCode: null,
    suggestedIndexation: fixedIncome ? asset.indexation : null,
    reviewReason,
  };
}

export function shouldReconcileExcludedPluggyPosition(link: {
  status: string;
  reviewReason: string | null;
}) {
  return link.status !== "EXCLUDED"
    || link.reviewReason === PLUGGY_DIAGRAM_EXCLUSION_REASON.CONNECTION_REMOVE;
}
