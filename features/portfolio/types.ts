import type { FixedIncomeIndexationKey, InstrumentTypeKey, InvestmentClassKey, RateConventionKey } from "./constants";
export type PluggyInvestmentMetadataOverrideField =
  | "PRODUCT_NAME"
  | "ISSUER"
  | "PRODUCT_TYPE"
  | "RATE_TERMS"
  | "PURCHASE_DATE"
  | "MATURITY_DATE"
  | "QUANTITY";

export type ConnectedInvestmentMetadataDto = {
  linkId: string;
  expectedUpdatedAt: string;
  metadataOverrideUpdatedAt: string | null;
  overrideFields: PluggyInvestmentMetadataOverrideField[];
  instrumentType: InstrumentTypeKey;
  fixedIncomeFamilyCode: string | null;
  canEditMetadata: boolean;
  canEditQuantity: boolean;
  quantityStep: number;
  effectiveMetadata: {
    quantity: string;
    productName: string;
    issuer: string;
    catalogItemId: number | null;
    customTypeName: string | null;
    rateConvention: RateConventionKey | null;
    benchmark: string | null;
    rateValue: string | null;
    purchaseDate: string | null;
    maturityDate: string | null;
  };
  providerMetadata: {
    quantity: string | null;
    productName: string;
    issuer: string;
    type: string;
    subtype: string | null;
    rate: string | null;
    rateType: string | null;
    fixedAnnualRate: string | null;
    annualRate: string | null;
    purchaseDate: string | null;
    maturityDate: string | null;
    issuerCnpj: string | null;
  };
};

export type PluggyQuantityChangeDto = {
  linkId: string;
  expectedUpdatedAt: string;
  name: string;
  ticker: string | null;
  institution: string;
  previousProviderQuantity: string | null;
  providerQuantity: string | null;
  manualQuantity: string;
  contributionBatchId?: string;
  expectedRevision?: number;
  pendingContributions?: number;
};

export type InvestmentMetadataCatalogItemDto = {
  id: number;
  name: string;
  familyCode: string | null;
};


export type AssetHoldingDto = {
  id: string;
  catalogItemId: number | null;
  typeName: string;
  customTypeName: string | null;
  issuer: string;
  institution: string | null;
  productName: string;
  pricingSource: "MANUAL" | "BRAPI" | "YAHOO" | "BINANCE" | "PLUGGY" | "ACCOUNT_BALANCE";
  positionSource: "MANUAL" | "PLUGGY" | "BINANCE" | "ACCOUNT_BALANCE";
  accountBalanceSource?: {
    linkId: string; accountId: string; name: string; expectedUpdatedAt: string;
    alsoIncludedInAccountBalance: true; valuationUnavailable: boolean;
    fxSource: string | null;
  } | null;
  ticker: string | null;
  providerSymbol: string | null;
  brapiAssetType: string | null;
  brapiSubType: string | null;
  marketExchange: string | null;
  marketQuoteType: string | null;
  marketSector: string | null;
  marketIndustry: string | null;
  currency: string;
  quantity: string;
  unitPrice: string;
  unitPriceBrl: string;
  fxRateToBrl: string | null;
  fxUpdatedAt: string | null;
  investedValue: string | null;
  investedValueCurrency?: string | null;
  averagePricePaid: string | null;
  averagePriceCurrency?: string | null;
  averagePriceCoverage: number;
  currentValue: string;
  nativeCurrentValue: string | null;
  fractional: boolean;
  rateConvention: RateConventionKey | null;
  benchmark: string | null;
  rateValue: string | null;
  purchaseDate: string | null;
  maturityDate: string | null;
  logoUrl: string | null;
  priceUpdatedAt: string | null;
  providerCurrentValue: string | null;
  providerInvestmentSource: "INVESTMENTS_API" | "ACCOUNT_RESERVED_BALANCE" | "ACCOUNT_AUTOMATIC_BALANCE" | null;
  providerStatus: string | null;
  providerAvailable: boolean;
  transactionCount: number;
  connectedMetadata: ConnectedInvestmentMetadataDto | null;
  transactions: Array<{
    id: string;
    currencyCode?: string | null;
    description: string | null;
    type: string;
    movementType: string | null;
    quantity: string | null;
    value: string | null;
    amount: string | null;
    netAmount: string | null;
    agreedRate: string | null;
    date: string;
    tradeDate: string | null;
  }>;
  updatedAt: string;
};

