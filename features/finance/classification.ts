import type { BudgetCategoryKey } from "@/features/budget/constants";

export const DEFAULT_FINANCE_TAGS = {
  FOOD: { name: "Alimentação", color: "#ef4444" },
  HOME: { name: "Contas de Casa", color: "#f59e0b" },
  EDUCATION: { name: "Educação", color: "#3b82f6" },
  LEISURE: { name: "Lazer", color: "#a855f7" },
  TRANSPORT: { name: "Transporte", color: "#14b8a6" },
  CLOTHING: { name: "Vestuário", color: "#ec4899" },
} as const;

export type DefaultFinanceTagKey = keyof typeof DEFAULT_FINANCE_TAGS;
export type FinanceRuleMatchType =
  | "MERCHANT_CNPJ"
  | "MERCHANT_NAME"
  | "COUNTERPARTY_NAME"
  | "DESCRIPTION"
  | "DESCRIPTION_PREFIX"
  | "PROVIDER_CATEGORY";

export type ClassifiableTransaction = {
  kind: "INCOME" | "EXPENSE";
  description: string;
  descriptionRaw?: string | null;
  merchantCnpj?: string | null;
  merchantName?: string | null;
  merchantBusinessName?: string | null;
  counterpartyName?: string | null;
  providerCategory?: string | null;
  merchantCategory?: string | null;
};

export type ProviderClassification = {
  recognized: boolean;
  budgetCategory: BudgetCategoryKey | null;
  tagKeys: DefaultFinanceTagKey[];
  internalTransfer: boolean;
};

export type RuleCandidate = {
  matchType: FinanceRuleMatchType;
  matchValue: string;
  matchLabel: string;
};

function normalizedText(value?: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR");
}

function normalizedPrefixText(value?: string | null) {
  return normalizedText((value ?? "").replace(/\*+\s*$/, ""));
}

export function normalizeFinanceRuleValue(type: FinanceRuleMatchType, value?: string | null) {
  if (type === "MERCHANT_CNPJ") return (value ?? "").replace(/\D/g, "");
  if (type === "DESCRIPTION_PREFIX") return normalizedPrefixText(value);
  return normalizedText(value);
}

export function financeDescriptionMatchesPrefix(
  transaction: ClassifiableTransaction,
  prefix: string,
) {
  const normalizedDescription = normalizeFinanceRuleValue(
    "DESCRIPTION_PREFIX",
    transaction.descriptionRaw || transaction.description,
  );
  const normalizedPrefix = normalizeFinanceRuleValue("DESCRIPTION_PREFIX", prefix);
  return normalizedPrefix.length >= 2 && normalizedDescription.startsWith(normalizedPrefix);
}

function includesAny(value: string, candidates: readonly string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}

const INVESTMENT_CATEGORIES = [
  "INVESTMENT",
  "PENSION",
  "FIXED INCOME",
  "MUTUAL FUND",
  "VARIABLE INCOME",
  "MARGIN",
  "PROCEEDS INTERESTS AND DIVIDENDS",
  "TAXES ON INVESTMENTS",
] as const;

const EDUCATION_CATEGORIES = [
  "EDUCATION",
  "ONLINE COURSE",
  "UNIVERSITY",
  "SCHOOL",
  "KINDERGARTEN",
  "BOOKSTORE",
] as const;

const PLEASURE_CATEGORIES = [
  "FOOD DELIVERY",
  "EATING OUT",
  "LEISURE",
  "GAMBLING",
  "TRAVEL",
  "AIRPORT",
  "AIRLINES",
  "ACCOMMODATION",
  "MILEAGE",
  "BUS TICKET",
  "STADIUM",
  "MUSEUM",
  "CINEMA",
  "THEATER",
  "CONCERT",
  "DIGITAL SERVICE",
  "GAMING",
  "VIDEO STREAMING",
  "MUSIC STREAMING",
] as const;

const COMFORT_CATEGORIES = [
  "SHOPPING",
  "TRANSPORTATION",
  "AUTOMOTIVE",
  "GAS STATION",
  "PARKING",
  "TOLL",
  "CAR RENTAL",
  "BICYCLE",
  "TAXI",
  "RIDE HAILING",
  "PUBLIC TRANSPORTATION",
  "VEHICLE OWNERSHIP",
  "VEHICLE MAINTENANCE",
  "TRAFFIC TICKET",
  "WELLNESS",
  "FITNESS",
  "CLOTHING",
  "ELECTRONICS",
  "SPORTS GOOD",
  "PET SUPPLIES",
] as const;

