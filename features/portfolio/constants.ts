export const INVESTMENT_CLASSES = [
  "INTERNATIONAL_STOCKS",
  "BRAZILIAN_STOCKS",
  "REAL_ESTATE_FUNDS",
  "REITS",
  "CRYPTO",
  "FIXED_INCOME",
  "STORE_OF_VALUE",
  "INTERNATIONAL_FIXED_INCOME",
] as const;

export type InvestmentClassKey = (typeof INVESTMENT_CLASSES)[number];

export const INSTRUMENT_TYPES = ["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT", "CRYPTO", "FIXED_INCOME", "MUTUAL_FUND"] as const;
export type InstrumentTypeKey = (typeof INSTRUMENT_TYPES)[number];

export const INSTRUMENT_TYPE_META: Record<InstrumentTypeKey, { label: string; color: string }> = {
  STOCK: { label: "Ação", color: "#d4a72c" },
  ETF: { label: "ETF", color: "#58a6ff" },
  REAL_ESTATE_FUND: { label: "FII", color: "#9b72cf" },
  REIT: { label: "REIT", color: "#ec6f66" },
  CRYPTO: { label: "Cripto", color: "#f28e2b" },
  FIXED_INCOME: { label: "Renda fixa", color: "#59a14f" },
  MUTUAL_FUND: { label: "Fundo", color: "#6f8fd8" },
};

export const FIXED_INCOME_INDEXATIONS = ["PRE_FIXED", "POST_FIXED", "INFLATION", "OTHER"] as const;
export type FixedIncomeIndexationKey = (typeof FIXED_INCOME_INDEXATIONS)[number];

export const FIXED_INCOME_INDEXATION_META: Record<FixedIncomeIndexationKey, { label: string; suffix: string }> = {
  PRE_FIXED: { label: "Pré-fixado", suffix: "PRE" },
  POST_FIXED: { label: "Pós-fixado", suffix: "POS" },
  INFLATION: { label: "Inflação", suffix: "INFLACAO" },
  OTHER: { label: "Outro / híbrido", suffix: "OUTRO" },
};

export const RATE_CONVENTIONS = ["FIXED_ANNUAL", "PERCENT_OF_INDEXER", "INDEXER_PLUS", "OTHER"] as const;
export type RateConventionKey = (typeof RATE_CONVENTIONS)[number];

export const RATE_CONVENTION_META: Record<RateConventionKey, string> = {
  FIXED_ANNUAL: "% ao ano",
  PERCENT_OF_INDEXER: "% do indexador",
  INDEXER_PLUS: "Indexador + %",
  OTHER: "Outra",
};

export const INVESTMENT_CLASS_META: Record<
  InvestmentClassKey,
  { label: string; shortLabel: string; color: string }
> = {
  INTERNATIONAL_STOCKS: { label: "Ações internacionais", shortLabel: "Ações int.", color: "#4f86f7" },
  BRAZILIAN_STOCKS: { label: "Ações nacionais", shortLabel: "Ações BR", color: "#d4a72c" },
  REAL_ESTATE_FUNDS: { label: "Fundos imobiliários", shortLabel: "FIIs", color: "#9b72cf" },
  REITS: { label: "REITs", shortLabel: "REITs", color: "#ec6f66" },
  CRYPTO: { label: "Criptomoedas", shortLabel: "Cripto", color: "#f28e2b" },
  FIXED_INCOME: { label: "Renda fixa", shortLabel: "Renda fixa", color: "#59a14f" },
  STORE_OF_VALUE: { label: "Reserva de valor", shortLabel: "Reserva", color: "#a7a9ac" },
  INTERNATIONAL_FIXED_INCOME: { label: "Renda fixa internacional", shortLabel: "RF int.", color: "#76b7b2" },
};

export const DEFAULT_TARGETS: Record<InvestmentClassKey, number> = {
  INTERNATIONAL_STOCKS: 10,
  BRAZILIAN_STOCKS: 20,
  REAL_ESTATE_FUNDS: 10,
  REITS: 5,
  CRYPTO: 5,
  FIXED_INCOME: 45,
  STORE_OF_VALUE: 0,
  INTERNATIONAL_FIXED_INCOME: 5,
};

export const INVESTMENT_PRESETS = [
  {
    slug: "conservador",
    name: "Conservador",
    description: "Prioriza estabilidade e renda fixa.",
    targets: {
      INTERNATIONAL_STOCKS: 2,
      BRAZILIAN_STOCKS: 3,
      REAL_ESTATE_FUNDS: 10,
      REITS: 0,
      CRYPTO: 0,
      FIXED_INCOME: 75,
      STORE_OF_VALUE: 0,
      INTERNATIONAL_FIXED_INCOME: 10,
    },
  },
  {
    slug: "moderado",
    name: "Moderado",
    description: "Combina crescimento e proteção em uma distribuição neutra de demonstração.",
    targets: DEFAULT_TARGETS,
  },
  {
    slug: "arrojado",
    name: "Arrojado",
    description: "Aceita maior volatilidade em busca de crescimento.",
    targets: {
      INTERNATIONAL_STOCKS: 20,
      BRAZILIAN_STOCKS: 25,
      REAL_ESTATE_FUNDS: 15,
      REITS: 10,
      CRYPTO: 10,
      FIXED_INCOME: 15,
      STORE_OF_VALUE: 0,
      INTERNATIONAL_FIXED_INCOME: 5,
    },
  },
] as const;

export const MOCK_ASSET_CATALOG = [
  { ticker: "AUVP11", name: "AUVP Capital Fundo", investmentClass: "BRAZILIAN_STOCKS", unitPrice: 121.34, fractional: false, currency: "BRL" },
  { ticker: "WEGE3", name: "WEG", investmentClass: "BRAZILIAN_STOCKS", unitPrice: 43.13, fractional: false, currency: "BRL" },
  { ticker: "VALE3", name: "Vale", investmentClass: "BRAZILIAN_STOCKS", unitPrice: 71.93, fractional: false, currency: "BRL" },
  { ticker: "HGLG11", name: "CSHG Logística", investmentClass: "REAL_ESTATE_FUNDS", unitPrice: 148.5, fractional: false, currency: "BRL" },
  { ticker: "VOO", name: "Vanguard S&P 500 ETF", investmentClass: "INTERNATIONAL_STOCKS", unitPrice: 2890, fractional: true, currency: "BRL" },
  { ticker: "O", name: "Realty Income", investmentClass: "REITS", unitPrice: 325.4, fractional: true, currency: "BRL" },
  { ticker: "BTC", name: "Bitcoin", investmentClass: "CRYPTO", unitPrice: 337136.97, fractional: true, currency: "BRL" },
  { ticker: "ETH", name: "Ethereum", investmentClass: "CRYPTO", unitPrice: 9876.6, fractional: true, currency: "BRL" },
  { ticker: "TESOURO-SELIC", name: "Tesouro Selic", investmentClass: "FIXED_INCOME", unitPrice: 1, fractional: true, currency: "BRL" },
  { ticker: "BND-US", name: "US Aggregate Bond", investmentClass: "INTERNATIONAL_FIXED_INCOME", unitPrice: 410.25, fractional: true, currency: "BRL" },
] as const;