export type AssetDto = {
  sourceOrder?: string;
  id: string;
  investmentClass: InvestmentClassKey;
  instrumentType: InstrumentTypeKey;
  ticker: string;
  name: string;
  fixedIncomeFamilyCode: string | null;
  fixedIncomeFamilyName: string | null;
  fixedIncomeFamilyShortCode: string | null;
  indexation: FixedIncomeIndexationKey | null;
  marketRegion: "BRAZIL" | "INTERNATIONAL" | null;
  logoUrl: string | null;
  currency: string;
  quantity: string;
  unitPrice: string;
  nativeUnitPrice: string | null;
  fxRateToBrl: string | null;
  fxUpdatedAt: string | null;
  manualValue: string | null;
  currentValue: string;
  nativeCurrentValue: string | null;
  nativeCurrency: string | null;
  investedValue?: string | null;
  investedValueCurrency?: string | null;
  averagePricePaid: string | null;
  averagePriceCurrency?: string | null;
  averagePriceCoverage: number;
  fractional: boolean;
  score: number;
  priceUpdatedAt: string | null;
  updatedAt: string;
  holdings: AssetHoldingDto[];
  providerControlled: boolean;
  needsScore: boolean;
  awaitingSyncContribution: {
    id?: string;
    quantity: string;
    value: string;
    paidUnitPrice: string | null;
    nativeCurrency: string | null;
    paidUnitPriceNative: string | null;
    executionFxRateToBrl: string | null;
    awaitingSyncAt: string | null;
  } | null;
  awaitingSyncContributions?: Array<{
    id: string; quantity: string; value: string; paidUnitPrice: string | null;
    nativeCurrency: string | null; paidUnitPriceNative: string | null;
    executionFxRateToBrl: string | null; awaitingSyncAt: string | null;
    quantityProjected: boolean; needsReview: boolean; holdingId: string | null;
  }>;
};

export type PortfolioDto = {
  allocationMethod?: import("./calculation/types").AllocationMethod;
  quantityChanges: PluggyQuantityChangeDto[];
  id: string;
  version: number;
  timeZone: string;
  targets: Record<InvestmentClassKey, number>;
  assets: AssetDto[];
  fixedIncomeFamilies: Array<{ code: string; name: string; shortCode: string; sortOrder: number }>;
  catalog: Array<{
    id: number;
    category: string;
    name: string;
    summary: string;
    familyCode: string | null;
  }>;
  integrationReview: Array<{
    id: string;
    source: "INVESTMENTS_API" | "ACCOUNT_RESERVED_BALANCE" | "ACCOUNT_AUTOMATIC_BALANCE" | "ACCOUNT_BALANCE";
    accountBalanceSource?: { accountId: string; expectedUpdatedAt: string; automaticBalanceConflicts: string[] };
    investmentName: string;
    institution: string;
    providerType: string;
    providerSubtype: string | null;
    balance: string;
    code: string | null;
    isin: string | null;
    value: string | null;
    quantity: string | null;
    amount: string | null;
    taxes: string | null;
    taxes2: string | null;
    amountProfit: string | null;
    amountWithdrawal: string | null;
    amountOriginal: string | null;
    lastMonthRate: string | null;
    annualRate: string | null;
    lastTwelveMonthsRate: string | null;
    currencyCode: string;
    quotaDate: string | null;
    owner: string | null;
    number: string | null;
    institutionNumber: string | null;
    insurerName: string | null;
    insurerCnpj: string | null;
    issuer: string | null;
    issuerCnpj: string | null;
    rate: string | null;
    rateType: string | null;
    fixedAnnualRate: string | null;
    purchaseDate: string | null;
    dueDate: string | null;
    issueDate: string | null;
    gracePeriodDate: string | null;
    metadata: unknown;
    status: string | null;
    updatedAt: string;
    transactions: Array<{
      id: string;
      description: string | null;
      type: string;
      movementType: string | null;
      quantity: string | null;
      value: string | null;
      amount: string | null;
      netAmount: string | null;
      agreedRate: string | null;
      brokerageNumber: string | null;
      date: string;
      tradeDate: string | null;
      expenses: unknown;
    }>;
    suggestedInstrumentType: InstrumentTypeKey | null;
    suggestedInvestmentClass: InvestmentClassKey | null;
    suggestedMarketRegion: "BRAZIL" | "INTERNATIONAL" | null;
    suggestedFamilyCode: string | null;
    suggestedIndexation: FixedIncomeIndexationKey | null;
    reviewReason: string | null;
  }>;
};

export type DiagramQuestionDto = {
  id: string;
  type: "CERRADO" | "REAL_ESTATE";
  criterion: string;
  text: string;
  active: boolean;
  isDefault: boolean;
  sortOrder: number;
};

export type SimulationDto = {
  budgetPolicy?: import("./calculation/types").BudgetPolicy;
  allocationMethod?: import("./calculation/types").AllocationMethod;
  calculation?: import("./calculation/types").CalculationDiagnostics;
  id: string;
  inputAmount: string;
  inputCurrency: "BRL" | "USD";
  allocationScope: "ALL_ASSETS" | "BRL_ONLY" | "USD_ONLY";
  requestedAmount: string;
  unallocatedAmount: string;
  unallocatedInputAmount: string;
  fxRateToBrl: string;
  fxUpdatedAt: string | null;
  fxSource: "NATIVE" | "YAHOO";
  suggestions: Array<{
    id: string;
    assetId: string;
    ticker: string;
    name: string;
    investmentClass: InvestmentClassKey;
    instrumentType: InstrumentTypeKey;
    quantity: string;
    value: string;
    nativeCurrency: string | null;
    nativeUnitPrice: string | null;
    nativeValue: string | null;
    fxRateToBrl: string | null;
    paidUnitPriceNative: string | null;
    suggestionPercentage: string;
    totalAfterSuggestionPercentage: string;
      executed: boolean;
      executionStatus: "PENDING" | "AWAITING_SYNC" | "EXECUTED";
  }>;
};
