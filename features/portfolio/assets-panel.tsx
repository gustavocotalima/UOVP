"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Building2, ChevronDown, ChevronRight, Coins, Download, FileSpreadsheet, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DonutChart } from "@/components/charts/donut-chart";
import { formatMoney, formatPercent } from "@/lib/money";
import {
  deleteAssetAction,
  deleteAssetClassAction,
  deleteAssetHoldingAction,
  importPortfolioRowsAction,
  refreshMarketPricesAction,
  saveAssetAction,
  saveAssetAnswersAction,
  saveAssetHoldingAction,
  saveFixedIncomeGroupAction,
  searchBinanceAssetsAction,
  searchBrapiTickersAction,
  searchYahooTickersAction,
} from "./actions";
import { notifyPortfolioSimulationInvalidated } from "./client-events";
import { parseXlsxFile } from "./xlsx-parser";
import { exportPortfolioXlsx } from "./xlsx-export";
import type { BrapiTickerSearchResult } from "./brapi";
import type { BinanceAssetSearchResult } from "./binance";
import type { YahooSearchKind, YahooTickerSearchResult } from "./yahoo-finance";
import { FIXED_INCOME_INDEXATIONS, FIXED_INCOME_INDEXATION_META, INSTRUMENT_TYPES, INSTRUMENT_TYPE_META, INVESTMENT_CLASSES, INVESTMENT_CLASS_META, MOCK_ASSET_CATALOG, RATE_CONVENTIONS, RATE_CONVENTION_META, type FixedIncomeIndexationKey, type InstrumentTypeKey, type InvestmentClassKey, type RateConventionKey } from "./constants";
import type { AssetDto, AssetHoldingDto, DiagramQuestionDto, PortfolioDto } from "./types";
import { excludePluggyDiagramLinkAction, reviewPluggyDiagramLinkAction } from "@/features/open-finance/diagram-actions";

type FormAsset = {
  id?: string;
  instrumentType: InstrumentTypeKey;
  ticker: string;
  name: string;
  investmentClass: InvestmentClassKey;
  quantity: number;
  unitPrice: number;
  manualValue: number | null;
  currency: string;
  fractional: boolean;
  score: number;
  fixedIncomeFamilyCode: string | null;
  indexation: FixedIncomeIndexationKey | null;
  yahooReitConfirmed: boolean;
};

type MarketTickerOption =
  | (BrapiTickerSearchResult & { provider: "BRAPI" })
  | (YahooTickerSearchResult & { provider: "YAHOO" })
  | (BinanceAssetSearchResult & { provider: "BINANCE" });

type MarketTickerSearch =
  | { provider: "BRAPI"; kind: InvestmentClassKey | "ETF" }
  | { provider: "YAHOO"; kind: YahooSearchKind }
  | { provider: "BINANCE"; kind: "CRYPTO" };

type DeleteTarget =
  | { kind: "asset"; id: string; label: string }
  | { kind: "class"; investmentClass: InvestmentClassKey; label: string }
  | { kind: "holding"; id: string; label: string };

type FixedIncomeGroupForm = {
  id?: string;
  familyCode: string;
  indexation: FixedIncomeIndexationKey;
  investmentClass: "FIXED_INCOME" | "INTERNATIONAL_FIXED_INCOME";
  score: number;
};

type HoldingForm = {
  id?: string;
  assetId: string;
  catalogItemId: number | null;
  customTypeName: string;
  issuer: string;
  productName: string;
  investedValue: number | null;
  currentValue: number;
  rateConvention: RateConventionKey | null;
  benchmark: string;
  rateValue: number | null;
  purchaseDate: string;
  maturityDate: string;
};

type TickerListPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  transform?: string;
};

type ReviewForm = PortfolioDto["integrationReview"][number] & {
  instrumentType: InstrumentTypeKey | "";
  investmentClass: InvestmentClassKey | "";
  familyCode: string;
  indexation: FixedIncomeIndexationKey | "";
  score: number;
};

type HoldingTransactionsState = {
  transactions: AssetHoldingDto["transactions"];
  page: number;
  total: number;
  loading: boolean;
  error?: string;
};

const emptyAsset: FormAsset = {
  instrumentType: "STOCK",
  ticker: "",
  name: "",
  investmentClass: "BRAZILIAN_STOCKS",
  quantity: 0,
  unitPrice: 0,
  manualValue: null,
  currency: "BRL",
  fractional: false,
  score: 0,
  fixedIncomeFamilyCode: null,
  indexation: null,
  yahooReitConfirmed: false,
};

const emptyFixedGroup: FixedIncomeGroupForm = { familyCode: "", indexation: "PRE_FIXED", investmentClass: "FIXED_INCOME", score: 0 };

function currentValue(asset: AssetDto) {
  return Number(asset.currentValue);
}

function marketTickerSearchFor(form: FormAsset | null): MarketTickerSearch | null {
  if (!form || form.id) return null;
  const internationalClass = ["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(form.investmentClass);
  if (form.instrumentType === "ETF") {
    return internationalClass
      ? { provider: "YAHOO", kind: "ETF" }
      : { provider: "BRAPI", kind: "ETF" };
  }
  if (form.instrumentType === "STOCK" && form.investmentClass === "BRAZILIAN_STOCKS") {
    return { provider: "BRAPI", kind: "BRAZILIAN_STOCKS" };
  }
  if (form.instrumentType === "REAL_ESTATE_FUND" && form.investmentClass === "REAL_ESTATE_FUNDS") {
    return { provider: "BRAPI", kind: "REAL_ESTATE_FUNDS" };
  }
  if (form.instrumentType === "STOCK" && form.investmentClass === "INTERNATIONAL_STOCKS") {
    return { provider: "YAHOO", kind: "INTERNATIONAL_STOCKS" };
  }
  if (form.instrumentType === "REIT" && form.investmentClass === "REITS") {
    return { provider: "YAHOO", kind: "REITS" };
  }
  if (form.instrumentType === "CRYPTO" && form.investmentClass === "CRYPTO") {
    return { provider: "BINANCE", kind: "CRYPTO" };
  }
  return null;
}

function formatRateValue(value: string) {
  return Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function holdingProfitability(holding: AssetHoldingDto) {
  if (holding.rateValue === null) return null;
  const rate = `${formatRateValue(holding.rateValue)}%`;
  const benchmark = holding.benchmark?.trim().toUpperCase();

  if (holding.rateConvention === "INDEXER_PLUS") {
    return benchmark ? `100,00% ${benchmark} + ${rate}` : rate;
  }
  if (holding.rateConvention === "PERCENT_OF_INDEXER") {
    return benchmark ? `${rate} ${benchmark}` : rate;
  }
  if (holding.rateConvention === "FIXED_ANNUAL") {
    return `${rate} a.a.`;
  }
  return benchmark ? `${rate} ${benchmark}` : rate;
}

function operationTypeLabel(type: string) {
  const labels: Record<string, string> = {
    BUY: "Compra",
    SELL: "Venda",
    TRANSFER: "Transferência",
    DIVIDEND: "Dividendo",
    INTEREST: "Juros",
    AMORTIZATION: "Amortização",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

function reviewMoney(value: string, currency: string) {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  }
}

function reviewDecimal(value: string) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 8 });
}

function reviewPercentage(value: string) {
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
}

function reviewDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone }).format(new Date(value));
}

function reviewDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}

function reviewProfitability(review: ReviewForm) {
  const indexer = review.rateType?.trim().toUpperCase();
  const base = review.rate === null ? null : reviewPercentage(review.rate);
  const spread = review.fixedAnnualRate === null ? null : reviewPercentage(review.fixedAnnualRate);
  if (indexer && base && spread) return `${base} ${indexer} + ${spread} a.a.`;
  if (indexer && base) return `${base} ${indexer}`;
  if (spread) return `${spread} a.a.`;
  if (review.annualRate !== null) return `${reviewPercentage(review.annualRate)} a.a.`;
  return null;
}

