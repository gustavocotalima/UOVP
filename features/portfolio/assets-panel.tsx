"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronDown, ChevronRight, ExternalLink, FileSpreadsheet, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
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
  refreshBrapiMarketPricesAction,
  removeBrapiApiKeyAction,
  saveAssetAction,
  saveAssetAnswersAction,
  saveAssetHoldingAction,
  saveBrapiApiKeyAction,
  saveFixedIncomeGroupAction,
  searchBrapiTickersAction,
} from "./actions";
import { parseXlsxFile } from "./xlsx-parser";
import type { BrapiTickerSearchResult } from "./brapi";
import type { BrapiCredentialStatus } from "./brapi-credentials";
import { FIXED_INCOME_INDEXATIONS, FIXED_INCOME_INDEXATION_META, INSTRUMENT_TYPES, INSTRUMENT_TYPE_META, INVESTMENT_CLASSES, INVESTMENT_CLASS_META, MOCK_ASSET_CATALOG, RATE_CONVENTIONS, RATE_CONVENTION_META, type FixedIncomeIndexationKey, type InstrumentTypeKey, type InvestmentClassKey, type RateConventionKey } from "./constants";
import type { AssetDto, AssetHoldingDto, DiagramQuestionDto, PortfolioDto } from "./types";

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
};

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
};

const emptyFixedGroup: FixedIncomeGroupForm = { familyCode: "", indexation: "PRE_FIXED", investmentClass: "FIXED_INCOME", score: 0 };

function currentValue(asset: AssetDto) {
  return Number(asset.currentValue);
}

function assetLogoUrl(asset: AssetDto) {
  if (asset.logoUrl) return asset.logoUrl;
  if (asset.instrumentType !== "ETF" && !["BRAZILIAN_STOCKS", "REAL_ESTATE_FUNDS"].includes(asset.investmentClass)) return null;
  const symbol = asset.ticker.trim().toUpperCase().replace(/\.SA$/, "").replace(/(\d)F$/, "$1");
  return symbol ? `https://icons.brapi.dev/icons/${encodeURIComponent(symbol)}.svg` : null;
}

