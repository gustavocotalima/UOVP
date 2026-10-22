"use client";
import { usePrivacy } from "@/components/layout/privacy-provider";
import { useHoldingTransactions } from "../use-holding-transactions";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { deleteAssetAction, deleteAssetClassAction, deleteAssetHoldingAction, importPortfolioRowsAction, refreshMarketPricesAction, saveAssetAction, saveAssetAnswersAction, saveAssetHoldingAction, saveFixedIncomeGroupAction, saveAwaitingContributionPriceAction, searchBinanceAssetsAction, searchBrapiTickersAction, searchYahooTickersAction } from "../actions";
import { notifyPortfolioSimulationInvalidated } from "../client-events";
import { parseXlsxFile } from "../xlsx-parser";
import { parsePortfolioImportRows } from "../portfolio-import";
import type { YahooSearchKind } from "../yahoo-finance";
import { INVESTMENT_CLASSES, INVESTMENT_CLASS_META, MOCK_ASSET_CATALOG, type FixedIncomeIndexationKey, type InstrumentTypeKey, type InvestmentClassKey } from "../constants";
import type { AssetDto, AssetHoldingDto, PortfolioDto } from "../types";
import { excludePluggyDiagramLinkAction, reviewPluggyDiagramLinkAction } from "@/features/open-finance/diagram-actions";
import { excludeAccountInvestmentAction, reviewAccountInvestmentAction } from "@/features/finance/account-investment-actions";
import { emptyAsset, currentValue, marketTickerSearchFor, questionTypeForClass } from "./model";
import type { AssetsPanelProps, FormAsset, QuantityEditForm, MarketTickerOption, DeleteTarget, FixedIncomeGroupForm, HoldingForm, TickerListPosition, ReviewForm } from "./model";
export function useAssetsPanelController({ assets, fixedIncomeFamilies, catalog, integrationReview, questions, initialAnswers, timeZone, snapshotRevision }: AssetsPanelProps) {
  const { valuesHidden } = usePrivacy();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InvestmentClassKey | "ALL">("ALL");
  const [instrumentFilter, setInstrumentFilter] = useState<InstrumentTypeKey | "ALL">("ALL");
  const [form, setForm] = useState<FormAsset | null>(null);
  const [quantityForms, setQuantityForms] = useState<QuantityEditForm[]>([]);
  const [fixedGroupForm, setFixedGroupForm] = useState<FixedIncomeGroupForm | null>(null);
  const [holdingForm, setHoldingForm] = useState<HoldingForm | null>(null);
  const [metadataEditor, setMetadataEditor] = useState<AssetHoldingDto["connectedMetadata"]>(null);
  const [reviewForm, setReviewForm] = useState<ReviewForm | null>(null);
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(() => new Set());
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
  const [pendingPriceByAsset, setPendingPriceByAsset] = useState<Record<string, string>>({});
  const [actionPending, startTransition] = useTransition();
  const [refreshingPrices, startRefreshTransition] = useTransition();
  const pending = actionPending || refreshingPrices;
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mobileActions = useRef<HTMLDetailsElement>(null);
  const tickerRequestId = useRef(0);
  const tickerInputFocused = useRef(false);
  const tickerInput = useRef<HTMLInputElement>(null);
  const updateTickerListPosition = useCallback(() => {
    const rect = tickerInput.current?.getBoundingClientRect();
    if (!rect)
      return;
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
    if (!panel)
      return;
    panel.dataset.assetsPanelHydrated = "true";
    return () => {
      delete panel.dataset.assetsPanelHydrated;
    };
  }, []);
  const filtered = useMemo(() => assets.filter((asset) => {
    const query = search.trim().toLowerCase();
    const matchesText = !query
      || asset.ticker.toLowerCase().includes(query)
      || asset.name.toLowerCase().includes(query)
      || asset.holdings.some((holding) => [holding.typeName, holding.issuer, holding.institution ?? "", holding.productName, holding.ticker ?? ""].some((value) => value.toLowerCase().includes(query)));
    return (filter === "ALL" || asset.investmentClass === filter)
      && (instrumentFilter === "ALL" || asset.instrumentType === instrumentFilter)
      && matchesText;
  }), [assets, filter, instrumentFilter, search]);
  const searchExpandedAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query)
      return new Set<string>();
    return new Set(assets
      .filter((asset) => asset.holdings.some((holding) => [holding.typeName, holding.issuer, holding.institution ?? "", holding.productName, holding.ticker ?? ""]
        .some((value) => value.toLowerCase().includes(query))))
      .map((asset) => asset.id));
  }, [assets, search]);
  const expandedForTransactions = useMemo(() => new Set([...expandedAssets, ...searchExpandedAssets]), [expandedAssets, searchExpandedAssets]);
  const { holdingTransactions, loadHoldingTransactions } = useHoldingTransactions(assets, expandedForTransactions, snapshotRevision);
  const { total, chartData, hasRefreshableQuotes } = useMemo(() => {
    const total = assets.reduce((sum, asset) => sum + currentValue(asset), 0);
    const chartData = INVESTMENT_CLASSES.map((investmentClass) => ({
      name: INVESTMENT_CLASS_META[investmentClass].label,
      color: INVESTMENT_CLASS_META[investmentClass].color,
      value: assets.filter((asset) => asset.investmentClass === investmentClass).reduce((sum, asset) => sum + currentValue(asset), 0),
    })).filter((item) => item.value > 0);
    const hasRefreshableQuotes = assets.some((asset) => asset.holdings.some((holding) => ["BRAPI", "YAHOO"].includes(holding.pricingSource))
      || (asset.instrumentType === "CRYPTO" && asset.investmentClass === "CRYPTO" && asset.holdings.some((holding) => Boolean(holding.ticker)))
      || (asset.instrumentType === "ETF" && asset.investmentClass === "STORE_OF_VALUE" && asset.marketRegion !== null)
      || (["INTERNATIONAL_STOCKS", "REITS", "INTERNATIONAL_FIXED_INCOME"].includes(asset.investmentClass)
        && ["STOCK", "REIT", "ETF"].includes(asset.instrumentType)
        && asset.holdings.some((holding) => Boolean(holding.ticker))));
    return { total, chartData, hasRefreshableQuotes };
  }, [assets]);
  const formQuestionType = form && !["ETF", "MUTUAL_FUND"].includes(form.instrumentType) ? questionTypeForClass(form.investmentClass) : null;
  const editingAsset = form?.id ? assets.find((asset) => asset.id === form.id) : undefined;
  const singleQuantityForm = editingAsset?.holdings.length === 1 && quantityForms.length === 1 ? quantityForms[0] : null;
  const previewQuantity = editingAsset?.holdings.reduce((total, holding) => {
    const entry = quantityForms.find((value) => value.holdingId === holding.id);
    return total + Number(entry ? entry.mode === "CUSTOM" ? entry.value : entry.expectedProviderQuantity ?? 0 : holding.quantity);
  }, 0);
  const formQuestions = questions.filter((question) => question.active && question.type === formQuestionType);
  const positives = formQuestions.filter((question) => formAnswers[question.id] === true).length;
  const negatives = formQuestions.length - positives;
  const marketTickerSearch = marketTickerSearchFor(form);
  const marketTickerProvider = marketTickerSearch?.provider;
  const marketTickerKind = marketTickerSearch?.kind;
  const usesMarketTickerSearch = marketTickerSearch !== null;
  const requiresStoreOfValueMarket = form?.instrumentType === "ETF"
    && form.investmentClass === "STORE_OF_VALUE";
  const tickerQuery = marketTickerSearch && form ? form.ticker.trim() : "";
  const hasSelectedMarketTicker = !usesMarketTickerSearch || selectedMarketTicker === form?.ticker;
  const selectedYahooTicker = tickerOptions.find((option) => option.provider === "YAHOO" && option.symbol === selectedMarketTicker);
  const requiresYahooReitConfirmation = form?.investmentClass === "REITS"
    && selectedYahooTicker?.provider === "YAHOO"
    && selectedYahooTicker.requiresReitConfirmation;
  useEffect(() => {
    const requestId = ++tickerRequestId.current;
    if (selectedMarketTicker === tickerQuery || tickerQuery.length < 1)
      return;
    const timer = window.setTimeout(async () => {
      setTickerSearchPending(true);
      setTickerSearchError(undefined);
      try {
        if (!marketTickerProvider || !marketTickerKind)
          return;
        const options: MarketTickerOption[] = marketTickerProvider === "BRAPI"
          ? (await searchBrapiTickersAction(tickerQuery, marketTickerKind as InvestmentClassKey | "ETF"))
            .map((option) => ({ ...option, provider: "BRAPI" as const }))
          : marketTickerProvider === "YAHOO"
            ? (await searchYahooTickersAction(tickerQuery, marketTickerKind as YahooSearchKind))
              .map((option) => ({ ...option, provider: "YAHOO" as const }))
            : (await searchBinanceAssetsAction(tickerQuery))
              .map((option) => ({ ...option, provider: "BINANCE" as const }));
        if (tickerRequestId.current !== requestId)
          return;
        setTickerOptions(options);
        setActiveTickerIndex(options.length ? 0 : -1);
        updateTickerListPosition();
        setTickerListOpen(tickerInputFocused.current);
      }
      catch (error) {
        if (tickerRequestId.current !== requestId)
          return;
        setTickerOptions([]);
        setActiveTickerIndex(-1);
        setTickerSearchError(error instanceof Error ? error.message : "Não foi possível buscar tickers.");
        updateTickerListPosition();
        setTickerListOpen(tickerInputFocused.current);
      }
      finally {
        if (tickerRequestId.current === requestId)
          setTickerSearchPending(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [selectedMarketTicker, marketTickerKind, marketTickerProvider, tickerQuery, updateTickerListPosition]);
  useEffect(() => {
    if (!tickerListOpen)
      return;
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
    setQuantityForms([]);
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
    setQuantityForms(asset.holdings.flatMap((holding) => {
      const metadata = holding.connectedMetadata;
      if (!metadata?.canEditQuantity)
        return [];
      const mode = metadata.overrideFields.includes("QUANTITY") ? "CUSTOM" as const : "PROVIDER" as const;
      return [{
        linkId: metadata.linkId, expectedUpdatedAt: metadata.expectedUpdatedAt,
        expectedProviderQuantity: metadata.providerMetadata.quantity, holdingId: holding.id,
        label: [holding.institution, holding.productName].filter(Boolean).join(" · "),
        step: metadata.quantityStep, mode, originalMode: mode,
        value: holding.quantity, originalValue: holding.quantity,
      }];
    }));
    setForm({
      id: asset.id,
      instrumentType: asset.instrumentType,
      ticker: asset.ticker,
      name: asset.name,
      investmentClass: asset.investmentClass,
      quantity: Number(asset.quantity),
      unitPrice: Number(asset.unitPrice),
      manualValue: asset.manualValue == null ? null : Number(asset.manualValue),
      investedValue: asset.investedValue == null ? null : Number(asset.investedValue),
      investedValueCurrency: asset.investedValueCurrency ?? null,
      currency: asset.currency,
      fractional: asset.fractional,
      score: asset.score,
      fixedIncomeFamilyCode: asset.fixedIncomeFamilyCode,
      indexation: asset.indexation,
      marketRegion: asset.marketRegion,
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
      investedValueCurrency: holding?.investedValueCurrency ?? null,
      currentValue: Number(holding?.currentValue ?? 0),
      rateConvention: holding?.rateConvention ?? null,
      benchmark: holding?.benchmark ?? "",
      rateValue: holding?.rateValue == null ? null : Number(holding.rateValue),
      purchaseDate: holding?.purchaseDate?.slice(0, 10) ?? "",
      maturityDate: holding?.maturityDate?.slice(0, 10) ?? "",
    });
  }
  function toggleExpanded(assetId: string) {
    setExpandedAssets((current) => {
      const next = new Set(current);
      if (next.has(assetId))
        next.delete(assetId);
      else
        next.add(assetId);
      return next;
    });
  }
  function changeTicker(value: string) {
    if (!form)
      return;
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
      if (ticker.length < 1) {
        setTickerOptions([]);
        setTickerSearchError(undefined);
        setTickerSearchPending(false);
        setTickerListOpen(false);
        setActiveTickerIndex(-1);
      }
      else {
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
    if (!form)
      return;
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
    if (!tickerListOpen || !tickerOptions.length)
      return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveTickerIndex((current) => current < tickerOptions.length - 1 ? current + 1 : 0);
    }
    else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveTickerIndex((current) => current > 0 ? current - 1 : tickerOptions.length - 1);
    }
    else if (event.key === "Enter" && activeTickerIndex >= 0) {
      event.preventDefault();
      selectTicker(tickerOptions[activeTickerIndex]);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form)
      return;
    if (usesMarketTickerSearch && !hasSelectedMarketTicker)
      return;
    const quantityEdits = quantityForms.filter((entry) => entry.mode !== entry.originalMode
      || (entry.mode === "CUSTOM" && Number(entry.value) !== Number(entry.originalValue)));
    if (quantityEdits.some((entry) => entry.mode === "CUSTOM"
      && (entry.value.trim() === "" || !Number.isFinite(Number(entry.value)) || Number(entry.value) < 0
        || (entry.step === 1 && !Number.isInteger(Number(entry.value)))))) {
      setMessage("Informe quantidades válidas maiores ou iguais a zero para cada posição.");
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      try {
        const { investedValue, investedValueCurrency, investmentCostEdited, ...assetInput } = form;
        await saveAssetAction({
          ...assetInput,
          ...(!form.id || investmentCostEdited ? { investedValue, investedValueCurrency } : {}),
          ...(quantityEdits.length ? {
            quantityEdits: quantityEdits.map((entry) => ({
              linkId: entry.linkId, expectedUpdatedAt: entry.expectedUpdatedAt,
              expectedProviderQuantity: entry.expectedProviderQuantity, mode: entry.mode,
              value: entry.mode === "CUSTOM" ? Number(entry.value) : null,
            }))
          } : {}),
        });
        if (form.id && formQuestionType)
          await saveAssetAnswersAction(form.id, formAnswers);
        notifyPortfolioSimulationInvalidated();
        setForm(null);
        setMessage(form.id ? "Ativo atualizado." : "Ativo adicionado.");
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar.");
      }
    });
  }
  function submitFixedGroup(event: FormEvent) {
    event.preventDefault();
    if (!fixedGroupForm?.familyCode)
      return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        await saveFixedIncomeGroupAction(fixedGroupForm);
        notifyPortfolioSimulationInvalidated();
        setFixedGroupForm(null);
        setMessage(fixedGroupForm.id ? "Grupo de renda fixa atualizado." : "Grupo de renda fixa adicionado.");
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar o grupo.");
      }
    });
  }
  function submitHolding(event: FormEvent) {
    event.preventDefault();
    if (!holdingForm)
      return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        const { investedValue, investedValueCurrency, investmentCostEdited, ...holdingInput } = holdingForm;
        await saveAssetHoldingAction(holdingForm.assetId, {
          ...holdingInput,
          ...(!holdingForm.id || investmentCostEdited ? { investedValue, investedValueCurrency } : {}),
          customTypeName: holdingForm.catalogItemId ? null : holdingForm.customTypeName,
          benchmark: holdingForm.benchmark || null,
          purchaseDate: holdingForm.purchaseDate || null,
          maturityDate: holdingForm.maturityDate || null,
        });
        notifyPortfolioSimulationInvalidated();
        setExpandedAssets((current) => new Set([...current, holdingForm.assetId]));
        setHoldingForm(null);
        setMessage(holdingForm.id ? "Aplicação atualizada." : "Aplicação adicionada.");
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar a aplicação.");
      }
    });
  }
  function confirmDeletion() {
    if (!deleteTarget)
      return;
    startTransition(async () => {
      try {
        if (deleteTarget.kind === "asset")
          await deleteAssetAction(deleteTarget.id);
        else if (deleteTarget.kind === "holding")
          await deleteAssetHoldingAction(deleteTarget.id);
        else
          await deleteAssetClassAction(deleteTarget.investmentClass);
        notifyPortfolioSimulationInvalidated();
        setForm(null);
        setDeleteTarget(undefined);
        setMessage("Remoção concluída.");
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível remover.");
      }
    });
  }
  function refreshMarketPrices() {
    setMessage(undefined);
    startRefreshTransition(async () => {
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
        if (missing.length)
          parts.push(`Sem cotação: ${[...new Set(missing)].join(", ")}`);
        if (result.yahoo.missingFx.length)
          parts.push(`Sem câmbio: ${result.yahoo.missingFx.join(", ")}`);
        if (result.binance.missingConversion.length) {
          parts.push(`Sem conversão Binance para BRL: ${result.binance.missingConversion.join(", ")}`);
        }
        if (result.brapi.updated + result.yahoo.updated + result.binance.updated > 0) {
          notifyPortfolioSimulationInvalidated();
        }
        setMessage(parts.length ? `${parts.join(" · ")}.` : "Não há cotações para atualizar.");
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível atualizar as cotações.");
      }
    });
  }
  function openReview(item: PortfolioDto["integrationReview"][number]) {
    setReviewForm({
      ...item,
      instrumentType: item.suggestedInstrumentType ?? "",
      investmentClass: item.suggestedInvestmentClass ?? "",
      marketRegion: item.suggestedMarketRegion ?? "",
      familyCode: item.suggestedFamilyCode ?? "",
      indexation: item.suggestedIndexation ?? (item.providerType === "FIXED_INCOME" ? "PRE_FIXED" : ""),
      score: 0,
      accountCustomTypeName: "Saldo de conta remunerado",
      accountCatalogItemId: null,
      accountRateConvention: null,
      accountBenchmark: "",
      accountRateValue: "",
      confirmDistinctAutomaticBalance: false,
    });
  }
  function editAccountInvestment(asset: AssetDto, holding: AssetHoldingDto) {
    const source = holding.accountBalanceSource;
    if (!source)
      return;
    setReviewForm({
      id: source.linkId, source: "ACCOUNT_BALANCE", investmentName: `Saldo da conta · ${source.name}`,
      institution: holding.institution || holding.issuer, providerType: "ACCOUNT_BALANCE", providerSubtype: null,
      balance: holding.nativeCurrentValue ?? holding.currentValue, currencyCode: holding.currency,
      code: null, isin: null, value: null, quantity: null, amount: null, taxes: null, taxes2: null,
      amountProfit: null, amountWithdrawal: null, amountOriginal: null, lastMonthRate: null,
      annualRate: null, lastTwelveMonthsRate: null, quotaDate: null, owner: null, number: null,
      institutionNumber: null, insurerName: null, insurerCnpj: null, issuer: null, issuerCnpj: null,
      rate: null, rateType: null, fixedAnnualRate: null, purchaseDate: null, dueDate: null,
      issueDate: null, gracePeriodDate: null, metadata: null, status: null, updatedAt: source.expectedUpdatedAt,
      transactions: [], suggestedInstrumentType: "FIXED_INCOME", suggestedInvestmentClass: asset.investmentClass,
      suggestedMarketRegion: null, suggestedFamilyCode: asset.fixedIncomeFamilyCode,
      suggestedIndexation: asset.indexation, reviewReason: "O valor continua incluído em Saldo em conta. Depósitos e retiradas são feitos pela conta, não por este editor.",
      accountBalanceSource: { accountId: source.accountId, expectedUpdatedAt: source.expectedUpdatedAt, automaticBalanceConflicts: [] },
      instrumentType: "FIXED_INCOME", investmentClass: asset.investmentClass, marketRegion: "",
      familyCode: asset.fixedIncomeFamilyCode ?? "", indexation: asset.indexation ?? "", score: asset.score,
      accountCustomTypeName: holding.customTypeName ?? "Saldo de conta remunerado",
      accountCatalogItemId: holding.catalogItemId, accountRateConvention: holding.rateConvention,
      accountBenchmark: holding.benchmark ?? "", accountRateValue: holding.rateValue ?? "",
    });
  }
  function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!reviewForm)
      return;
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
    const storeOfValue = instrumentType === "ETF" && investmentClass === "STORE_OF_VALUE";
    if (storeOfValue && !review.marketRegion) {
      setMessage("Selecione se o ETF de reserva de valor é nacional ou internacional.");
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      try {
        if (review.source === "ACCOUNT_BALANCE" && review.accountBalanceSource) {
          await reviewAccountInvestmentAction({
            linkId: review.id, expectedUpdatedAt: review.accountBalanceSource.expectedUpdatedAt,
            investmentClass: investmentClass as "FIXED_INCOME" | "INTERNATIONAL_FIXED_INCOME",
            familyCode: review.familyCode, indexation: review.indexation as FixedIncomeIndexationKey,
            score: review.score, customTypeName: review.accountCustomTypeName,
            catalogItemId: review.accountCatalogItemId ?? null,
            rateConvention: review.accountRateConvention ?? null, benchmark: review.accountBenchmark || null,
            rateValue: review.accountRateValue ? Number(review.accountRateValue) : null,
            confirmDistinctAutomaticBalance: review.confirmDistinctAutomaticBalance ?? false,
          });
        }
        else
          await reviewPluggyDiagramLinkAction({
            linkId: review.id,
            instrumentType,
            investmentClass,
            marketRegion: storeOfValue && review.marketRegion ? review.marketRegion : null,
            familyCode: review.familyCode || null,
            indexation: review.indexation || null,
            score: review.score,
          });
        notifyPortfolioSimulationInvalidated();
        setReviewForm(null);
        setMessage("Investimento integrado ao diagrama.");
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível integrar o investimento.");
      }
    });
  }
  function excludeReview() {
    if (!reviewForm)
      return;
    startTransition(async () => {
      try {
        if (reviewForm.source === "ACCOUNT_BALANCE")
          await excludeAccountInvestmentAction(reviewForm.id);
        else
          await excludePluggyDiagramLinkAction(reviewForm.id);
        notifyPortfolioSimulationInvalidated();
        setReviewForm(null);
        setMessage(reviewForm.source === "ACCOUNT_BALANCE" ? "Saldo removido da Carteira e mantido em Contas." : "Investimento mantido apenas no Open Finance.");
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível excluir o investimento do diagrama.");
      }
    });
  }
  function savePendingContributionPrice(assetId: string) {
    const paidUnitPrice = Number(pendingPriceByAsset[assetId] ?? 0);
    if (!Number.isFinite(paidUnitPrice) || paidUnitPrice <= 0)
      return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        await saveAwaitingContributionPriceAction(assetId, paidUnitPrice);
        setPendingPriceByAsset((current) => {
          const next = { ...current };
          delete next[assetId];
          return next;
        });
        setMessage("Preço do aporte pendente atualizado.");
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar o preço do aporte.");
      }
    });
  }
  async function importFile(file: File) {
    setMessage("Lendo planilha…");
    try {
      const rows = await parseXlsxFile(file);
      const { marketRows: normalizedMarket, fixedIncomeRows: normalizedFixed } = parsePortfolioImportRows(rows, fixedIncomeFamilies, catalog);
      await importPortfolioRowsAction({
        marketRows: normalizedMarket,
        fixedIncomeRows: normalizedFixed,
      });
      setMessage(`${normalizedMarket.length} ativo(s) de mercado e ${normalizedFixed.length} aplicação(ões) de renda fixa importado(s).`);
    }
    catch (error) {
      setMessage(error instanceof Error ? error.message : "Planilha inválida.");
    }
    finally {
      if (fileInput.current)
        fileInput.current.value = "";
    }
  }
  const simpleScoreForm = form ? ["ETF", "MUTUAL_FUND"].includes(form.instrumentType) || !questionTypeForClass(form.investmentClass) : false;
  const holdingAsset = holdingForm ? assets.find((asset) => asset.id === holdingForm.assetId) : undefined;
  const holdingCatalog = holdingAsset?.fixedIncomeFamilyCode
    ? catalog.filter((item) => item.familyCode === holdingAsset.fixedIncomeFamilyCode)
    : [];
  function excludeAccountHolding(holding: AssetHoldingDto) {
    if (!holding.accountBalanceSource)
      return;
    const linkId = holding.accountBalanceSource.linkId;
    startTransition(async () => {
      try {
        await excludeAccountInvestmentAction(linkId);
        notifyPortfolioSimulationInvalidated();
      }
      catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível remover.");
      }
    });
  }
  return {
    excludeAccountHolding,
    assets,
    fixedIncomeFamilies,
    catalog,
    integrationReview,
    questions,
    initialAnswers,
    timeZone,
    valuesHidden,
    search,
    setSearch,
    filter,
    setFilter,
    instrumentFilter,
    setInstrumentFilter,
    form,
    setForm,
    quantityForms,
    setQuantityForms,
    fixedGroupForm,
    setFixedGroupForm,
    holdingForm,
    setHoldingForm,
    metadataEditor,
    setMetadataEditor,
    reviewForm,
    setReviewForm,
    expandedAssets,
    formAnswers,
    setFormAnswers,
    deleteTarget,
    setDeleteTarget,
    tickerOptions,
    setTickerOptions,
    tickerSearchPending,
    tickerSearchError,
    tickerListOpen,
    setTickerListOpen,
    tickerListPosition,
    setSelectedMarketTicker,
    activeTickerIndex,
    setActiveTickerIndex,
    message,
    pendingPriceByAsset,
    setPendingPriceByAsset,
    pending,
    refreshingPrices,
    panelRef,
    fileInput,
    mobileActions,
    tickerInputFocused,
    tickerInput,
    updateTickerListPosition,
    filtered,
    searchExpandedAssets,
    holdingTransactions,
    loadHoldingTransactions,
    total,
    chartData,
    hasRefreshableQuotes,
    formQuestionType,
    editingAsset,
    singleQuantityForm,
    previewQuantity,
    formQuestions,
    positives,
    negatives,
    marketTickerSearch,
    usesMarketTickerSearch,
    requiresStoreOfValueMarket,
    tickerQuery,
    hasSelectedMarketTicker,
    requiresYahooReitConfirmation,
    startAdding,
    edit,
    startHolding,
    toggleExpanded,
    changeTicker,
    selectTicker,
    handleTickerKeyDown,
    submit,
    submitFixedGroup,
    submitHolding,
    confirmDeletion,
    refreshMarketPrices,
    openReview,
    editAccountInvestment,
    submitReview,
    excludeReview,
    savePendingContributionPrice,
    importFile,
    simpleScoreForm,
    holdingAsset,
    holdingCatalog,
  };
}
export type AssetsPanelController = ReturnType<typeof useAssetsPanelController>;