function ReviewDetailsGrid({ title, details }: { title: string; details: Array<{ label: string; value: string | null }> }) {
  const visibleDetails = details.filter((detail): detail is { label: string; value: string } => detail.value !== null && detail.value !== "");
  if (!visibleDetails.length) return null;
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</h3>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleDetails.map((detail) => (
          <div key={detail.label} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{detail.label}</dt>
            <dd className="mt-1 break-words text-sm font-medium tabular-nums">{detail.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PluggyReviewSourceData({ review, timeZone }: { review: ReviewForm; timeZone: string }) {
  const metadataAvailable = Boolean(review.metadata && typeof review.metadata === "object");
  return (
    <div className="space-y-5 rounded-xl border bg-[var(--muted)]/15 p-4">
      <ReviewDetailsGrid
        title="Identificação e classificação do provedor"
        details={[
          { label: "Instituição", value: review.institution },
          { label: "Emissor", value: review.issuer },
          { label: "CNPJ do emissor", value: review.issuerCnpj },
          { label: "CNPJ da instituição", value: review.institutionNumber },
          { label: "Tipo Pluggy", value: review.providerType },
          { label: "Subtipo Pluggy", value: review.providerSubtype },
          { label: "Código / ticker", value: review.code },
          { label: "ISIN", value: review.isin },
          { label: "Titular", value: review.owner },
          { label: "Número do investimento", value: review.number },
          { label: "Seguradora", value: review.insurerName },
          { label: "CNPJ da seguradora", value: review.insurerCnpj },
          {
            label: "Sugestão automática",
            value: [
              review.suggestedInstrumentType ? INSTRUMENT_TYPE_META[review.suggestedInstrumentType].label : null,
              review.suggestedInvestmentClass ? INVESTMENT_CLASS_META[review.suggestedInvestmentClass].label : null,
            ].filter(Boolean).join(" · ") || null,
          },
          { label: "Família sugerida", value: review.suggestedFamilyCode },
          {
            label: "Indexação sugerida",
            value: review.suggestedIndexation ? FIXED_INCOME_INDEXATION_META[review.suggestedIndexation].label : null,
          },
        ]}
      />
      <ReviewDetailsGrid
        title="Posição, valores e rentabilidade"
        details={[
          { label: "Saldo atual", value: reviewMoney(review.balance, review.currencyCode) },
          { label: "Valor investido", value: review.amountOriginal === null ? null : reviewMoney(review.amountOriginal, review.currencyCode) },
          { label: "Valor bruto informado", value: review.amount === null ? null : reviewMoney(review.amount, review.currencyCode) },
          { label: "Lucro / prejuízo", value: review.amountProfit === null ? null : reviewMoney(review.amountProfit, review.currencyCode) },
          { label: "Disponível para resgate", value: review.amountWithdrawal === null ? null : reviewMoney(review.amountWithdrawal, review.currencyCode) },
          { label: "Quantidade", value: review.quantity === null ? null : reviewDecimal(review.quantity) },
          { label: "Valor unitário", value: review.value === null ? null : reviewMoney(review.value, review.currencyCode) },
          { label: "Rentabilidade contratada", value: reviewProfitability(review) },
          { label: "Indexador informado", value: review.rateType },
          { label: "Percentual do indexador", value: review.rate === null ? null : reviewPercentage(review.rate) },
          { label: "Taxa fixa / spread", value: review.fixedAnnualRate === null ? null : `${reviewPercentage(review.fixedAnnualRate)} a.a.` },
          { label: "Rentabilidade no mês", value: review.lastMonthRate === null ? null : reviewPercentage(review.lastMonthRate) },
          { label: "Rentabilidade em 12 meses", value: review.lastTwelveMonthsRate === null ? null : reviewPercentage(review.lastTwelveMonthsRate) },
          { label: "Rentabilidade anual", value: review.annualRate === null ? null : reviewPercentage(review.annualRate) },
          { label: "Imposto de renda", value: review.taxes === null ? null : reviewMoney(review.taxes, review.currencyCode) },
          { label: "IOF / outros impostos", value: review.taxes2 === null ? null : reviewMoney(review.taxes2, review.currencyCode) },
          { label: "Moeda", value: review.currencyCode },
        ]}
      />
      <ReviewDetailsGrid
        title="Datas e situação"
        details={[
          { label: "Emissão", value: review.issueDate ? reviewDate(review.issueDate, timeZone) : null },
          { label: "Compra", value: review.purchaseDate ? reviewDate(review.purchaseDate, timeZone) : null },
          { label: "Fim da carência", value: review.gracePeriodDate ? reviewDate(review.gracePeriodDate, timeZone) : null },
          { label: "Vencimento", value: review.dueDate ? reviewDate(review.dueDate, timeZone) : null },
          { label: "Data da posição", value: review.quotaDate ? reviewDate(review.quotaDate, timeZone) : null },
          { label: "Status no provedor", value: review.status },
          { label: "Atualizado pela instituição", value: reviewDateTime(review.updatedAt, timeZone) },
        ]}
      />
      {review.transactions.length > 0 && (
        <details className="rounded-xl border bg-[var(--card)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Movimentações informadas ({review.transactions.length})</summary>
          <div className="space-y-2 border-t p-3">
            {review.transactions.map((transaction) => (
              <div key={transaction.id} className="rounded-lg border px-3 py-2 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <strong>{transaction.type.replaceAll("_", " ")}</strong>
                    <p className="mt-0.5 text-[var(--muted-foreground)]">
                      {reviewDate(transaction.date, timeZone)}
                      {transaction.quantity !== null ? ` · ${reviewDecimal(transaction.quantity)} un.` : ""}
                      {transaction.description ? ` · ${transaction.description}` : ""}
                    </p>
                  </div>
                  <strong>{transaction.amount === null ? "—" : reviewMoney(transaction.amount, review.currencyCode)}</strong>
                </div>
                <p className="mt-1 text-[var(--muted-foreground)]">
                  {transaction.value !== null ? `Valor unitário: ${reviewMoney(transaction.value, review.currencyCode)}` : ""}
                  {transaction.netAmount !== null ? `${transaction.value !== null ? " · " : ""}Líquido: ${reviewMoney(transaction.netAmount, review.currencyCode)}` : ""}
                  {transaction.agreedRate !== null ? ` · Taxa acordada: ${reviewPercentage(transaction.agreedRate)}` : ""}
                  {transaction.brokerageNumber ? ` · Nota: ${transaction.brokerageNumber}` : ""}
                </p>
                {transaction.expenses !== null && transaction.expenses !== undefined && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[var(--primary)]">Despesas brutas</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-[10px]">{JSON.stringify(transaction.expenses, null, 2)}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      {metadataAvailable && (
        <details className="rounded-xl border bg-[var(--card)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Metadados brutos do Pluggy</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t p-4 text-[11px]">{JSON.stringify(review.metadata, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

function assetLogoUrl(asset: AssetDto) {
  if (asset.logoUrl) return asset.logoUrl;
  if (asset.instrumentType !== "ETF" && !["BRAZILIAN_STOCKS", "REAL_ESTATE_FUNDS"].includes(asset.investmentClass)) return null;
  const symbol = asset.ticker.trim().toUpperCase().replace(/\.SA$/, "").replace(/(\d)F$/, "$1");
  return symbol ? `https://icons.brapi.dev/icons/${encodeURIComponent(symbol)}.svg` : null;
}

function AssetLogo({ asset }: { asset: AssetDto }) {
  const logoUrl = assetLogoUrl(asset);
  const [loadedLogoUrl, setLoadedLogoUrl] = useState<string | null>(null);
  const logoLoaded = loadedLogoUrl === logoUrl;
  const captureLogoElement = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete) setLoadedLogoUrl(image.naturalWidth > 0 ? logoUrl : null);
  }, [logoUrl]);
  return (
    <span data-asset-logo-container className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border bg-white/95 text-neutral-500">
      {asset.instrumentType === "CRYPTO"
        ? <Coins className="size-4" aria-hidden="true" />
        : <Building2 className="size-4" aria-hidden="true" />}
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-asset-logo
          ref={captureLogoElement}
          src={logoUrl}
          alt={`Logo de ${asset.name}`}
          className={`absolute inset-[2px] h-[calc(100%-4px)] w-[calc(100%-4px)] rounded-[9px] object-contain ${logoLoaded ? "opacity-100" : "opacity-0"}`}
          loading="lazy"
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth > 0) setLoadedLogoUrl(logoUrl);
          }}
          onError={() => setLoadedLogoUrl(null)}
        />
      )}
    </span>
  );
}

function questionTypeForClass(investmentClass: InvestmentClassKey) {
  if (["BRAZILIAN_STOCKS", "INTERNATIONAL_STOCKS"].includes(investmentClass)) return "CERRADO" as const;
  if (["REAL_ESTATE_FUNDS", "REITS"].includes(investmentClass)) return "REAL_ESTATE" as const;
  return null;
}

export function AssetsPanel({
  assets,
  fixedIncomeFamilies,
  catalog,
  integrationReview,
  questions,
  initialAnswers,
  timeZone,
}: {
  assets: AssetDto[];
  fixedIncomeFamilies: PortfolioDto["fixedIncomeFamilies"];
  catalog: PortfolioDto["catalog"];
  integrationReview: PortfolioDto["integrationReview"];
  questions: DiagramQuestionDto[];
  initialAnswers: { assetId: string; questionId: string; answer: boolean }[];
  timeZone: string;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InvestmentClassKey | "ALL">("ALL");
  const [instrumentFilter, setInstrumentFilter] = useState<InstrumentTypeKey | "ALL">("ALL");
  const [form, setForm] = useState<FormAsset | null>(null);
  const [fixedGroupForm, setFixedGroupForm] = useState<FixedIncomeGroupForm | null>(null);
  const [holdingForm, setHoldingForm] = useState<HoldingForm | null>(null);
  const [reviewForm, setReviewForm] = useState<ReviewForm | null>(null);
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(() => new Set());
  const [holdingTransactions, setHoldingTransactions] = useState<Record<string, HoldingTransactionsState>>({});
  const [formAnswers, setFormAnswers] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const [tickerOptions, setTickerOptions] = useState<MarketTickerOption[]>([]);
  const [tickerSearchPending, setTickerSearchPending] = useState(false);
  const [tickerSearchError, setTickerSearchError] = useState<string>();
  const [tickerListOpen, setTickerListOpen] = useState(false);
  const [tickerListPosition, setTickerListPosition] = useState<TickerListPosition>();
  const [selectedMarketTicker, setSelectedMarketTicker] = useState<string>();
  const [activeTickerIndex, setActiveTickerIndex] = useState(-1);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tickerRequestId = useRef(0);
  const tickerInputFocused = useRef(false);
  const tickerInput = useRef<HTMLInputElement>(null);
  const updateTickerListPosition = useCallback(() => {
    const rect = tickerInput.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 8;
    const availableBelow = window.innerHeight - rect.bottom - gap;
    const availableAbove = rect.top - gap;
    const opensBelow = availableBelow >= 180 || availableBelow >= availableAbove;
    const availableHeight = opensBelow ? availableBelow : availableAbove;
    const width = Math.min(rect.width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setTickerListPosition({
      left,
      top: opensBelow ? rect.bottom + gap : rect.top - gap,
      width,
      maxHeight: Math.min(288, Math.max(96, availableHeight)),
      transform: opensBelow ? undefined : "translateY(-100%)",
    });
  }, []);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.dataset.assetsPanelHydrated = "true";
    return () => {
      delete panel.dataset.assetsPanelHydrated;
    };
  }, []);
  const filtered = useMemo(
    () => assets.filter((asset) => {
      const query = search.trim().toLowerCase();
      const matchesText = !query
        || asset.ticker.toLowerCase().includes(query)
        || asset.name.toLowerCase().includes(query)
        || asset.holdings.some((holding) => [holding.typeName, holding.issuer, holding.productName, holding.ticker ?? ""].some((value) => value.toLowerCase().includes(query)));
      return (filter === "ALL" || asset.investmentClass === filter)
        && (instrumentFilter === "ALL" || asset.instrumentType === instrumentFilter)
        && matchesText;
    }),
    [assets, filter, instrumentFilter, search],
  );
  const showAssetAveragePrice = filtered.some((asset) => asset.averagePricePaid !== null);
  const searchExpandedAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return new Set<string>();
    return new Set(
      assets
        .filter((asset) => asset.holdings.some((holding) =>
          [holding.typeName, holding.issuer, holding.productName, holding.ticker ?? ""]
            .some((value) => value.toLowerCase().includes(query)),
        ))
        .map((asset) => asset.id),
    );
  }, [assets, search]);
  const total = assets.reduce((sum, asset) => sum + currentValue(asset), 0);
  const chartData = INVESTMENT_CLASSES.map((investmentClass) => ({
    name: INVESTMENT_CLASS_META[investmentClass].label,
    color: INVESTMENT_CLASS_META[investmentClass].color,
    value: assets.filter((asset) => asset.investmentClass === investmentClass).reduce((sum, asset) => sum + currentValue(asset), 0),
  })).filter((item) => item.value > 0);
  const hasRefreshableQuotes = assets.some((asset) =>
    asset.holdings.some((holding) => holding.pricingSource === "BRAPI")
    || (asset.instrumentType === "CRYPTO" && asset.investmentClass === "CRYPTO" && asset.holdings.some((holding) => Boolean(holding.ticker)))
    || (
      ["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(asset.investmentClass)
      && ["STOCK", "REIT", "ETF"].includes(asset.instrumentType)
      && asset.holdings.some((holding) => Boolean(holding.ticker))
    ),
  );

  const formQuestionType = form && !["ETF", "MUTUAL_FUND"].includes(form.instrumentType) ? questionTypeForClass(form.investmentClass) : null;
  const editingAsset = form?.id ? assets.find((asset) => asset.id === form.id) : undefined;
  const formQuestions = questions.filter((question) => question.active && question.type === formQuestionType);
  const positives = formQuestions.filter((question) => formAnswers[question.id] === true).length;
  const negatives = formQuestions.length - positives;
  const marketTickerSearch = marketTickerSearchFor(form);
  const marketTickerProvider = marketTickerSearch?.provider;
  const marketTickerKind = marketTickerSearch?.kind;
  const usesMarketTickerSearch = marketTickerSearch !== null;
  const tickerQuery = marketTickerSearch && form ? form.ticker.trim() : "";
  const hasSelectedMarketTicker = !usesMarketTickerSearch || selectedMarketTicker === form?.ticker;
  const selectedYahooTicker = tickerOptions.find((option) =>
    option.provider === "YAHOO" && option.symbol === selectedMarketTicker,
  );
  const requiresYahooReitConfirmation = form?.investmentClass === "REITS"
    && selectedYahooTicker?.provider === "YAHOO"
    && selectedYahooTicker.requiresReitConfirmation;

  useEffect(() => {
    const requestId = ++tickerRequestId.current;
    if (selectedMarketTicker === tickerQuery || tickerQuery.length < 2) return;

    const timer = window.setTimeout(async () => {
      setTickerSearchPending(true);
      setTickerSearchError(undefined);
      try {
        if (!marketTickerProvider || !marketTickerKind) return;
        const options: MarketTickerOption[] = marketTickerProvider === "BRAPI"
          ? (await searchBrapiTickersAction(tickerQuery, marketTickerKind as InvestmentClassKey | "ETF"))
              .map((option) => ({ ...option, provider: "BRAPI" as const }))
          : marketTickerProvider === "YAHOO"
            ? (await searchYahooTickersAction(tickerQuery, marketTickerKind as YahooSearchKind))
                .map((option) => ({ ...option, provider: "YAHOO" as const }))
            : (await searchBinanceAssetsAction(tickerQuery))
                .map((option) => ({ ...option, provider: "BINANCE" as const }));
        if (tickerRequestId.current !== requestId) return;
        setTickerOptions(options);
        setActiveTickerIndex(options.length ? 0 : -1);
        updateTickerListPosition();
        setTickerListOpen(tickerInputFocused.current);
      } catch (error) {
        if (tickerRequestId.current !== requestId) return;
        setTickerOptions([]);
        setActiveTickerIndex(-1);
        setTickerSearchError(error instanceof Error ? error.message : "Não foi possível buscar tickers.");
        updateTickerListPosition();
        setTickerListOpen(tickerInputFocused.current);
      } finally {
        if (tickerRequestId.current === requestId) setTickerSearchPending(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [selectedMarketTicker, marketTickerKind, marketTickerProvider, tickerQuery, updateTickerListPosition]);

  useEffect(() => {
    if (!tickerListOpen) return;
    const reposition = () => updateTickerListPosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [tickerListOpen, updateTickerListPosition]);

  function startAdding() {
    setForm({ ...emptyAsset });
    setSelectedMarketTicker(undefined);
    setFormAnswers({});
    setTickerOptions([]);
    setTickerSearchError(undefined);
    setTickerListOpen(false);
    setActiveTickerIndex(-1);
    setMessage(undefined);
  }

  function edit(asset: AssetDto) {
    if (asset.instrumentType === "FIXED_INCOME") {
      setFixedGroupForm({
        id: asset.id,
        familyCode: asset.fixedIncomeFamilyCode ?? "",
        indexation: asset.indexation ?? "OTHER",
        investmentClass: asset.investmentClass === "INTERNATIONAL_FIXED_INCOME" ? "INTERNATIONAL_FIXED_INCOME" : "FIXED_INCOME",
        score: asset.score,
      });
      return;
    }
    setSelectedMarketTicker(undefined);
    const questionType = asset.instrumentType === "ETF" ? null : questionTypeForClass(asset.investmentClass);
    const applicable = questions.filter((question) => question.active && question.type === questionType);
    setForm({
      id: asset.id,
      instrumentType: asset.instrumentType,
      ticker: asset.ticker,
      name: asset.name,
      investmentClass: asset.investmentClass,
      quantity: Number(asset.quantity),
      unitPrice: Number(asset.unitPrice),
      manualValue: asset.manualValue == null ? null : Number(asset.manualValue),
      currency: asset.currency,
      fractional: asset.fractional,
      score: asset.score,
      fixedIncomeFamilyCode: asset.fixedIncomeFamilyCode,
      indexation: asset.indexation,
      yahooReitConfirmed: false,
    });
    setFormAnswers(Object.fromEntries(applicable.map((question) => [
      question.id,
      initialAnswers.find((answer) => answer.assetId === asset.id && answer.questionId === question.id)?.answer ?? false,
    ])));
    setMessage(undefined);
  }

  function startHolding(asset: AssetDto, holding?: AssetHoldingDto) {
    setHoldingForm({
      id: holding?.id,
      assetId: asset.id,
      catalogItemId: holding?.catalogItemId ?? null,
      customTypeName: holding?.customTypeName ?? "",
      issuer: holding?.issuer ?? "",
      productName: holding?.productName ?? "",
      investedValue: holding?.investedValue == null ? null : Number(holding.investedValue),
      currentValue: Number(holding?.currentValue ?? 0),
      rateConvention: holding?.rateConvention ?? null,
      benchmark: holding?.benchmark ?? "",
      rateValue: holding?.rateValue == null ? null : Number(holding.rateValue),
      purchaseDate: holding?.purchaseDate?.slice(0, 10) ?? "",
      maturityDate: holding?.maturityDate?.slice(0, 10) ?? "",
    });
  }

  async function loadHoldingTransactions(holdingId: string, page = 1, append = false) {
    setHoldingTransactions((current) => ({
      ...current,
      [holdingId]: {
        transactions: append ? current[holdingId]?.transactions ?? [] : [],
        page: append ? current[holdingId]?.page ?? 0 : 0,
        total: current[holdingId]?.total ?? 0,
        loading: true,
      },
    }));
    try {
      const response = await fetch(
        `/api/portfolio/holdings/${encodeURIComponent(holdingId)}/transactions?page=${page}&pageSize=25`,
      );
      const payload = await response.json() as {
        error?: string;
        page: number;
        total: number;
        transactions: AssetHoldingDto["transactions"];
      };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as movimentações.");
      setHoldingTransactions((current) => ({
        ...current,
        [holdingId]: {
          transactions: append
            ? [...(current[holdingId]?.transactions ?? []), ...payload.transactions]
            : payload.transactions,
          page: payload.page,
          total: payload.total,
          loading: false,
        },
      }));
    } catch (error) {
      setHoldingTransactions((current) => ({
        ...current,
        [holdingId]: {
          transactions: current[holdingId]?.transactions ?? [],
          page: current[holdingId]?.page ?? 0,
          total: current[holdingId]?.total ?? 0,
          loading: false,
          error: error instanceof Error ? error.message : "Não foi possível carregar as movimentações.",
        },
      }));
    }
  }

  function toggleExpanded(assetId: string) {
    const opening = !expandedAssets.has(assetId);
    setExpandedAssets((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
    if (opening) {
      const asset = assets.find((item) => item.id === assetId);
      for (const holding of asset?.holdings ?? []) {
        if (holding.transactionCount > 0 && !holdingTransactions[holding.id]) {
          void loadHoldingTransactions(holding.id);
        }
      }
    }
  }

  function changeTicker(value: string) {
    if (!form) return;
    const ticker = value.toUpperCase();
    const tickerSearch = marketTickerSearchFor(form);
    if (tickerSearch) {
      setSelectedMarketTicker(undefined);
      setForm({
        ...form,
        ticker,
        name: ticker,
        unitPrice: 0,
        currency: tickerSearch.provider === "YAHOO" ? "USD" : "BRL",
        fractional: tickerSearch.provider === "YAHOO" || tickerSearch.provider === "BINANCE",
        yahooReitConfirmed: false,
      });
      updateTickerListPosition();
      if (ticker.length < 2) {
        setTickerOptions([]);
        setTickerSearchError(undefined);
        setTickerSearchPending(false);
        setTickerListOpen(false);
        setActiveTickerIndex(-1);
      } else {
        setTickerListOpen(true);
        setActiveTickerIndex(-1);
      }
      return;
    }
    const catalogAsset = MOCK_ASSET_CATALOG.find((asset) => asset.ticker === ticker && asset.investmentClass === form.investmentClass);
    setForm({
      ...form,
      ticker,
      name: catalogAsset?.name ?? ticker,
      unitPrice: catalogAsset?.unitPrice ?? form.unitPrice,
      currency: catalogAsset?.currency ?? form.currency,
      fractional: catalogAsset?.fractional ?? form.fractional,
    });
  }

  function selectTicker(option: MarketTickerOption) {
    if (!form) return;
    setSelectedMarketTicker(option.symbol);
    setForm({
      ...form,
      ticker: option.symbol,
      name: option.name,
      unitPrice: option.provider === "BRAPI" ? option.lastPrice ?? 0 : 0,
      currency: option.provider === "BINANCE"
        ? option.quoteAsset
        : option.currency ?? (option.provider === "YAHOO" ? "USD" : "BRL"),
      fractional: option.provider === "YAHOO" || option.provider === "BINANCE",
      yahooReitConfirmed: option.provider === "YAHOO" && option.requiresReitConfirmation
        ? false
        : form.yahooReitConfirmed,
    });
    setTickerSearchPending(false);
    setTickerListOpen(false);
    setActiveTickerIndex(-1);
  }

  function handleTickerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setTickerListOpen(false);
      return;
    }
    if (!tickerListOpen || !tickerOptions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveTickerIndex((current) => current < tickerOptions.length - 1 ? current + 1 : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveTickerIndex((current) => current > 0 ? current - 1 : tickerOptions.length - 1);
    } else if (event.key === "Enter" && activeTickerIndex >= 0) {
      event.preventDefault();
      selectTicker(tickerOptions[activeTickerIndex]);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    if (usesMarketTickerSearch && !hasSelectedMarketTicker) return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        await saveAssetAction(form);
        if (form.id && formQuestionType) await saveAssetAnswersAction(form.id, formAnswers);
        notifyPortfolioSimulationInvalidated();
        setForm(null);
        setMessage(form.id ? "Ativo atualizado." : "Ativo adicionado.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar.");
      }
    });
  }

  function submitFixedGroup(event: FormEvent) {
    event.preventDefault();
    if (!fixedGroupForm?.familyCode) return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        await saveFixedIncomeGroupAction(fixedGroupForm);
        notifyPortfolioSimulationInvalidated();
        setFixedGroupForm(null);
        setMessage(fixedGroupForm.id ? "Grupo de renda fixa atualizado." : "Grupo de renda fixa adicionado.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar o grupo.");
      }
    });
  }

  function submitHolding(event: FormEvent) {
    event.preventDefault();
    if (!holdingForm) return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        await saveAssetHoldingAction(holdingForm.assetId, {
          ...holdingForm,
          customTypeName: holdingForm.catalogItemId ? null : holdingForm.customTypeName,
          benchmark: holdingForm.benchmark || null,
          purchaseDate: holdingForm.purchaseDate || null,
          maturityDate: holdingForm.maturityDate || null,
        });
        notifyPortfolioSimulationInvalidated();
        setExpandedAssets((current) => new Set([...current, holdingForm.assetId]));
        setHoldingForm(null);
        setMessage(holdingForm.id ? "Aplicação atualizada." : "Aplicação adicionada.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar a aplicação.");
      }
    });
  }

  function confirmDeletion() {
    if (!deleteTarget) return;
    startTransition(async () => {
      try {
        if (deleteTarget.kind === "asset") await deleteAssetAction(deleteTarget.id);
        else if (deleteTarget.kind === "holding") await deleteAssetHoldingAction(deleteTarget.id);
        else await deleteAssetClassAction(deleteTarget.investmentClass);
        notifyPortfolioSimulationInvalidated();
        setForm(null);
        setDeleteTarget(undefined);
        setMessage("Remoção concluída.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível remover.");
      }
    });
  }

  function refreshMarketPrices() {
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await refreshMarketPricesAction();
        const parts = [
          result.brapi.requested
            ? result.brapi.error
              ? `B3 não atualizada: ${result.brapi.error}`
              : `B3: ${result.brapi.updated} atualizada(s)`
            : null,
          result.yahoo.requested
            ? result.yahoo.error
              ? `Internacionais não atualizados: ${result.yahoo.error}`
              : `Internacionais: ${result.yahoo.updated} atualizada(s)`
            : null,
          result.binance.requested
            ? result.binance.error
              ? `Criptomoedas não atualizadas: ${result.binance.error}`
              : `Criptomoedas: ${result.binance.updated} atualizada(s)`
            : null,
        ].filter(Boolean);
        const missing = [...result.brapi.missing, ...result.yahoo.missing, ...result.binance.missing];
        if (missing.length) parts.push(`Sem cotação: ${[...new Set(missing)].join(", ")}`);
        if (result.yahoo.missingFx.length) parts.push(`Sem câmbio: ${result.yahoo.missingFx.join(", ")}`);
        if (result.binance.missingConversion.length) {
          parts.push(`Sem conversão Binance para BRL: ${result.binance.missingConversion.join(", ")}`);
        }
        if (result.brapi.updated + result.yahoo.updated + result.binance.updated > 0) {
          notifyPortfolioSimulationInvalidated();
        }
        setMessage(parts.length ? `${parts.join(" · ")}.` : "Não há cotações para atualizar.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível atualizar as cotações.");
      }
    });
  }

  function openReview(item: PortfolioDto["integrationReview"][number]) {
    setReviewForm({
      ...item,
      instrumentType: item.suggestedInstrumentType ?? "",
      investmentClass: item.suggestedInvestmentClass ?? "",
      familyCode: item.suggestedFamilyCode ?? "",
      indexation: item.suggestedIndexation ?? (item.providerType === "FIXED_INCOME" ? "PRE_FIXED" : ""),
      score: 0,
    });
  }

  function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!reviewForm) return;
    const review = reviewForm;
    if (!review.instrumentType || !review.investmentClass) {
      setMessage("Selecione o instrumento e a classe para metas.");
      return;
    }
    const instrumentType: InstrumentTypeKey = review.instrumentType;
    const investmentClass: InvestmentClassKey = review.investmentClass;
    const groupedFixedIncome = instrumentType === "FIXED_INCOME"
      || (instrumentType === "ETF"
        && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(investmentClass));
    if (groupedFixedIncome && (!review.familyCode || !review.indexation)) {
      setMessage("Selecione a família e a indexação da renda fixa.");
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      try {
        await reviewPluggyDiagramLinkAction({
          linkId: review.id,
          instrumentType,
          investmentClass,
          familyCode: review.familyCode || null,
          indexation: review.indexation || null,
          score: review.score,
        });
        notifyPortfolioSimulationInvalidated();
        setReviewForm(null);
        setMessage("Investimento integrado ao diagrama.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível integrar o investimento.");
      }
    });
  }

  function excludeReview() {
    if (!reviewForm) return;
    startTransition(async () => {
      try {
        await excludePluggyDiagramLinkAction(reviewForm.id);
        notifyPortfolioSimulationInvalidated();
        setReviewForm(null);
        setMessage("Investimento mantido apenas no Open Finance.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível excluir o investimento do diagrama.");
      }
    });
  }

  async function importFile(file: File) {
    setMessage("Lendo planilha…");
    try {
      const rows = await parseXlsxFile(file);
      const read = (row: Record<string, unknown>, ...keys: string[]) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null && value !== "");
      const classAliases: Record<string, InvestmentClassKey> = {
        "ACOES NACIONAIS": "BRAZILIAN_STOCKS",
        "ACOES INTERNACIONAIS": "INTERNATIONAL_STOCKS",
        "FUNDOS IMOBILIARIOS": "REAL_ESTATE_FUNDS",
        REITS: "REITS",
        CRIPTOMOEDAS: "CRYPTO",
        "RENDA FIXA": "FIXED_INCOME",
        "RENDA FIXA INTERNACIONAL": "INTERNATIONAL_FIXED_INCOME",
      };
      const normalizeText = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
      const normalizeClass = (value: unknown): InvestmentClassKey => {
        const normalized = normalizeText(value || "BRAZILIAN_STOCKS");
        return classAliases[normalized] ?? normalized as InvestmentClassKey;
      };
      const normalizeIndexation = (value: unknown): FixedIncomeIndexationKey | null => {
        const normalized = normalizeText(value).replace(/[ -]/g, "_");
        const aliases: Record<string, FixedIncomeIndexationKey> = {
          PRE: "PRE_FIXED",
          PREFIXADO: "PRE_FIXED",
          PRE_FIXADO: "PRE_FIXED",
          POS: "POST_FIXED",
          POSFIXADO: "POST_FIXED",
          POS_FIXADO: "POST_FIXED",
          INFLACAO: "INFLATION",
          IPCA: "INFLATION",
          OUTRO: "OTHER",
          HIBRIDO: "OTHER",
          OUTRO_HIBRIDO: "OTHER",
        };
        return FIXED_INCOME_INDEXATIONS.includes(normalized as FixedIncomeIndexationKey) ? normalized as FixedIncomeIndexationKey : aliases[normalized] ?? null;
      };
      const parsed = rows.map((row) => ({
        row,
        investmentClass: normalizeClass(read(row, "classe", "Classe", "investmentClass")),
        instrumentType: read(row, "instrumento", "Instrumento", "instrumentType") ? normalizeText(read(row, "instrumento", "Instrumento", "instrumentType")) as InstrumentTypeKey : undefined,
      }));
      const fixedRows = parsed.filter(({ investmentClass, instrumentType }) => (investmentClass === "FIXED_INCOME" || investmentClass === "INTERNATIONAL_FIXED_INCOME") && instrumentType !== "ETF");
      const marketRows = parsed.filter(({ row }) => !fixedRows.some((fixed) => fixed.row === row));

      const normalizedFixed = fixedRows.map(({ row, investmentClass }) => {
        const familyInput = String(read(row, "familia", "Família", "familyCode") ?? "").trim();
        const family = fixedIncomeFamilies.find((item) => item.code === familyInput || normalizeText(item.name) === normalizeText(familyInput));
        const indexation = normalizeIndexation(read(row, "indexacao", "Indexação", "indexation"));
        const catalogInput = read(row, "catalogoId", "Catálogo ID", "catalogItemId", "tipoCatalogo", "Tipo do catálogo");
        const catalogItem = catalog.find((item) => item.id === Number(catalogInput) || normalizeText(item.name) === normalizeText(catalogInput));
        const issuer = String(read(row, "emissor", "Emissor", "issuer") ?? "").trim();
        const productName = String(read(row, "produto", "Produto", "productName", "nome", "Nome") ?? "").trim();
        const currentRaw = read(row, "valorAtual", "Valor atual", "currentValue", "valor", "Valor");
        if (!family || !indexation || issuer.length < 2 || productName.length < 2 || currentRaw === undefined) {
          throw new Error("Linhas de renda fixa exigem família, indexação, emissor, produto e valor atual. Agregados antigos não são aceitos.");
        }
        const customTypeName = String(read(row, "tipoPersonalizado", "Tipo personalizado", "customTypeName") ?? "").trim();
        if (!catalogItem && customTypeName.length < 2) throw new Error(`Informe um item do catálogo ou tipo personalizado para ${productName}.`);
        const convention = normalizeText(read(row, "formatoTaxa", "Formato da taxa", "rateConvention"));
        return {
          familyCode: family.code,
          indexation,
          investmentClass: investmentClass === "INTERNATIONAL_FIXED_INCOME" ? "INTERNATIONAL_FIXED_INCOME" as const : "FIXED_INCOME" as const,
          score: Number(read(row, "nota", "Nota", "score") ?? 0),
          holding: {
            id: String(read(row, "idAplicacao", "ID da aplicação", "holdingId", "id") ?? "").trim() || undefined,
            catalogItemId: catalogItem?.id ?? null,
            customTypeName: catalogItem ? null : customTypeName,
            issuer,
            productName,
            investedValue: read(row, "valorInvestido", "Valor investido", "investedValue") == null ? null : Number(read(row, "valorInvestido", "Valor investido", "investedValue")),
            currentValue: Number(currentRaw),
            rateConvention: RATE_CONVENTIONS.includes(convention as RateConventionKey) ? convention as RateConventionKey : null,
            benchmark: String(read(row, "indexador", "Indexador", "benchmark") ?? "") || null,
            rateValue: read(row, "taxa", "Taxa", "rateValue") == null ? null : Number(read(row, "taxa", "Taxa", "rateValue")),
            purchaseDate: String(read(row, "dataCompra", "Data da compra", "purchaseDate") ?? "") || null,
            maturityDate: String(read(row, "vencimento", "Vencimento", "maturityDate") ?? "") || null,
          },
        };
      });
      const normalizedMarket = marketRows.map(({ row, investmentClass, instrumentType }) => {
        const familyInput = String(read(row, "familia", "Família", "familyCode") ?? "").trim();
        const family = fixedIncomeFamilies.find((item) => item.code === familyInput || normalizeText(item.name) === normalizeText(familyInput));
        return {
          ticker: String(read(row, "ticker", "Ticker", "ativo", "Ativo") ?? ""),
          name: String(read(row, "nome", "Nome", "name", "ticker", "Ativo") ?? ""),
          investmentClass,
          instrumentType,
          fixedIncomeFamilyCode: family?.code ?? null,
          indexation: normalizeIndexation(read(row, "indexacao", "Indexação", "indexation")),
          quantity: Number(read(row, "quantidade", "Quantidade", "quantity") ?? 0),
          unitPrice: Number(read(row, "preco", "Preço", "unitPrice") ?? 0),
          manualValue: read(row, "valor", "Valor", "manualValue") == null ? null : Number(read(row, "valor", "Valor", "manualValue")),
          currency: String(read(row, "moeda", "Moeda", "currency") ?? "BRL"),
          fractional: [true, 1, "1", "true", "sim"].includes(read(row, "fracionado", "Fracionado", "fractional") as never),
          score: Number(read(row, "nota", "Nota", "score") ?? 0),
          yahooReitConfirmed: [true, 1, "1", "true", "sim", "yes"].includes(
            String(read(row, "confirmarReitYahoo", "Confirmar REIT Yahoo", "yahooReitConfirmed") ?? "")
              .trim()
              .toLowerCase() as never,
          ),
        };
      });
      await importPortfolioRowsAction({
        marketRows: normalizedMarket,
        fixedIncomeRows: normalizedFixed,
      });
      setMessage(`${normalizedMarket.length} ativo(s) de mercado e ${normalizedFixed.length} aplicação(ões) de renda fixa importado(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Planilha inválida.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const simpleScoreForm = form ? ["ETF", "MUTUAL_FUND"].includes(form.instrumentType) || !questionTypeForClass(form.investmentClass) : false;
  const holdingAsset = holdingForm ? assets.find((asset) => asset.id === holdingForm.assetId) : undefined;
  const holdingCatalog = holdingAsset?.fixedIncomeFamilyCode
    ? catalog.filter((item) => item.familyCode === holdingAsset.fixedIncomeFamilyCode)
    : [];

  return (
    <div ref={panelRef} className="space-y-6">
      {integrationReview.length > 0 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-[var(--primary)]/45 bg-[var(--primary)]/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" />
            <div>
              <p className="font-semibold">{integrationReview.length} investimento(s) precisam de revisão</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Confirme exposição, grupo ou indexação antes de incluí-los no diagrama.</p>
            </div>
          </div>
          <Button onClick={() => openReview(integrationReview[0])}>Revisar integração</Button>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Seus ativos</CardTitle>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{assets.length} ativos · {formatMoney(total)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={refreshMarketPrices}
                disabled={pending || !hasRefreshableQuotes}
                title="Atualiza ativos da B3 pela brapi, ativos internacionais pelo Yahoo Finance e criptomoedas pela Binance."
              >
                <RefreshCw className="size-4" /> Atualizar cotações
              </Button>
              <input ref={fileInput} className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} />
              <Button variant="outline" onClick={() => exportPortfolioXlsx(assets)} disabled={!assets.length}><Download className="size-4" /> Exportar XLSX</Button>
              <Button variant="outline" onClick={() => fileInput.current?.click()}><Upload className="size-4" /> Importar XLSX</Button>
              <Button variant="outline" onClick={() => setFixedGroupForm({ ...emptyFixedGroup })}><Plus className="size-4" /> Renda fixa</Button>
              <Button onClick={startAdding}><Plus className="size-4" /> Adicionar ativo</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-col gap-3 md:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">Buscar ativos</span>
                <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-[var(--muted-foreground)]" />
                <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome ou ticker" />
              </label>
              <Select aria-label="Filtrar por classe" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
                <option value="ALL">Todas as classes</option>
                {INVESTMENT_CLASSES.map((investmentClass) => <option key={investmentClass} value={investmentClass}>{INVESTMENT_CLASS_META[investmentClass].label}</option>)}
              </Select>
              <Select aria-label="Filtrar por instrumento" value={instrumentFilter} onChange={(event) => setInstrumentFilter(event.target.value as typeof instrumentFilter)}>
                <option value="ALL">Todos os instrumentos</option>
                {INSTRUMENT_TYPES.map((instrumentType) => <option key={instrumentType} value={instrumentType}>{INSTRUMENT_TYPE_META[instrumentType].label}</option>)}
              </Select>
              {filter !== "ALL" && (
                <Button variant="danger" onClick={() => setDeleteTarget({ kind: "class", investmentClass: filter, label: INVESTMENT_CLASS_META[filter].label })}>
                  <Trash2 className="size-4" /> Excluir classe
                </Button>
              )}
            </div>
            {message && <p role="status" className="mb-4 rounded-xl bg-[var(--muted)] p-3 text-sm">{message}</p>}
            <div className="overflow-x-auto scrollbar-thin">
              <table className={`w-full table-fixed text-left text-sm ${showAssetAveragePrice ? "min-w-[1150px]" : "min-w-[1030px]"}`}>
                <colgroup>
                  <col className="w-[300px]" />
                  <col className="w-[100px]" />
                  <col className="w-[120px]" />
                  <col className="w-[115px]" />
                  <col className="w-[70px]" />
                  <col className="w-[110px]" />
                  {showAssetAveragePrice && <col className="w-[120px]" />}
                  <col className="w-[115px]" />
                  <col className="w-[110px]" />
                </colgroup>
                <thead className="border-b text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-3">Ativo</th>
                    <th className="whitespace-nowrap px-3 py-3">Classe</th>
                    <th className="whitespace-nowrap px-3 py-3">Valor atual</th>
                    <th className="whitespace-nowrap px-3 py-3">% da carteira</th>
                    <th className="whitespace-nowrap px-3 py-3">Nota</th>
                    <th className="whitespace-nowrap px-3 py-3">Quantidade</th>
                    {showAssetAveragePrice && <th className="whitespace-nowrap px-3 py-3">Preço médio</th>}
                    <th className="whitespace-nowrap px-3 py-3">Atualizado</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((asset) => {
                    const expandable = asset.instrumentType === "FIXED_INCOME" || asset.pluggyControlled || asset.holdings.length > 1;
                    const showsApplicationCount = ["FIXED_INCOME", "MUTUAL_FUND"].includes(asset.instrumentType);
                    const expanded = expandedAssets.has(asset.id) || searchExpandedAssets.has(asset.id);
                    const holdingColumns = {
                      invested: asset.holdings.some((holding) => holding.investedValue !== null),
                      quantity: ["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT", "CRYPTO"].includes(asset.instrumentType),
                      averagePrice: asset.holdings.some((holding) => holding.averagePricePaid !== null),
                      profitability: asset.holdings.some((holding) => holdingProfitability(holding) !== null),
                      purchaseDate: asset.holdings.some((holding) => holding.purchaseDate !== null),
                      maturityDate: asset.holdings.some((holding) => holding.maturityDate !== null),
                    };
                    const holdingColumnCount = 4 + Object.values(holdingColumns).filter(Boolean).length;
                    return (
                      <Fragment key={asset.id}>
                        <tr className="border-b last:border-0">
                          <td className="overflow-hidden px-3 py-4">
                            <div className="flex min-w-0 items-center gap-2">
                              {expandable ? (
                                <button type="button" className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-[var(--muted)]" onClick={() => toggleExpanded(asset.id)} aria-label={`${expanded ? "Recolher" : "Expandir"} ${asset.name}`} aria-expanded={expanded}>
                                  {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                </button>
                              ) : <span className="size-7 shrink-0" />}
                              <AssetLogo asset={asset} />
                              <span className="min-w-0">
                                <strong className="block truncate">{asset.ticker}</strong>
                                <span className="block truncate text-xs text-[var(--muted-foreground)]" title={asset.name}>{asset.name}</span>
                              </span>
                            </div>
                          </td>
                          <td className="px-3">
                            <span className="inline-flex rounded-full px-2 py-1 text-xs" style={{ background: `${INSTRUMENT_TYPE_META[asset.instrumentType].color}20`, color: INSTRUMENT_TYPE_META[asset.instrumentType].color }}>{INSTRUMENT_TYPE_META[asset.instrumentType].label}</span>
                            <span className="mt-1 block whitespace-nowrap text-[10px] text-[var(--muted-foreground)]">{INVESTMENT_CLASS_META[asset.investmentClass].shortLabel}</span>
                            {asset.instrumentType === "ETF" && asset.fixedIncomeFamilyName && asset.indexation && <span className="mt-0.5 block max-w-28 truncate text-[10px] text-[var(--muted-foreground)]" title={`${asset.fixedIncomeFamilyName} · ${FIXED_INCOME_INDEXATION_META[asset.indexation].label}`}>{asset.fixedIncomeFamilyName} · {FIXED_INCOME_INDEXATION_META[asset.indexation].label}</span>}
                          </td>
                          <td className="whitespace-nowrap px-3">{formatMoney(asset.currentValue)}</td>
                          <td className="whitespace-nowrap px-3">{formatPercent(total ? currentValue(asset) / total * 100 : 0)}</td>
                          <td className="whitespace-nowrap px-3">
                            <span className="grid size-8 place-items-center rounded-full bg-[var(--muted)] font-semibold">{asset.score}</span>
                            {asset.needsScore && <span className="mt-1 block text-[10px] text-[var(--primary)]">Revisar nota</span>}
                          </td>
                          <td className="whitespace-nowrap px-3">{showsApplicationCount ? `${asset.holdings.length} aplic.` : Number(asset.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</td>
                          {showAssetAveragePrice && <td className="whitespace-nowrap px-3">
                            {asset.averagePricePaid == null
                              ? "—"
                              : (
                                  <>
                                    <span>{formatMoney(asset.averagePricePaid)}</span>
                                    {asset.averagePriceCoverage < 0.999 && (
                                      <span
                                        className="mt-1 block text-[10px] text-[var(--primary)]"
                                        title={`O histórico de compras disponível cobre ${(asset.averagePriceCoverage * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da posição atual.`}
                                      >
                                        Histórico parcial
                                      </span>
                                    )}
                                  </>
                                )}
                          </td>}
                          <td className="whitespace-nowrap px-3 text-xs text-[var(--muted-foreground)]">{reviewDate(asset.priceUpdatedAt ?? asset.updatedAt, timeZone)}</td>
                          <td className="px-3"><div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => edit(asset)} aria-label={`Editar ${asset.ticker}`}><Pencil className="size-4" /> Editar</Button></div></td>
                        </tr>
                        {expandable && expanded && (
                          <tr className="border-b bg-[color-mix(in_srgb,var(--muted)_42%,transparent)]">
                            <td colSpan={showAssetAveragePrice ? 9 : 8} className="px-5 py-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div><strong className="text-sm">Posições do ativo</strong><p className="text-xs text-[var(--muted-foreground)]">O valor é a soma das posições ativas abaixo.</p></div>
                                {asset.instrumentType === "FIXED_INCOME" && <Button size="sm" onClick={() => startHolding(asset)}><Plus className="size-4" /> Adicionar aplicação</Button>}
                              </div>
                              {asset.holdings.length ? (
                                <div className="overflow-x-auto rounded-xl border bg-[var(--card)]">
                                  <table className="w-full min-w-[920px] text-left text-xs">
                                    <thead className="border-b text-[var(--muted-foreground)]"><tr><th className="px-3 py-2">Tipo / produto</th><th className="px-3 py-2">Emissor</th>{holdingColumns.invested && <th className="px-3 py-2">Investido</th>}<th className="px-3 py-2">Atual</th>{holdingColumns.quantity && <th className="px-3 py-2">Quantidade atual</th>}{holdingColumns.averagePrice && <th className="px-3 py-2">Preço médio</th>}{holdingColumns.profitability && <th className="px-3 py-2">Rentabilidade</th>}{holdingColumns.purchaseDate && <th className="px-3 py-2">Compra</th>}{holdingColumns.maturityDate && <th className="px-3 py-2">Vencimento</th>}<th className="px-3 py-2 text-right">Fonte / ações</th></tr></thead>
                                    <tbody>{asset.holdings.map((holding) => {
                                      const movementState = holdingTransactions[holding.id];
                                      const displayedTransactions = movementState?.transactions ?? holding.transactions;
                                      return (
                                      <Fragment key={holding.id}>
                                        <tr className="border-b">
                                          <td className="px-3 py-3"><strong className="block max-w-52 truncate" title={holding.typeName}>{holding.typeName}</strong><span className="block max-w-52 truncate text-[var(--muted-foreground)]" title={holding.productName}>{holding.productName}</span></td>
                                          <td className="px-3 py-3">{holding.issuer}</td>
                                          {holdingColumns.invested && <td className="whitespace-nowrap px-3 py-3">{holding.investedValue == null ? "—" : formatMoney(holding.investedValue)}</td>}
                                          <td className="whitespace-nowrap px-3 py-3">
                                            <strong>{formatMoney(holding.currentValue)}</strong>
                                            {holding.pricingSource === "YAHOO" && holding.fxRateToBrl && (
                                              <span className="mt-1 block text-[10px] font-normal text-[var(--muted-foreground)]">
                                                {reviewMoney(holding.unitPrice, holding.currency)} · câmbio {Number(holding.fxRateToBrl).toLocaleString("pt-BR", { maximumFractionDigits: 6 })}
                                              </span>
                                            )}
                                          </td>
                                          {holdingColumns.quantity && <td className="whitespace-nowrap px-3 py-3">{Number(holding.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</td>}
                                          {holdingColumns.averagePrice && <td className="whitespace-nowrap px-3 py-3">{holding.averagePricePaid == null ? "—" : formatMoney(holding.averagePricePaid)}</td>}
                                          {holdingColumns.profitability && <td className="whitespace-nowrap px-3 py-3">{holdingProfitability(holding) ?? "—"}</td>}
                                          {holdingColumns.purchaseDate && <td className="whitespace-nowrap px-3 py-3">{holding.purchaseDate ? reviewDate(holding.purchaseDate, timeZone) : "—"}</td>}
                                          {holdingColumns.maturityDate && <td className="whitespace-nowrap px-3 py-3">{holding.maturityDate ? reviewDate(holding.maturityDate, timeZone) : "—"}</td>}
                                          <td className="px-3 py-3">
                                            {holding.positionSource === "PLUGGY"
                                              ? <div className="text-right"><span className="rounded-full bg-[var(--primary)]/12 px-2 py-1 text-[10px] font-semibold text-[var(--primary)]">Pluggy</span><span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">{holding.providerStatus ?? "Sincronizado"}</span></div>
                                              : <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => startHolding(asset, holding)}><Pencil className="size-3.5" /> Editar</Button><Button variant="ghost" size="sm" className="text-[var(--danger)]" onClick={() => setDeleteTarget({ kind: "holding", id: holding.id, label: holding.productName })}><Trash2 className="size-3.5" /> Excluir</Button></div>}
                                          </td>
                                        </tr>
                                        {(holding.transactionCount > 0 || movementState?.loading || movementState?.error) && (
                                          <tr className="border-b last:border-0 bg-[var(--muted)]/15">
                                            <td colSpan={holdingColumnCount} className="px-4 py-3">
                                              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Operações informadas ({holding.transactionCount})</p>
                                              <div className="overflow-hidden rounded-lg border">
                                                <div className="grid grid-cols-[110px_minmax(110px,1fr)_110px_130px_130px] gap-3 border-b bg-[var(--muted)]/25 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                                                  <span>Data</span><span>Operação</span><span>Quantidade</span><span>Preço unitário</span><span className="text-right">Valor</span>
                                                </div>
                                                {displayedTransactions.map((transaction) => {
                                                  const operationAmount = transaction.netAmount ?? transaction.amount;
                                                  return (
                                                    <div key={transaction.id} className="grid grid-cols-[110px_minmax(110px,1fr)_110px_130px_130px] gap-3 border-b px-3 py-2 last:border-0">
                                                      <span className="whitespace-nowrap">{reviewDate(transaction.tradeDate ?? transaction.date, timeZone)}</span>
                                                      <span><strong>{operationTypeLabel(transaction.type)}</strong>{transaction.description && <span className="mt-0.5 block truncate text-[10px] text-[var(--muted-foreground)]" title={transaction.description}>{transaction.description}</span>}</span>
                                                      <span className="whitespace-nowrap">{transaction.quantity === null ? "—" : Number(transaction.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</span>
                                                      <span className="whitespace-nowrap">{transaction.value === null ? "—" : reviewMoney(transaction.value, holding.currency)}</span>
                                                      <span className="whitespace-nowrap text-right font-semibold">{operationAmount === null ? "—" : reviewMoney(operationAmount, holding.currency)}</span>
                                                    </div>
                                                  );
                                                })}
                                                {movementState?.loading && (
                                                  <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-[var(--muted-foreground)]">
                                                    <LoaderCircle className="size-4 animate-spin" />
                                                    Carregando movimentações…
                                                  </div>
                                                )}
                                                {movementState?.error && (
                                                  <div className="flex items-center justify-between gap-3 px-3 py-3 text-xs text-[var(--danger)]">
                                                    <span>{movementState.error}</span>
                                                    <Button size="sm" variant="outline" onClick={() => void loadHoldingTransactions(holding.id)}>
                                                      Tentar novamente
                                                    </Button>
                                                  </div>
                                                )}
                                                {movementState && !movementState.loading && !movementState.error && movementState.transactions.length < movementState.total && (
                                                  <div className="flex justify-center px-3 py-3">
                                                    <Button
                                                      size="sm"
                                                      variant="outline"
                                                      onClick={() => void loadHoldingTransactions(holding.id, movementState.page + 1, true)}
                                                    >
                                                      Carregar mais
                                                    </Button>
                                                  </div>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                    })}</tbody>
                                  </table>
                                </div>
                              ) : <div className="rounded-xl border border-dashed p-6 text-center text-sm text-[var(--muted-foreground)]">Nenhuma aplicação cadastrada. O grupo continua elegível para receber aportes.</div>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {!filtered.length && <div className="grid min-h-56 place-items-center text-center text-sm text-[var(--muted-foreground)]"><div><FileSpreadsheet className="mx-auto mb-3 size-8 opacity-45" /><p>Nenhum ativo encontrado.</p></div></div>}
            </div>
          </CardContent>
        </Card>
        <Card className="self-start xl:sticky xl:top-8">
          <CardHeader><CardTitle>Distribuição atual</CardTitle></CardHeader>
          <CardContent>
            {chartData.length ? <DonutChart data={chartData} centerLabel="Patrimônio" /> : <div className="grid h-64 place-items-center text-sm text-[var(--muted-foreground)]">Adicione ativos para visualizar.</div>}
            <div className="space-y-2">
              {chartData.map((item) => <div key={item.name} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: item.color }} />{item.name}</span><strong>{formatPercent(total ? item.value / total * 100 : 0)}</strong></div>)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={reviewForm !== null}
        onOpenChange={(open) => !open && setReviewForm(null)}
        dismissible={!pending}
        title="Revisar integração Pluggy"
        className="max-w-5xl"
        footer={reviewForm && (
          <>
            <Button type="button" variant="outline" onClick={excludeReview} disabled={pending}>Manter só no Open Finance</Button>
            <Button type="submit" form="pluggy-review-form" disabled={pending}>{pending ? "Integrando…" : "Integrar ao diagrama"}</Button>
          </>
        )}
      >
        {reviewForm && (
          <form id="pluggy-review-form" onSubmit={submitReview} className="space-y-5">
            <div className="rounded-xl border bg-[var(--muted)]/30 p-4">
              <strong className="block">{reviewForm.investmentName}</strong>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{reviewForm.institution} · {reviewForm.providerType}{reviewForm.providerSubtype ? ` / ${reviewForm.providerSubtype}` : ""}</p>
              <p className="mt-2 font-semibold">{formatMoney(reviewForm.balance)}</p>
              {reviewForm.reviewReason && <p className="mt-3 text-sm text-[var(--primary)]">{reviewForm.reviewReason}</p>}
            </div>
            <PluggyReviewSourceData review={reviewForm} timeZone={timeZone} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="review-instrument">Instrumento</Label>
                <Select id="review-instrument" className="w-full" value={reviewForm.instrumentType} onChange={(event) => setReviewForm({ ...reviewForm, instrumentType: event.target.value as InstrumentTypeKey | "" })} required>
                  <option value="">Selecione</option>
                  {INSTRUMENT_TYPES.map((instrumentType) => <option key={instrumentType} value={instrumentType}>{INSTRUMENT_TYPE_META[instrumentType].label}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="review-exposure">Classe para metas e cálculos</Label>
                <Select id="review-exposure" className="w-full" value={reviewForm.investmentClass} onChange={(event) => setReviewForm({ ...reviewForm, investmentClass: event.target.value as InvestmentClassKey | "" })} required>
                  <option value="">Selecione</option>
                  {INVESTMENT_CLASSES.map((investmentClass) => <option key={investmentClass} value={investmentClass}>{INVESTMENT_CLASS_META[investmentClass].label}</option>)}
                </Select>
              </div>
              {(reviewForm.instrumentType === "FIXED_INCOME" || (reviewForm.instrumentType === "ETF" && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(reviewForm.investmentClass))) && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="review-family">Família</Label>
                    <Select id="review-family" className="w-full" value={reviewForm.familyCode} onChange={(event) => setReviewForm({ ...reviewForm, familyCode: event.target.value })} required>
                      <option value="">Selecione</option>
                      {fixedIncomeFamilies.map((family) => <option key={family.code} value={family.code}>{family.name}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="review-indexation">Indexação</Label>
                    <Select id="review-indexation" className="w-full" value={reviewForm.indexation} onChange={(event) => setReviewForm({ ...reviewForm, indexation: event.target.value as FixedIncomeIndexationKey | "" })} required>
                      <option value="">Selecione</option>
                      {FIXED_INCOME_INDEXATIONS.map((indexation) => <option key={indexation} value={indexation}>{FIXED_INCOME_INDEXATION_META[indexation].label}</option>)}
                    </Select>
                  </div>
                </>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="review-score">Nota inicial</Label>
                <Input id="review-score" type="number" min="-30" max="30" value={reviewForm.score} onChange={(event) => setReviewForm({ ...reviewForm, score: Number(event.target.value) })} />
                <p className="text-xs text-[var(--muted-foreground)]">Nota 0 inclui o ativo nos totais, mas não nas sugestões de aporte.</p>
              </div>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        dismissible={!pending}
        title={form?.id ? "Editar ativo" : "Adicionar ativo"}
        className="max-w-4xl"
        footer={form && (
          <>
            {form.id && <Button type="button" variant="danger" onClick={() => setDeleteTarget({ kind: "asset", id: form.id!, label: form.ticker })} disabled={pending}>Remover</Button>}
            <Button
              type="submit"
              form="asset-modal-form"
              disabled={pending || !hasSelectedMarketTicker || Boolean(requiresYahooReitConfirmation && !form.yahooReitConfirmed)}
            >
              {pending ? "Salvando…" : form.id ? "Atualizar e fechar" : "Adicionar"}
            </Button>
          </>
        )}
      >
        {form && (
          <form id="asset-modal-form" onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="asset-instrument">Instrumento</Label>
              <Select id="asset-instrument" className="w-full" value={form.instrumentType} onChange={(event) => {
                const instrumentType = event.target.value as InstrumentTypeKey;
                if (instrumentType === "FIXED_INCOME") {
                  setForm(null);
                  setFixedGroupForm({ ...emptyFixedGroup });
                  return;
                }
                const defaultClass: Record<Exclude<InstrumentTypeKey, "FIXED_INCOME">, InvestmentClassKey> = {
                  STOCK: "BRAZILIAN_STOCKS",
                  ETF: "BRAZILIAN_STOCKS",
                  REAL_ESTATE_FUND: "REAL_ESTATE_FUNDS",
                  REIT: "REITS",
                  CRYPTO: "CRYPTO",
                  MUTUAL_FUND: "BRAZILIAN_STOCKS",
                };
                const investmentClass = ["ETF", "MUTUAL_FUND"].includes(instrumentType) && form.id
                  ? form.investmentClass
                  : defaultClass[instrumentType];
                const keepsFixedGroup = instrumentType === "ETF"
                  && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(investmentClass);
                const questionType = ["ETF", "MUTUAL_FUND"].includes(instrumentType)
                  ? null
                  : questionTypeForClass(investmentClass);
                setSelectedMarketTicker(undefined);
                setTickerOptions([]);
                setTickerListOpen(false);
                setForm({
                  ...(form.id ? form : emptyAsset),
                  instrumentType,
                  investmentClass,
                  fixedIncomeFamilyCode: keepsFixedGroup ? form.fixedIncomeFamilyCode : null,
                  indexation: keepsFixedGroup ? form.indexation ?? "OTHER" : null,
                  yahooReitConfirmed: false,
                });
                setFormAnswers(questionType
                  ? Object.fromEntries(
                      questions
                        .filter((question) => question.active && question.type === questionType)
                        .map((question) => [
                          question.id,
                          form.id
                            ? initialAnswers.find((answer) => answer.assetId === form.id && answer.questionId === question.id)?.answer ?? false
                            : false,
                        ]),
                    )
                  : {});
              }}>
                {INSTRUMENT_TYPES
                  .filter((instrumentType) => !form.id || instrumentType !== "FIXED_INCOME")
                  .map((instrumentType) => <option key={instrumentType} value={instrumentType}>{INSTRUMENT_TYPE_META[instrumentType].label}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset-class">Classe para metas e cálculos</Label>
              <Select id="asset-class" className="w-full" value={form.investmentClass} disabled={Boolean(form.id && !["ETF", "MUTUAL_FUND"].includes(form.instrumentType))} onChange={(event) => {
                const investmentClass = event.target.value as InvestmentClassKey;
                const classInstrument: Partial<Record<InvestmentClassKey, InstrumentTypeKey>> = {
                  REAL_ESTATE_FUNDS: "REAL_ESTATE_FUND",
                  REITS: "REIT",
                  CRYPTO: "CRYPTO",
                };
                setSelectedMarketTicker(undefined);
                setTickerOptions([]);
                setTickerListOpen(false);
                const keepsFixedGroup = form.instrumentType === "ETF" && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(investmentClass);
                setForm({
                  ...form,
                  investmentClass,
                  instrumentType: ["ETF", "MUTUAL_FUND"].includes(form.instrumentType) ? form.instrumentType : classInstrument[investmentClass] ?? "STOCK",
                  fixedIncomeFamilyCode: keepsFixedGroup ? form.fixedIncomeFamilyCode : null,
                  indexation: keepsFixedGroup ? form.indexation ?? "OTHER" : null,
                  yahooReitConfirmed: false,
                });
              }}>
                {INVESTMENT_CLASSES.map((investmentClass) => <option key={investmentClass} value={investmentClass}>{INVESTMENT_CLASS_META[investmentClass].label}</option>)}
              </Select>
            </div>

            {form.instrumentType === "ETF" && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(form.investmentClass) && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="asset-fixed-group">Grupo de renda fixa</Label>
                  <Select id="asset-fixed-group" className="w-full" value={form.fixedIncomeFamilyCode ?? ""} onChange={(event) => setForm({ ...form, fixedIncomeFamilyCode: event.target.value || null })} required>
                    <option value="">Selecione um grupo</option>
                    {fixedIncomeFamilies.map((family) => <option key={family.code} value={family.code}>{family.name}</option>)}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asset-fixed-indexation">Indexação do grupo</Label>
                  <Select id="asset-fixed-indexation" className="w-full" value={form.indexation ?? ""} onChange={(event) => setForm({ ...form, indexation: event.target.value as FixedIncomeIndexationKey })} required>
                    <option value="">Selecione a indexação</option>
                    {FIXED_INCOME_INDEXATIONS.map((indexation) => <option key={indexation} value={indexation}>{FIXED_INCOME_INDEXATION_META[indexation].label}</option>)}
                  </Select>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="asset-ticker">Ticker (Código)</Label>
                  {usesMarketTickerSearch ? (
                    <div className="relative">
                      <Input
                        ref={tickerInput}
                        id="asset-ticker"
                        className="pr-10"
                        placeholder="Ex: PETR4"
                        value={form.ticker}
                        onChange={(event) => changeTicker(event.target.value)}
                        onFocus={() => {
                          tickerInputFocused.current = true;
                          updateTickerListPosition();
                          if (!hasSelectedMarketTicker && (tickerOptions.length || tickerSearchError)) setTickerListOpen(true);
                        }}
                        onBlur={() => {
                          tickerInputFocused.current = false;
                          setTickerListOpen(false);
                        }}
                        onKeyDown={handleTickerKeyDown}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={tickerListOpen}
                        aria-controls="market-ticker-options"
                        aria-activedescendant={activeTickerIndex >= 0 ? `market-ticker-option-${activeTickerIndex}` : undefined}
                        aria-describedby="asset-ticker-help"
                        required
                      />
                      <span className="pointer-events-none absolute right-3 top-3 text-[var(--muted-foreground)]">
                        {tickerSearchPending ? <LoaderCircle className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
                      </span>
                      {tickerListOpen && tickerQuery.length >= 2 && tickerListPosition && typeof document !== "undefined" && createPortal(
                        <div
                          id="market-ticker-options"
                          role="listbox"
                          aria-label="Tickers encontrados"
                          className="fixed z-[200] overflow-y-auto rounded-xl border bg-[var(--card)] p-1 shadow-2xl scrollbar-thin"
                          style={tickerListPosition}
                        >
                          {tickerOptions.map((option, index) => {
                            const logoUrl = option.logoUrl;
                            const badge = option.provider === "BRAPI"
                              ? option.subType || option.assetType || "B3"
                              : option.provider === "BINANCE"
                                ? "Cripto · Binance"
                                : option.quoteType === "ETF"
                                  ? "ETF · Yahoo"
                                  : option.reitStatus === "CONFIRMED"
                                    ? "REIT · Yahoo"
                                    : "Ação · Yahoo";
                            return (
                            <button
                              id={`market-ticker-option-${index}`}
                              key={`${option.provider}-${option.symbol}`}
                              type="button"
                              role="option"
                              aria-selected={activeTickerIndex === index}
                              className={`grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${activeTickerIndex === index ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]"}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setActiveTickerIndex(index)}
                              onClick={() => selectTicker(option)}
                            >
                              <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white/95 text-neutral-500">
                                {option.provider === "BINANCE"
                                  ? <Coins className="size-4" aria-hidden="true" />
                                  : <Building2 className="size-4" aria-hidden="true" />}
                                {logoUrl && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={logoUrl}
                                    alt={`Logo de ${option.name}`}
                                    className="absolute inset-[2px] h-[calc(100%-4px)] w-[calc(100%-4px)] rounded-md object-contain"
                                    loading="lazy"
                                    onError={(event) => { event.currentTarget.hidden = true; }}
                                  />
                                )}
                              </span>
                              <span className="min-w-0">
                                <strong className="block">{option.symbol}</strong>
                                <span className="block max-w-[190px] truncate text-xs text-[var(--muted-foreground)] sm:max-w-[220px]" title={option.name}>
                                  {option.provider === "BINANCE"
                                    ? `${option.pair.slice(0, -option.quoteAsset.length)}/${option.quoteAsset}`
                                    : option.name}
                                </span>
                              </span>
                              <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">{badge}</span>
                            </button>
                            );
                          })}
                          {!tickerSearchPending && !tickerOptions.length && !tickerSearchError && <p className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">Nenhum ticker encontrado.</p>}
                          {tickerSearchError && <p role="alert" className="px-3 py-4 text-center text-sm text-[var(--danger)]">{tickerSearchError}</p>}
                        </div>,
                        document.body,
                      )}
                      <p id="asset-ticker-help" className="mt-2 text-xs text-[var(--muted-foreground)]">
                        {hasSelectedMarketTicker
                          ? `Ativo selecionado no ${
                            marketTickerSearch?.provider === "YAHOO"
                              ? "Yahoo Finance"
                              : marketTickerSearch?.provider === "BINANCE"
                                ? "catálogo Spot da Binance"
                                : "catálogo da brapi"
                          }.`
                          : "Digite para buscar e selecione uma opção da lista."}
                      </p>
                      {requiresYahooReitConfirmation && (
                        <label className="mt-3 flex items-start gap-3 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/8 p-3 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4"
                            checked={form.yahooReitConfirmed}
                            onChange={(event) => setForm({ ...form, yahooReitConfirmed: event.target.checked })}
                          />
                          <span>
                            O Yahoo Finance não identifica este ativo definitivamente como REIT.
                            Confirmo que desejo classificá-lo como REIT.
                          </span>
                        </label>
                      )}
                    </div>
                  ) : (
                    <>
                      <Input id="asset-ticker" placeholder="Ex: PETR4" value={form.ticker} onChange={(event) => changeTicker(event.target.value)} list="mock-tickers" disabled={Boolean(form.id)} required />
                      <datalist id="mock-tickers">{MOCK_ASSET_CATALOG.filter((asset) => asset.investmentClass === form.investmentClass).map((asset) => <option key={asset.ticker} value={asset.ticker}>{asset.name}</option>)}</datalist>
                    </>
                  )}
                </div>
                <div className="space-y-2"><Label htmlFor="asset-quantity">Quantidade</Label><Input id="asset-quantity" type="number" min="0" step="any" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} disabled={editingAsset?.pluggyControlled} required /></div>
                {editingAsset?.pluggyControlled && <p className="text-xs text-[var(--muted-foreground)] sm:col-span-2">A quantidade é controlada pela Pluggy e será atualizada na próxima sincronização.</p>}
                {simpleScoreForm && <div className="space-y-2 sm:col-span-2"><Label htmlFor="asset-strength">{form.instrumentType === "ETF" ? "Nota do ETF (manual)" : form.instrumentType === "MUTUAL_FUND" ? "Nota do fundo (manual)" : "Nota de força"}</Label><Input id="asset-strength" type="number" min="-30" max="30" value={form.score} onChange={(event) => setForm({ ...form, score: Number(event.target.value) })} /></div>}
            </div>

            {form.id && formQuestionType && (
              <div className="space-y-4 border-t pt-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border p-3 text-center"><span className="block text-xs text-[var(--muted-foreground)]">Pontos positivos</span><strong className="text-xl">{positives}</strong></div>
                  <div className="rounded-xl border p-3 text-center"><span className="block text-xs text-[var(--muted-foreground)]">Pontos negativos</span><strong className="text-xl">{negatives}</strong></div>
                  <div className="rounded-xl border p-3 text-center"><span className="block text-xs text-[var(--muted-foreground)]">Pontuação final</span><strong className="text-xl">{positives - negatives}</strong></div>
                </div>
                <div className="divide-y rounded-xl border px-4">
                  {formQuestions.map((question) => (
                    <div key={question.id} className="flex items-center justify-between gap-4 py-4">
                      <div><p className="text-sm leading-5">{question.text}</p><span className="mt-1 block text-xs font-semibold text-[var(--muted-foreground)]">{question.criterion}</span></div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={formAnswers[question.id] === true}
                        aria-label={question.text}
                        onClick={() => setFormAnswers({ ...formAnswers, [question.id]: formAnswers[question.id] !== true })}
                        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${formAnswers[question.id] ? "bg-[var(--primary)]" : "bg-[var(--muted)]"}`}
                      >
                        <span className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform ${formAnswers[question.id] ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}
      </Dialog>

      <Dialog
        open={fixedGroupForm !== null}
        onOpenChange={(open) => !open && setFixedGroupForm(null)}
        dismissible={!pending}
        title={fixedGroupForm?.id ? "Editar grupo de renda fixa" : "Adicionar grupo de renda fixa"}
        className="max-w-2xl"
        footer={fixedGroupForm && (
          <>
            {fixedGroupForm.id && <Button type="button" variant="danger" onClick={() => {
              const asset = assets.find((candidate) => candidate.id === fixedGroupForm.id);
              if (asset) setDeleteTarget({ kind: "asset", id: asset.id, label: asset.name });
            }}>Remover grupo</Button>}
            <Button type="submit" form="fixed-income-group-form" disabled={pending || !fixedGroupForm.familyCode}>{pending ? "Salvando…" : "Salvar grupo"}</Button>
          </>
        )}
      >
        {fixedGroupForm && (
          <form id="fixed-income-group-form" onSubmit={submitFixedGroup} className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="fixed-family">Família</Label>
              <Select id="fixed-family" className="w-full" value={fixedGroupForm.familyCode} disabled={Boolean(fixedGroupForm.id)} onChange={(event) => setFixedGroupForm({ ...fixedGroupForm, familyCode: event.target.value })} required>
                <option value="">Selecione uma família</option>
                {fixedIncomeFamilies.map((family) => <option key={family.code} value={family.code}>{family.name}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fixed-indexation">Indexação</Label>
              <Select id="fixed-indexation" className="w-full" value={fixedGroupForm.indexation} disabled={Boolean(fixedGroupForm.id)} onChange={(event) => setFixedGroupForm({ ...fixedGroupForm, indexation: event.target.value as FixedIncomeIndexationKey })}>
                {FIXED_INCOME_INDEXATIONS.map((indexation) => <option key={indexation} value={indexation}>{FIXED_INCOME_INDEXATION_META[indexation].label}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fixed-exposure">Classe para metas</Label>
              <Select id="fixed-exposure" className="w-full" value={fixedGroupForm.investmentClass} onChange={(event) => setFixedGroupForm({ ...fixedGroupForm, investmentClass: event.target.value as FixedIncomeGroupForm["investmentClass"] })}>
                <option value="FIXED_INCOME">Renda fixa</option>
                <option value="INTERNATIONAL_FIXED_INCOME">Renda fixa internacional</option>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="fixed-score">Nota do grupo</Label><Input id="fixed-score" type="number" min="-30" max="30" value={fixedGroupForm.score} onChange={(event) => setFixedGroupForm({ ...fixedGroupForm, score: Number(event.target.value) })} required /></div>
            <p className="text-sm text-[var(--muted-foreground)] sm:col-span-2">O grupo pode ser salvo vazio. As aplicações reais são adicionadas ao expandir a linha na carteira.</p>
          </form>
        )}
      </Dialog>

      <Dialog
        open={holdingForm !== null && Boolean(holdingAsset)}
        onOpenChange={(open) => !open && setHoldingForm(null)}
        dismissible={!pending}
        title={holdingForm?.id ? "Editar aplicação" : "Adicionar aplicação"}
        className="max-w-3xl"
        footer={holdingForm && <Button type="submit" form="fixed-income-holding-form" disabled={pending || (!holdingForm.catalogItemId && holdingForm.customTypeName.trim().length < 2)}>{pending ? "Salvando…" : "Salvar aplicação"}</Button>}
      >
        {holdingForm && holdingAsset && (
          <form id="fixed-income-holding-form" onSubmit={submitHolding} className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-[var(--muted)] p-3 text-sm sm:col-span-2"><strong>{holdingAsset.name}</strong><span className="mt-1 block text-xs text-[var(--muted-foreground)]">A nota e a classe de cálculo pertencem ao grupo.</span></div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="holding-type">Tipo do catálogo</Label>
              <Select id="holding-type" className="w-full" value={holdingForm.catalogItemId ?? ""} onChange={(event) => setHoldingForm({ ...holdingForm, catalogItemId: event.target.value ? Number(event.target.value) : null })}>
                <option value="">Outro tipo personalizado</option>
                {holdingCatalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </div>
            {!holdingForm.catalogItemId && <div className="space-y-2 sm:col-span-2"><Label htmlFor="holding-custom-type">Tipo personalizado</Label><Input id="holding-custom-type" value={holdingForm.customTypeName} onChange={(event) => setHoldingForm({ ...holdingForm, customTypeName: event.target.value })} placeholder="Ex: Fundo de crédito privado" required /></div>}
            <div className="space-y-2"><Label htmlFor="holding-issuer">Emissor</Label><Input id="holding-issuer" value={holdingForm.issuer} onChange={(event) => setHoldingForm({ ...holdingForm, issuer: event.target.value })} placeholder="Ex: Banco ABC" required /></div>
            <div className="space-y-2"><Label htmlFor="holding-product">Nome do produto</Label><Input id="holding-product" value={holdingForm.productName} onChange={(event) => setHoldingForm({ ...holdingForm, productName: event.target.value })} placeholder="Ex: CDB Banco ABC 2029" required /></div>
            <div className="space-y-2"><Label htmlFor="holding-invested">Valor investido</Label><Input id="holding-invested" type="number" min="0" step="0.01" value={holdingForm.investedValue ?? ""} onChange={(event) => setHoldingForm({ ...holdingForm, investedValue: event.target.value ? Number(event.target.value) : null })} /></div>
            <div className="space-y-2"><Label htmlFor="holding-current">Valor atual</Label><Input id="holding-current" type="number" min="0" step="0.01" value={holdingForm.currentValue} onChange={(event) => setHoldingForm({ ...holdingForm, currentValue: Number(event.target.value) })} required /></div>
            <div className="space-y-2"><Label htmlFor="holding-rate-convention">Formato da taxa</Label><Select id="holding-rate-convention" className="w-full" value={holdingForm.rateConvention ?? ""} onChange={(event) => setHoldingForm({ ...holdingForm, rateConvention: event.target.value ? event.target.value as RateConventionKey : null })}><option value="">Não informado</option>{RATE_CONVENTIONS.map((convention) => <option key={convention} value={convention}>{RATE_CONVENTION_META[convention]}</option>)}</Select></div>
            <div className="space-y-2"><Label htmlFor="holding-benchmark">Indexador detalhado</Label><Input id="holding-benchmark" value={holdingForm.benchmark} onChange={(event) => setHoldingForm({ ...holdingForm, benchmark: event.target.value })} placeholder="Ex: CDI, IPCA, Selic" /></div>
            <div className="space-y-2"><Label htmlFor="holding-rate">Taxa</Label><Input id="holding-rate" type="number" step="0.000001" value={holdingForm.rateValue ?? ""} onChange={(event) => setHoldingForm({ ...holdingForm, rateValue: event.target.value ? Number(event.target.value) : null })} /></div>
            <div className="space-y-2"><Label htmlFor="holding-purchase-date">Data da compra</Label><Input id="holding-purchase-date" type="date" value={holdingForm.purchaseDate} onChange={(event) => setHoldingForm({ ...holdingForm, purchaseDate: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="holding-maturity-date">Vencimento</Label><Input id="holding-maturity-date" type="date" value={holdingForm.maturityDate} onChange={(event) => setHoldingForm({ ...holdingForm, maturityDate: event.target.value })} /></div>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
        title={deleteTarget?.kind === "class" ? "Remover classe" : "Remover ativo"}
        description={deleteTarget?.kind === "class"
          ? `Todos os ativos de ${deleteTarget.label} serão removidos. Deseja seguir?`
          : `${deleteTarget?.label ?? "Este ativo"} será removido definitivamente da carteira. Deseja seguir?`}
        confirmLabel="Remover"
        danger
        pending={pending}
        onConfirm={confirmDeletion}
      />
    </div>
  );
}