const FIXED_COST_CATEGORIES = [
  "HOUSING",
  "RENT",
  "HOUSEWARE",
  "UTILIT",
  "WATER",
  "ELECTRICITY",
  "GAS",
  "TELECOMMUNICATION",
  "INTERNET",
  "MOBILE",
  "HEALTHCARE",
  "DENTIST",
  "PHARMACY",
  "OPTOMETRY",
  "HOSPITAL",
  "INSURANCE",
  "BANK FEE",
  "ACCOUNT FEE",
  "WIRE TRANSFER FEE",
  "ATM FEE",
  "CREDIT CARD FEE",
  "LEGAL OBLIGATION",
  "LOAN",
  "FINANCING",
  "URBAN LAND AND BUILDING TAX",
  "INCOME TAX",
  "TAX ON FINANCIAL OPERATIONS",
  "TAXES",
  "GROCERIES",
  "SERVICES",
] as const;

export function classifyProviderTransaction(transaction: ClassifiableTransaction): ProviderClassification {
  const category = normalizedText(
    [transaction.providerCategory, transaction.merchantCategory].filter(Boolean).join(" "),
  );

  if (category.startsWith("SAME PERSON TRANSFER") || category.startsWith("CREDIT CARD PAYMENT")) {
    return { recognized: true, budgetCategory: null, tagKeys: [], internalTransfer: true };
  }

  if (transaction.kind === "INCOME") {
    return { recognized: false, budgetCategory: null, tagKeys: [], internalTransfer: false };
  }

  if (includesAny(category, INVESTMENT_CATEGORIES)) {
    return {
      recognized: true,
      budgetCategory: "FINANCIAL_FREEDOM",
      tagKeys: [],
      internalTransfer: false,
    };
  }

  if (includesAny(category, EDUCATION_CATEGORIES)) {
    return {
      recognized: true,
      budgetCategory: "KNOWLEDGE",
      tagKeys: ["EDUCATION"],
      internalTransfer: false,
    };
  }

  if (includesAny(category, PLEASURE_CATEGORIES)) {
    return {
      recognized: true,
      budgetCategory: "PLEASURES",
      tagKeys: includesAny(category, ["FOOD DELIVERY", "EATING OUT"]) ? ["FOOD"] : ["LEISURE"],
      internalTransfer: false,
    };
  }

  if (includesAny(category, COMFORT_CATEGORIES)) {
    const tagKeys: DefaultFinanceTagKey[] = [];
    if (includesAny(category, ["TRANSPORTATION", "AUTOMOTIVE", "GAS STATION", "PARKING", "TOLL", "CAR RENTAL", "BICYCLE", "TAXI", "RIDE HAILING", "VEHICLE"])) {
      tagKeys.push("TRANSPORT");
    }
    if (category.includes("CLOTHING")) tagKeys.push("CLOTHING");
    return { recognized: true, budgetCategory: "COMFORT", tagKeys, internalTransfer: false };
  }

  if (includesAny(category, FIXED_COST_CATEGORIES)) {
    const tagKeys: DefaultFinanceTagKey[] = [];
    if (category.includes("GROCERIES")) tagKeys.push("FOOD");
    if (includesAny(category, ["HOUSING", "RENT", "HOUSEWARE", "UTILIT", "WATER", "ELECTRICITY", "GAS", "TELECOMMUNICATION", "INTERNET", "MOBILE", "HOME INSURANCE"])) {
      tagKeys.push("HOME");
    }
    return { recognized: true, budgetCategory: "FIXED_COSTS", tagKeys, internalTransfer: false };
  }

  return { recognized: false, budgetCategory: null, tagKeys: [], internalTransfer: false };
}

export function financeRuleCandidates(transaction: ClassifiableTransaction): RuleCandidate[] {
  const candidates: Array<[FinanceRuleMatchType, string | null | undefined, string | null | undefined]> = [
    ["MERCHANT_CNPJ", transaction.merchantCnpj, transaction.merchantCnpj],
    [
      "MERCHANT_NAME",
      transaction.merchantName || transaction.merchantBusinessName,
      transaction.merchantName || transaction.merchantBusinessName,
    ],
    ["COUNTERPARTY_NAME", transaction.counterpartyName, transaction.counterpartyName],
    [
      "DESCRIPTION",
      transaction.descriptionRaw || transaction.description,
      transaction.descriptionRaw || transaction.description,
    ],
    ["PROVIDER_CATEGORY", transaction.providerCategory, transaction.providerCategory],
  ];

  return candidates.flatMap(([matchType, value, label]) => {
    const matchValue = normalizeFinanceRuleValue(matchType, value);
    return matchValue
      ? [{ matchType, matchValue, matchLabel: label?.trim() || matchValue }]
      : [];
  });
}

export function preferredFinanceRuleCandidate(transaction: ClassifiableTransaction) {
  return financeRuleCandidates(transaction)[0] ?? null;
}
