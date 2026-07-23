import type {
  FixedIncomeIndexation,
  InstrumentType,
  InvestmentClass,
  RateConvention,
} from "@prisma/client";

export type PluggyInvestmentForClassification = {
  id: string;
  pluggyInvestmentId: string;
  name: string;
  code: string | null;
  type: string;
  subtype: string | null;
  rateType: string | null;
  rate: { toString(): string } | string | number | null;
  fixedAnnualRate: { toString(): string } | string | number | null;
};

export type DiagramClassification = {
  instrumentType: InstrumentType | null;
  investmentClass: InvestmentClass | null;
  familyCode: string | null;
  indexation: FixedIncomeIndexation | null;
  catalogItemId: number | null;
  rateConvention: RateConvention | null;
  benchmark: string | null;
  rateValue: string | null;
  needsReview: boolean;
  reviewReason: string | null;
};

const FIXED_INCOME_SUBTYPES: Record<string, { familyCode: string; catalogItemId: number | null }> = {
  CDB: { familyCode: "BANK_DEPOSITS_FGC", catalogItemId: 5 },
  LC: { familyCode: "BANK_DEPOSITS_FGC", catalogItemId: 19 },
  LCI: { familyCode: "EXEMPT_CREDIT_LETTERS", catalogItemId: 6 },
  LCA: { familyCode: "EXEMPT_CREDIT_LETTERS", catalogItemId: 24 },
  TREASURY: { familyCode: "PUBLIC_TREASURY", catalogItemId: null },
  CRI: { familyCode: "SECURITIZED_RECEIVABLES", catalogItemId: 7 },
  CRA: { familyCode: "SECURITIZED_RECEIVABLES", catalogItemId: 27 },
  DEBENTURES: { familyCode: "CORPORATE_DEBT", catalogItemId: 8 },
  LF: { familyCode: "FINANCIAL_LETTERS", catalogItemId: 18 },
  LIG: { familyCode: "GUARANTEED_REAL_ESTATE_LETTERS", catalogItemId: 21 },
};

function normalizedText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function decimalString(value: PluggyInvestmentForClassification["rate"]) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed.toString() : null;
}

export function normalizePluggyTicker(value: string | null | undefined) {
  return normalizedText(value).replace(/\.SA$/, "");
}

export function normalizeFundDocument(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 14 ? digits : null;
}

export function isPluggyPositionActive(position: { status: string | null; providerAvailable: boolean }) {
  return position.providerAvailable && position.status === "ACTIVE";
}

export function isPluggyPositionSold(position: { status: string | null }) {
  return position.status === "TOTAL_WITHDRAWAL";
}