function AssetLogo({ asset }: { asset: AssetDto }) {
  const logoUrl = assetLogoUrl(asset);
  return (
    <span data-asset-logo-container className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border bg-white/95 text-neutral-500">
      <Building2 className="size-4" aria-hidden="true" />
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-asset-logo
          src={logoUrl}
          alt={`Logo de ${asset.name}`}
          className="absolute inset-[2px] h-[calc(100%-4px)] w-[calc(100%-4px)] rounded-[9px] object-contain"
          loading="lazy"
          onError={(event) => { event.currentTarget.hidden = true; }}
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
  questions,
  initialAnswers,
  brapiCredential,
}: {
  assets: AssetDto[];
  fixedIncomeFamilies: PortfolioDto["fixedIncomeFamilies"];
  catalog: PortfolioDto["catalog"];
  questions: DiagramQuestionDto[];
  initialAnswers: { assetId: string; questionId: string; answer: boolean }[];
  brapiCredential: BrapiCredentialStatus;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InvestmentClassKey | "ALL">("ALL");
  const [instrumentFilter, setInstrumentFilter] = useState<InstrumentTypeKey | "ALL">("ALL");
  const [form, setForm] = useState<FormAsset | null>(null);
  const [fixedGroupForm, setFixedGroupForm] = useState<FixedIncomeGroupForm | null>(null);
  const [holdingForm, setHoldingForm] = useState<HoldingForm | null>(null);
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(() => new Set());
  const [formAnswers, setFormAnswers] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const [brapiDialogOpen, setBrapiDialogOpen] = useState(false);
  const [brapiApiKey, setBrapiApiKey] = useState("");
  const [brapiError, setBrapiError] = useState<string>();
  const [tickerOptions, setTickerOptions] = useState<BrapiTickerSearchResult[]>([]);
  const [tickerSearchPending, setTickerSearchPending] = useState(false);
  const [tickerSearchError, setTickerSearchError] = useState<string>();
  const [tickerListOpen, setTickerListOpen] = useState(false);
  const [tickerListPosition, setTickerListPosition] = useState<TickerListPosition>();
  const [selectedBrapiTicker, setSelectedBrapiTicker] = useState<string>();
  const [activeTickerIndex, setActiveTickerIndex] = useState(-1);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
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

  useEffect(() => {
    const query = search.trim().toLowerCase();
    if (!query) return;
    const matchingParents = assets.filter((asset) => asset.holdings.some((holding) => [holding.typeName, holding.issuer, holding.productName, holding.ticker ?? ""].some((value) => value.toLowerCase().includes(query)))).map((asset) => asset.id);
    if (!matchingParents.length) return;
    setExpandedAssets((current) => new Set([...current, ...matchingParents]));
  }, [assets, search]);
  const total = assets.reduce((sum, asset) => sum + currentValue(asset), 0);
  const chartData = INVESTMENT_CLASSES.map((investmentClass) => ({
    name: INVESTMENT_CLASS_META[investmentClass].label,
    color: INVESTMENT_CLASS_META[investmentClass].color,
    value: assets.filter((asset) => asset.investmentClass === investmentClass).reduce((sum, asset) => sum + currentValue(asset), 0),
  })).filter((item) => item.value > 0);

  const formQuestionType = form && form.instrumentType !== "ETF" ? questionTypeForClass(form.investmentClass) : null;
  const formQuestions = questions.filter((question) => question.active && question.type === formQuestionType);
  const positives = formQuestions.filter((question) => formAnswers[question.id] === true).length;
  const negatives = formQuestions.length - positives;
  const tickerInvestmentClass = form && !form.id && (form.instrumentType === "ETF" || ["BRAZILIAN_STOCKS", "REAL_ESTATE_FUNDS"].includes(form.investmentClass))
    ? form.instrumentType === "ETF" ? "ETF" : form.investmentClass
    : null;
  const usesBrapiTickerSearch = tickerInvestmentClass !== null;
  const tickerQuery = tickerInvestmentClass && form ? form.ticker.trim() : "";
  const hasSelectedBrapiTicker = !usesBrapiTickerSearch || selectedBrapiTicker === form?.ticker;

  useEffect(() => {
    const requestId = ++tickerRequestId.current;
    if (selectedBrapiTicker === tickerQuery) {
      setTickerSearchPending(false);
      setTickerListOpen(false);
      return;
    }
    if (tickerQuery.length < 2) {
      setTickerOptions([]);
      setTickerSearchError(undefined);
      setTickerSearchPending(false);
      setActiveTickerIndex(-1);
      return;
    }

    const timer = window.setTimeout(async () => {
      setTickerSearchPending(true);
      setTickerSearchError(undefined);
      try {
        if (!tickerInvestmentClass) return;
        const options = await searchBrapiTickersAction(tickerQuery, tickerInvestmentClass);
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
  }, [selectedBrapiTicker, tickerInvestmentClass, tickerQuery, updateTickerListPosition]);

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
    setSelectedBrapiTicker(undefined);
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
    setSelectedBrapiTicker(undefined);
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

  function toggleExpanded(assetId: string) {
    setExpandedAssets((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function changeTicker(value: string) {
    if (!form) return;
    const ticker = value.toUpperCase();
    if (form.instrumentType === "ETF" || ["BRAZILIAN_STOCKS", "REAL_ESTATE_FUNDS"].includes(form.investmentClass)) {
      setSelectedBrapiTicker(undefined);
      setForm({ ...form, ticker, name: ticker, unitPrice: 0, currency: "BRL", fractional: false });
      updateTickerListPosition();
      setTickerListOpen(true);
      setActiveTickerIndex(-1);
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

  function selectTicker(option: BrapiTickerSearchResult) {
    if (!form) return;
    setSelectedBrapiTicker(option.symbol);
    setForm({
      ...form,
      ticker: option.symbol,
      name: option.name,
      unitPrice: option.lastPrice ?? 0,
      currency: option.currency,
      fractional: false,
    });
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
    if (usesBrapiTickerSearch && !hasSelectedBrapiTicker) return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        await saveAssetAction(form);
        if (form.id && formQuestionType) await saveAssetAnswersAction(form.id, formAnswers);
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
        setForm(null);
        setDeleteTarget(undefined);
        setMessage("Remoção concluída.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível remover.");
      }
    });
  }

  function configureBrapi(event: FormEvent) {
    event.preventDefault();
    setBrapiError(undefined);
    setMessage(undefined);
    startTransition(async () => {
      try {
        await saveBrapiApiKeyAction(brapiApiKey);
        setBrapiApiKey("");
        setBrapiDialogOpen(false);
        setMessage("Chave da brapi validada e salva com segurança.");
      } catch (error) {
        setBrapiError(error instanceof Error ? error.message : "Não foi possível validar a chave da brapi.");
      }
    });
  }

  function removeBrapiCredential() {
    startTransition(async () => {
      try {
        await removeBrapiApiKeyAction();
        setBrapiApiKey("");
        setBrapiDialogOpen(false);
        setMessage("Chave da brapi removida.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível remover a chave da brapi.");
      }
    });
  }

  function refreshBrapiMarketPrices() {
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await refreshBrapiMarketPricesAction();
        const missing = result.missing.length ? ` Sem cotação: ${result.missing.join(", ")}.` : "";
        setMessage(`${result.updated} cotação(ões) de ativos da B3 atualizada(s) pela brapi.${missing}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível atualizar as cotações na brapi.");
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

  const simpleScoreForm = form ? form.instrumentType === "ETF" || !questionTypeForClass(form.investmentClass) : false;
  const holdingAsset = holdingForm ? assets.find((asset) => asset.id === holdingForm.assetId) : undefined;
  const holdingCatalog = holdingAsset?.fixedIncomeFamilyCode
    ? catalog.filter((item) => item.familyCode === holdingAsset.fixedIncomeFamilyCode)
    : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Seus ativos</CardTitle>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{assets.length} ativos · {formatMoney(total)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setBrapiDialogOpen(true)} disabled={pending}>
                <KeyRound className="size-4" /> {brapiCredential.configured && brapiCredential.lastFour ? `brapi ••••${brapiCredential.lastFour}` : "Configurar brapi"}
              </Button>
              <Button variant="outline" onClick={refreshBrapiMarketPrices} disabled={pending || !assets.some((asset) => asset.holdings.some((holding) => holding.pricingSource === "BRAPI"))}><RefreshCw className="size-4" /> Atualizar B3</Button>
              <input ref={fileInput} className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} />
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
              <table className="w-full min-w-[1040px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[300px]" />
                  <col className="w-[100px]" />
                  <col className="w-[120px]" />
                  <col className="w-[115px]" />
                  <col className="w-[70px]" />
                  <col className="w-[110px]" />
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
                    <th className="whitespace-nowrap px-3 py-3">Atualizado</th>
                    <th className="whitespace-nowrap px-3 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((asset) => {
                    const expandable = asset.instrumentType === "FIXED_INCOME";
                    const expanded = expandedAssets.has(asset.id);
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
                          <td className="whitespace-nowrap px-3"><span className="grid size-8 place-items-center rounded-full bg-[var(--muted)] font-semibold">{asset.score}</span></td>
                          <td className="whitespace-nowrap px-3">{expandable ? `${asset.holdings.length} aplicação(ões)` : Number(asset.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</td>
                          <td className="whitespace-nowrap px-3 text-xs text-[var(--muted-foreground)]">{new Date(asset.updatedAt).toLocaleDateString("pt-BR")}</td>
                          <td className="px-3"><div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => edit(asset)} aria-label={`Editar ${asset.ticker}`}><Pencil className="size-4" /> Editar</Button></div></td>
                        </tr>
                        {expandable && expanded && (
                          <tr className="border-b bg-[color-mix(in_srgb,var(--muted)_42%,transparent)]">
                            <td colSpan={8} className="px-5 py-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div><strong className="text-sm">Aplicações do grupo</strong><p className="text-xs text-[var(--muted-foreground)]">O valor do grupo é a soma das aplicações abaixo.</p></div>
                                <Button size="sm" onClick={() => startHolding(asset)}><Plus className="size-4" /> Adicionar aplicação</Button>
                              </div>
                              {asset.holdings.length ? (
                                <div className="overflow-x-auto rounded-xl border bg-[var(--card)]">
                                  <table className="w-full min-w-[920px] text-left text-xs">
                                    <thead className="border-b text-[var(--muted-foreground)]"><tr><th className="px-3 py-2">Tipo / produto</th><th className="px-3 py-2">Emissor</th><th className="px-3 py-2">Investido</th><th className="px-3 py-2">Atual</th><th className="px-3 py-2">Taxa</th><th className="px-3 py-2">Compra</th><th className="px-3 py-2">Vencimento</th><th className="px-3 py-2 text-right">Ações</th></tr></thead>
                                    <tbody>{asset.holdings.map((holding) => (
                                      <tr key={holding.id} className="border-b last:border-0">
                                        <td className="px-3 py-3"><strong className="block max-w-52 truncate" title={holding.typeName}>{holding.typeName}</strong><span className="block max-w-52 truncate text-[var(--muted-foreground)]" title={holding.productName}>{holding.productName}</span></td>
                                        <td className="px-3 py-3">{holding.issuer}</td>
                                        <td className="whitespace-nowrap px-3 py-3">{holding.investedValue == null ? "—" : formatMoney(holding.investedValue)}</td>
                                        <td className="whitespace-nowrap px-3 py-3 font-semibold">{formatMoney(holding.currentValue)}</td>
                                        <td className="whitespace-nowrap px-3 py-3">{holding.rateValue == null ? "—" : `${Number(holding.rateValue).toLocaleString("pt-BR")} ${holding.benchmark ?? ""}`}</td>
                                        <td className="whitespace-nowrap px-3 py-3">{holding.purchaseDate ? new Date(holding.purchaseDate).toLocaleDateString("pt-BR") : "—"}</td>
                                        <td className="whitespace-nowrap px-3 py-3">{holding.maturityDate ? new Date(holding.maturityDate).toLocaleDateString("pt-BR") : "—"}</td>
                                        <td className="px-3 py-3"><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => startHolding(asset, holding)}><Pencil className="size-3.5" /> Editar</Button><Button variant="ghost" size="sm" className="text-[var(--danger)]" onClick={() => setDeleteTarget({ kind: "holding", id: holding.id, label: holding.productName })}><Trash2 className="size-3.5" /> Excluir</Button></div></td>
                                      </tr>
                                    ))}</tbody>
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
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        title={form?.id ? "Editar ativo" : "Adicionar ativo"}
        className="max-w-4xl"
        footer={form && (
          <>
            {form.id && <Button type="button" variant="danger" onClick={() => setDeleteTarget({ kind: "asset", id: form.id!, label: form.ticker })} disabled={pending}>Remover</Button>}
            <Button type="submit" form="asset-modal-form" disabled={pending || !hasSelectedBrapiTicker}>{pending ? "Salvando…" : form.id ? "Atualizar e fechar" : "Adicionar"}</Button>
          </>
        )}
      >
        {form && (
          <form id="asset-modal-form" onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="asset-instrument">Instrumento</Label>
              <Select id="asset-instrument" className="w-full" value={form.instrumentType} disabled={Boolean(form.id)} onChange={(event) => {
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
                };
                setSelectedBrapiTicker(undefined);
                setTickerOptions([]);
                setForm({ ...emptyAsset, instrumentType, investmentClass: defaultClass[instrumentType] });
              }}>
                {INSTRUMENT_TYPES.map((instrumentType) => <option key={instrumentType} value={instrumentType}>{INSTRUMENT_TYPE_META[instrumentType].label}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset-class">Classe para metas e cálculos</Label>
              <Select id="asset-class" className="w-full" value={form.investmentClass} disabled={Boolean(form.id && form.instrumentType !== "ETF")} onChange={(event) => {
                const investmentClass = event.target.value as InvestmentClassKey;
                const classInstrument: Partial<Record<InvestmentClassKey, InstrumentTypeKey>> = {
                  REAL_ESTATE_FUNDS: "REAL_ESTATE_FUND",
                  REITS: "REIT",
                  CRYPTO: "CRYPTO",
                };
                setSelectedBrapiTicker(undefined);
                setTickerOptions([]);
                setTickerListOpen(false);
                const keepsFixedGroup = form.instrumentType === "ETF" && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(investmentClass);
                setForm({
                  ...form,
                  investmentClass,
                  instrumentType: form.instrumentType === "ETF" ? "ETF" : classInstrument[investmentClass] ?? "STOCK",
                  fixedIncomeFamilyCode: keepsFixedGroup ? form.fixedIncomeFamilyCode : null,
                  indexation: keepsFixedGroup ? form.indexation ?? "OTHER" : null,
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
                  {usesBrapiTickerSearch ? (
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
                          if (!hasSelectedBrapiTicker && (tickerOptions.length || tickerSearchError)) setTickerListOpen(true);
                        }}
                        onBlur={() => {
                          tickerInputFocused.current = false;
                          setTickerListOpen(false);
                        }}
                        onKeyDown={handleTickerKeyDown}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={tickerListOpen}
                        aria-controls="brapi-ticker-options"
                        aria-activedescendant={activeTickerIndex >= 0 ? `brapi-ticker-option-${activeTickerIndex}` : undefined}
                        aria-describedby="asset-ticker-help"
                        required
                      />
                      <span className="pointer-events-none absolute right-3 top-3 text-[var(--muted-foreground)]">
                        {tickerSearchPending ? <LoaderCircle className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
                      </span>
                      {tickerListOpen && tickerQuery.length >= 2 && tickerListPosition && typeof document !== "undefined" && createPortal(
                        <div
                          id="brapi-ticker-options"
                          role="listbox"
                          aria-label="Tickers encontrados"
                          className="fixed z-[200] overflow-y-auto rounded-xl border bg-[var(--card)] p-1 shadow-2xl scrollbar-thin"
                          style={tickerListPosition}
                        >
                          {tickerOptions.map((option, index) => (
                            <button
                              id={`brapi-ticker-option-${index}`}
                              key={`${option.symbol}-${option.subType ?? option.assetType ?? "asset"}`}
                              type="button"
                              role="option"
                              aria-selected={activeTickerIndex === index}
                              className={`grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${activeTickerIndex === index ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]"}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setActiveTickerIndex(index)}
                              onClick={() => selectTicker(option)}
                            >
                              <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white/95 text-neutral-500">
                                <Building2 className="size-4" aria-hidden="true" />
                                {option.logoUrl && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={option.logoUrl}
                                    alt={`Logo de ${option.name}`}
                                    className="absolute inset-[2px] h-[calc(100%-4px)] w-[calc(100%-4px)] rounded-md object-contain"
                                    loading="lazy"
                                    onError={(event) => { event.currentTarget.hidden = true; }}
                                  />
                                )}
                              </span>
                              <span className="min-w-0"><strong className="block">{option.symbol}</strong><span className="block max-w-[190px] truncate text-xs text-[var(--muted-foreground)] sm:max-w-[220px]" title={option.name}>{option.name}</span></span>
                              <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">{option.subType || option.assetType || "B3"}</span>
                            </button>
                          ))}
                          {!tickerSearchPending && !tickerOptions.length && !tickerSearchError && <p className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">Nenhum ticker encontrado.</p>}
                          {tickerSearchError && <p role="alert" className="px-3 py-4 text-center text-sm text-[var(--danger)]">{tickerSearchError}</p>}
                        </div>,
                        document.body,
                      )}
                      <p id="asset-ticker-help" className="mt-2 text-xs text-[var(--muted-foreground)]">
                        {hasSelectedBrapiTicker ? "Ativo selecionado." : "Digite para buscar e selecione uma opção da lista."}
                      </p>
                    </div>
                  ) : (
                    <>
                      <Input id="asset-ticker" placeholder="Ex: PETR4" value={form.ticker} onChange={(event) => changeTicker(event.target.value)} list="mock-tickers" disabled={Boolean(form.id)} required />
                      <datalist id="mock-tickers">{MOCK_ASSET_CATALOG.filter((asset) => asset.investmentClass === form.investmentClass).map((asset) => <option key={asset.ticker} value={asset.ticker}>{asset.name}</option>)}</datalist>
                    </>
                  )}
                </div>
                <div className="space-y-2"><Label htmlFor="asset-quantity">Quantidade</Label><Input id="asset-quantity" type="number" min="0" step="any" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} required /></div>
                {simpleScoreForm && <div className="space-y-2 sm:col-span-2"><Label htmlFor="asset-strength">{form.instrumentType === "ETF" ? "Nota do ETF (manual)" : "Nota de força"}</Label><Input id="asset-strength" type="number" min="0" max="30" value={form.score} onChange={(event) => setForm({ ...form, score: Number(event.target.value) })} /></div>}
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
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="fixed-score">Nota do grupo</Label><Input id="fixed-score" type="number" min="0" max="30" value={fixedGroupForm.score} onChange={(event) => setFixedGroupForm({ ...fixedGroupForm, score: Number(event.target.value) })} required /></div>
            <p className="text-sm text-[var(--muted-foreground)] sm:col-span-2">O grupo pode ser salvo vazio. As aplicações reais são adicionadas ao expandir a linha na carteira.</p>
          </form>
        )}
      </Dialog>

      <Dialog
        open={holdingForm !== null && Boolean(holdingAsset)}
        onOpenChange={(open) => !open && setHoldingForm(null)}
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

      <Dialog
        open={brapiDialogOpen}
        onOpenChange={(open) => {
          setBrapiDialogOpen(open);
          if (!open) {
            setBrapiApiKey("");
            setBrapiError(undefined);
          }
        }}
        title="Configurar brapi"
        description="Cada usuário conecta sua própria chave para consultar cotações de ações brasileiras e fundos imobiliários."
        className="max-w-xl"
        footer={(
          <>
            {brapiCredential.configured && <Button type="button" variant="danger" onClick={removeBrapiCredential} disabled={pending}>Remover chave</Button>}
            <Button type="submit" form="brapi-credential-form" disabled={pending || brapiApiKey.trim().length < 8}>{pending ? "Validando…" : "Validar e salvar"}</Button>
          </>
        )}
      >
        <form id="brapi-credential-form" onSubmit={configureBrapi} className="space-y-4">
          {brapiError && <p role="alert" className="rounded-xl bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] p-3 text-sm text-[var(--danger)]">{brapiError}</p>}
          {brapiCredential.configured && brapiCredential.lastFour && (
            <p className="rounded-xl border bg-[var(--muted)] p-3 text-sm">
              Chave conectada terminando em <strong>{brapiCredential.lastFour}</strong>.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="brapi-api-key">Chave de API da brapi</Label>
            <Input
              id="brapi-api-key"
              type="password"
              value={brapiApiKey}
              onChange={(event) => setBrapiApiKey(event.target.value)}
              placeholder={brapiCredential.configured ? "Cole uma nova chave para substituir a atual" : "Cole sua chave da brapi"}
              autoComplete="off"
              maxLength={2000}
              required
            />
          </div>
          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
            A chave é validada pela brapi no backend, armazenada criptografada e nunca enviada ao navegador após o salvamento.
          </p>
          <a className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline" href="https://brapi.dev/dashboard" target="_blank" rel="noreferrer">
            Obter chave no painel da brapi <ExternalLink className="size-4" />
          </a>
        </form>
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