export function fundAssetCode(investment: Pick<PluggyInvestmentForClassification, "code" | "pluggyInvestmentId">) {
  const document = normalizeFundDocument(investment.code);
  return document ? `FND-${document}` : `FND-${investment.pluggyInvestmentId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

export function inferFixedIncomeIndexation(
  investment: Pick<PluggyInvestmentForClassification, "name" | "type" | "rateType" | "fixedAnnualRate" | "rate">,
) {
  const rateType = normalizedText(investment.rateType);
  if (rateType === "CDI" || rateType === "SELIC") return "POST_FIXED" as const;
  if (rateType === "IPCA" || rateType === "IGPM") return "INFLATION" as const;
  if (rateType === "DOLAR" || rateType === "EURO") return "OTHER" as const;
  if (decimalString(investment.fixedAnnualRate) !== null) return "PRE_FIXED" as const;
  const name = normalizedText(investment.name);
  if (/(^|[\s-])(PRE|PREFIXAD[OA])([\s-]|$)/.test(name) && decimalString(investment.rate) !== null) {
    return "PRE_FIXED" as const;
  }
  if (normalizedText(investment.type) === "FIXED_INCOME") return "PRE_FIXED" as const;
  return null;
}

export function inferRateDetails(
  investment: Pick<PluggyInvestmentForClassification, "rateType" | "fixedAnnualRate" | "rate">,
) {
  const benchmark = normalizedText(investment.rateType) || null;
  const rate = decimalString(investment.rate);
  const spread = decimalString(investment.fixedAnnualRate);
  if (benchmark && spread !== null) {
    return { rateConvention: "INDEXER_PLUS" as const, benchmark, rateValue: spread };
  }
  if (benchmark) {
    return { rateConvention: "PERCENT_OF_INDEXER" as const, benchmark, rateValue: rate };
  }
  if (spread !== null || rate !== null) {
    return { rateConvention: "FIXED_ANNUAL" as const, benchmark: null, rateValue: spread ?? rate };
  }
  return { rateConvention: null, benchmark: null, rateValue: null };
}

export function classifyPluggyInvestment(investment: PluggyInvestmentForClassification): DiagramClassification {
  const type = normalizedText(investment.type);
  const subtype = normalizedText(investment.subtype);
  const empty = {
    familyCode: null,
    indexation: null,
    catalogItemId: null,
    rateConvention: null,
    benchmark: null,
    rateValue: null,
  };

  if (type === "EQUITY" && (subtype === "STOCK" || subtype === "BDR")) {
    return {
      ...empty,
      instrumentType: "STOCK",
      investmentClass: "BRAZILIAN_STOCKS",
      needsReview: false,
      reviewReason: null,
    };
  }
  if (type === "EQUITY" && subtype === "REAL_ESTATE_FUND") {
    return {
      ...empty,
      instrumentType: "REAL_ESTATE_FUND",
      investmentClass: "REAL_ESTATE_FUNDS",
      needsReview: false,
      reviewReason: null,
    };
  }
  if (type === "ETF" && subtype === "ETF") {
    return {
      ...empty,
      instrumentType: "ETF",
      investmentClass: null,
      needsReview: true,
      reviewReason: "Selecione a classe de exposição do ETF.",
    };
  }
  if (type === "FIXED_INCOME") {
    const fixed = FIXED_INCOME_SUBTYPES[subtype];
    if (!fixed) {
      return {
        ...empty,
        instrumentType: "FIXED_INCOME",
        investmentClass: "FIXED_INCOME",
        needsReview: true,
        reviewReason: "O subtipo de renda fixa não possui um grupo automático.",
      };
    }
    const indexation = inferFixedIncomeIndexation(investment);
    const rateDetails = inferRateDetails(investment);
    return {
      instrumentType: "FIXED_INCOME",
      investmentClass: "FIXED_INCOME",
      familyCode: fixed.familyCode,
      indexation,
      catalogItemId: fixed.catalogItemId,
      ...rateDetails,
      needsReview: indexation === null,
      reviewReason: indexation === null ? "A instituição não informou a indexação deste investimento." : null,
    };
  }
  if (type === "MUTUAL_FUND" && subtype === "FIXED_INCOME_FUND") {
    return {
      ...empty,
      instrumentType: "MUTUAL_FUND",
      investmentClass: "FIXED_INCOME",
      needsReview: false,
      reviewReason: null,
    };
  }
  if (type === "MUTUAL_FUND" && subtype === "STOCK_FUND") {
    return {
      ...empty,
      instrumentType: "MUTUAL_FUND",
      investmentClass: "BRAZILIAN_STOCKS",
      needsReview: false,
      reviewReason: null,
    };
  }
  if (type === "MUTUAL_FUND") {
    return {
      ...empty,
      instrumentType: "MUTUAL_FUND",
      investmentClass: null,
      needsReview: true,
      reviewReason: "Selecione a classe de exposição deste fundo.",
    };
  }
  if (type === "COE" && subtype === "STRUCTURED_NOTE") {
    return {
      instrumentType: "FIXED_INCOME",
      investmentClass: "FIXED_INCOME",
      familyCode: "STRUCTURED_OPERATIONS",
      indexation: "OTHER",
      catalogItemId: 28,
      rateConvention: null,
      benchmark: null,
      rateValue: null,
      needsReview: false,
      reviewReason: null,
    };
  }
  return {
    ...empty,
    instrumentType: null,
    investmentClass: null,
    needsReview: true,
    reviewReason: "Este tipo de investimento precisa ser classificado manualmente.",
  };
}

export function applyExistingAssetClassification(
  classification: DiagramClassification,
  existing: {
    instrumentType: InstrumentType;
    instrumentSource: "AUTO" | "EXISTING_OVERRIDE" | "USER_OVERRIDE";
    investmentClass: InvestmentClass;
    fixedIncomeFamilyCode: string | null;
    indexation: FixedIncomeIndexation | null;
  },
) {
  return {
    ...classification,
    instrumentType: existing.instrumentSource !== "AUTO" || existing.instrumentType === "ETF"
      ? existing.instrumentType
      : classification.instrumentType,
    investmentClass: existing.investmentClass,
    familyCode: existing.fixedIncomeFamilyCode,
    indexation: existing.indexation,
    needsReview: false,
    reviewReason: null,
  } satisfies DiagramClassification;
}
