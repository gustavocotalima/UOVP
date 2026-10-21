"use client";
import { PrivateValue } from "@/components/ui/private-value";
import { createPortal } from "react-dom";
import { Bitcoin, Building2, ChartNoAxesCombined, ChevronDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FIXED_INCOME_INDEXATIONS, FIXED_INCOME_INDEXATION_META, INSTRUMENT_TYPES, INSTRUMENT_TYPE_META, INVESTMENT_CLASSES, INVESTMENT_CLASS_META, MOCK_ASSET_CATALOG, type FixedIncomeIndexationKey, type InstrumentTypeKey, type InvestmentClassKey } from "../constants";
import { financialModelingPrepLogoUrl, usableBrapiLogoUrl } from "../market-logo";
import { emptyAsset, emptyFixedGroup, questionTypeForClass } from "./model";
import type { FormAsset } from "./model";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function AssetDialog({ controller }: {
  controller: Pick<AssetsPanelController, "fixedIncomeFamilies" | "questions" | "initialAnswers" | "form" | "setForm" | "quantityForms" | "setQuantityForms" | "setFixedGroupForm" | "formAnswers" | "setFormAnswers" | "setDeleteTarget" | "tickerOptions" | "setTickerOptions" | "tickerSearchPending" | "tickerSearchError" | "tickerListOpen" | "setTickerListOpen" | "tickerListPosition" | "setSelectedMarketTicker" | "activeTickerIndex" | "setActiveTickerIndex" | "pending" | "tickerInputFocused" | "tickerInput" | "updateTickerListPosition" | "formQuestionType" | "editingAsset" | "singleQuantityForm" | "previewQuantity" | "formQuestions" | "positives" | "negatives" | "marketTickerSearch" | "usesMarketTickerSearch" | "requiresStoreOfValueMarket" | "tickerQuery" | "hasSelectedMarketTicker" | "requiresYahooReitConfirmation" | "changeTicker" | "selectTicker" | "handleTickerKeyDown" | "submit" | "simpleScoreForm">;
}) {
  const { fixedIncomeFamilies, questions, initialAnswers, form, setForm, quantityForms, setQuantityForms, setFixedGroupForm, formAnswers, setFormAnswers, setDeleteTarget, tickerOptions, setTickerOptions, tickerSearchPending, tickerSearchError, tickerListOpen, setTickerListOpen, tickerListPosition, setSelectedMarketTicker, activeTickerIndex, setActiveTickerIndex, pending, tickerInputFocused: tickerInputFocusedRef, tickerInput, updateTickerListPosition, formQuestionType, editingAsset, singleQuantityForm, previewQuantity, formQuestions, positives, negatives, marketTickerSearch, usesMarketTickerSearch, requiresStoreOfValueMarket, tickerQuery, hasSelectedMarketTicker, requiresYahooReitConfirmation, changeTicker, selectTicker, handleTickerKeyDown, submit, simpleScoreForm } = controller;
  const multipleManualPositions = (editingAsset?.holdings.filter((holding) => holding.positionSource === "MANUAL").length ?? 0) > 1;
  return (<Dialog privateEditor open={form !== null} mobileMode="full" onOpenChange={(open) => !open && setForm(null)} dismissible={!pending} title={form?.id ? "Editar ativo" : "Adicionar ativo"} className="max-w-4xl" footer={form && (<>
    {form.id && <Button type="button" variant="danger" onClick={() => setDeleteTarget({ kind: "asset", id: form.id!, label: form.ticker })} disabled={pending}>Remover</Button>}
    <Button type="submit" form="asset-modal-form" disabled={pending
      || !hasSelectedMarketTicker
      || Boolean(requiresStoreOfValueMarket && !form.marketRegion)
      || Boolean(requiresYahooReitConfirmation && !form.yahooReitConfirmed)}>
      {pending ? "Salvando…" : form.id ? "Atualizar e fechar" : "Adicionar"}
    </Button>
  </>)}>
    {form && (<form id="asset-modal-form" onSubmit={submit} className="space-y-5">
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
            marketRegion: instrumentType === "ETF" && investmentClass === "STORE_OF_VALUE"
              ? form.marketRegion
              : null,
            yahooReitConfirmed: false,
          });
          setFormAnswers(questionType
            ? Object.fromEntries(questions
              .filter((question) => question.active && question.type === questionType)
              .map((question) => [
                question.id,
                form.id
                  ? initialAnswers.find((answer) => answer.assetId === form.id && answer.questionId === question.id)?.answer ?? false
                  : false,
              ]))
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
            marketRegion: investmentClass === "STORE_OF_VALUE" && form.investmentClass === "STORE_OF_VALUE"
              ? form.marketRegion
              : null,
            yahooReitConfirmed: false,
          });
        }}>
          {INVESTMENT_CLASSES.map((investmentClass) => <option key={investmentClass} value={investmentClass}>{INVESTMENT_CLASS_META[investmentClass].label}</option>)}
        </Select>
      </div>

      {requiresStoreOfValueMarket && (<div className="space-y-2">
        <Label htmlFor="asset-market-region">Mercado do ETF</Label>
        <Select id="asset-market-region" className="w-full" value={form.marketRegion ?? ""} onChange={(event) => {
          const marketRegion = event.target.value as FormAsset["marketRegion"];
          setSelectedMarketTicker(undefined);
          setTickerOptions([]);
          setTickerListOpen(false);
          setForm({
            ...form,
            marketRegion,
            ...(form.id
              ? {}
              : {
                ticker: "",
                name: "",
                unitPrice: 0,
                currency: marketRegion === "INTERNATIONAL" ? "USD" : "BRL",
                fractional: marketRegion === "INTERNATIONAL",
              }),
          });
        }} required>
          <option value="">Selecione o mercado</option>
          <option value="BRAZIL">Nacional (B3 · brapi)</option>
          <option value="INTERNATIONAL">Internacional (Yahoo Finance)</option>
        </Select>
        <p className="text-xs text-[var(--muted-foreground)]">
          O mercado define a fonte da cotação, a moeda e se o aporte pode usar frações.
        </p>
      </div>)}

      {form.instrumentType === "ETF" && ["FIXED_INCOME", "INTERNATIONAL_FIXED_INCOME"].includes(form.investmentClass) && (<div className="grid gap-4 sm:grid-cols-2">
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
      </div>)}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="asset-ticker">Ticker (Código)</Label>
          {usesMarketTickerSearch ? (<div className="relative">
            <Input ref={tickerInput} id="asset-ticker" className="pr-10" placeholder="Ex: PETR4" value={form.ticker} onChange={(event) => changeTicker(event.target.value)} onFocus={() => {
              tickerInputFocusedRef.current = true;
              updateTickerListPosition();
              if (!hasSelectedMarketTicker && (tickerOptions.length || tickerSearchError))
                setTickerListOpen(true);
            }} onBlur={() => {
              tickerInputFocusedRef.current = false;
              setTickerListOpen(false);
            }} onKeyDown={handleTickerKeyDown} role="combobox" aria-autocomplete="list" aria-expanded={tickerListOpen} aria-controls="market-ticker-options" aria-activedescendant={activeTickerIndex >= 0 ? `market-ticker-option-${activeTickerIndex}` : undefined} aria-describedby="asset-ticker-help" required />
            <span className="pointer-events-none absolute right-3 top-3 text-[var(--muted-foreground)]">
              {tickerSearchPending ? <LoaderCircle className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
            </span>
            {tickerListOpen && tickerQuery.length >= 1 && tickerListPosition && typeof document !== "undefined" && createPortal(<div id="market-ticker-options" role="listbox" aria-label="Tickers encontrados" className="fixed z-[200] overflow-y-auto rounded-xl border bg-[var(--card)] p-1 shadow-2xl scrollbar-thin" style={tickerListPosition}>
              {tickerOptions.map((option, index) => {
                const logoUrl = option.provider === "BRAPI"
                  ? usableBrapiLogoUrl(option.logoUrl)
                  : option.logoUrl
                  ?? (option.provider === "YAHOO"
                    ? financialModelingPrepLogoUrl(option.symbol)
                    : null);
                const badge = option.provider === "BRAPI"
                  ? option.subType || option.assetType || "B3"
                  : option.provider === "BINANCE"
                    ? "Cripto · Binance"
                    : option.quoteType === "ETF"
                      ? "ETF · Yahoo"
                      : option.reitStatus === "CONFIRMED"
                        ? "REIT · Yahoo"
                        : "Ação · Yahoo";
                return (<button id={`market-ticker-option-${index}`} key={`${option.provider}-${option.symbol}`} type="button" role="option" aria-selected={activeTickerIndex === index} className={`grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${activeTickerIndex === index ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]"}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveTickerIndex(index)} onClick={() => selectTicker(option)}>
                  <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white/95 text-neutral-500">
                    {option.provider === "BINANCE"
                      ? <Bitcoin className="size-4" aria-hidden="true" />
                      : form.instrumentType === "ETF"
                        ? <ChartNoAxesCombined className="size-4" aria-hidden="true" />
                        : <Building2 className="size-4" aria-hidden="true" />}
                    {logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt={`Logo de ${option.name}`} className="absolute inset-[2px] h-[calc(100%-4px)] w-[calc(100%-4px)] rounded-md bg-white object-contain" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />)}
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
                </button>);
              })}
              {!tickerSearchPending && !tickerOptions.length && !tickerSearchError && <p className="px-3 py-4 text-center text-sm text-[var(--muted-foreground)]">Nenhum ticker encontrado.</p>}
              {tickerSearchError && <p role="alert" className="px-3 py-4 text-center text-sm text-[var(--danger)]">{tickerSearchError}</p>}
            </div>, document.body)}
            <p id="asset-ticker-help" className="mt-2 text-xs text-[var(--muted-foreground)]">
              {hasSelectedMarketTicker
                ? `Ativo selecionado no ${marketTickerSearch?.provider === "YAHOO"
                  ? "Yahoo Finance"
                  : marketTickerSearch?.provider === "BINANCE"
                    ? "catálogo Spot da Binance"
                    : "catálogo da brapi"}.`
                : "Digite para buscar e selecione uma opção da lista."}
            </p>
            {requiresYahooReitConfirmation && (<label className="mt-3 flex items-start gap-3 rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/8 p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={form.yahooReitConfirmed} onChange={(event) => setForm({ ...form, yahooReitConfirmed: event.target.checked })} />
              <span>
                O Yahoo Finance não identifica este ativo definitivamente como REIT.
                Confirmo que desejo classificá-lo como REIT.
              </span>
            </label>)}
          </div>) : (<>
            <Input id="asset-ticker" placeholder={requiresStoreOfValueMarket && !form.marketRegion ? "Selecione o mercado primeiro" : "Ex: PETR4"} value={form.ticker} onChange={(event) => changeTicker(event.target.value)} list="mock-tickers" disabled={Boolean(form.id) || Boolean(requiresStoreOfValueMarket && !form.marketRegion)} required />
            <datalist id="mock-tickers">{MOCK_ASSET_CATALOG.filter((asset) => asset.investmentClass === form.investmentClass).map((asset) => <option key={asset.ticker} value={asset.ticker}>{asset.name}</option>)}</datalist>
          </>)}
        </div>
        <div className="space-y-2">
          <Label htmlFor="asset-quantity">{singleQuantityForm?.mode === "CUSTOM" ? "Quantidade temporária" : editingAsset?.providerControlled && !singleQuantityForm ? "Quantidade total" : "Quantidade"}</Label>
          <Input id="asset-quantity" type="number" min="0" step={singleQuantityForm?.step ?? "any"} value={singleQuantityForm ? singleQuantityForm.value : editingAsset?.providerControlled ? previewQuantity : form.quantity} onChange={(event) => singleQuantityForm
            ? setQuantityForms((current) => current.map((entry) => entry.linkId === singleQuantityForm.linkId ? { ...entry, value: event.target.value } : entry))
            : setForm({ ...form, quantity: Number(event.target.value) })} disabled={multipleManualPositions || (editingAsset?.providerControlled && (!singleQuantityForm || singleQuantityForm.mode === "PROVIDER"))} required />
        </div>
        {quantityForms.length > 0 && (<div className="space-y-3 sm:col-span-2">
          <p className="text-xs text-[var(--muted-foreground)]">Quantidades temporárias serão salvas com o ativo e mantidas nas sincronizações. Os dados originais da instituição não são alterados. Uma mudança na quantidade da Pluggy exibirá um aviso para escolher entre a instituição e o valor manual.</p>
          {quantityForms.map((entry) => (<div key={entry.linkId} className="space-y-2 rounded-xl border p-3">
            <p className="break-words text-xs font-semibold">{entry.label}</p>
            {!singleQuantityForm && (<div className="space-y-2">
              <Label htmlFor={`asset-position-quantity-${entry.linkId}`}>Quantidade da posição</Label>
              <Input id={`asset-position-quantity-${entry.linkId}`} type="number" min="0" step={entry.step} value={entry.value} disabled={entry.mode === "PROVIDER"} required={entry.mode === "CUSTOM"} onChange={(event) => setQuantityForms((current) => current.map((value) => value.linkId === entry.linkId ? { ...value, value: event.target.value } : value))} />
            </div>)}
            <p className="text-xs text-[var(--muted-foreground)]">Instituição: {entry.expectedProviderQuantity === null ? "Não informada" : <PrivateValue>{Number(entry.expectedProviderQuantity).toLocaleString("pt-BR", { maximumFractionDigits: 10 })}</PrivateValue>}</p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={entry.mode === "CUSTOM"} onChange={(event) => {
                const checked = event.target.checked;
                setQuantityForms((current) => current.map((value) => value.linkId === entry.linkId
                  ? { ...value, mode: checked ? "CUSTOM" : "PROVIDER", value: checked ? value.value : value.expectedProviderQuantity ?? "0" } : value));
              }} />
              {entry.mode === "CUSTOM" ? "Quantidade temporária · desmarque para usar a instituição" : "Usar quantidade temporária"}
            </label>
          </div>))}
          <p className="text-xs text-[var(--muted-foreground)]">Zero retira a posição dos totais. Esta correção não cria movimentações nem confirma aportes aguardando sincronização.</p>
        </div>)}
        {editingAsset?.providerControlled && !quantityForms.length && <p className="text-xs text-[var(--muted-foreground)] sm:col-span-2">A quantidade é controlada pelo provedor e será atualizada na próxima sincronização.</p>}
        {multipleManualPositions && <p className="text-xs text-[var(--muted-foreground)] sm:col-span-2">Este ativo contém posições manuais separadas. Para ajustar quantidades e custos individuais, exporte a planilha e mantenha o ID de cada aplicação ao importar.</p>}
        {!editingAsset?.providerControlled && !multipleManualPositions && <>
          <div className="space-y-2">
            <Label htmlFor="asset-invested">Custo de aquisição (opcional)</Label>
            <Input id="asset-invested" type="number" min="0" step="0.01" value={form.investedValue ?? ""} onChange={(event) => setForm({ ...form, investedValue: event.target.value === "" ? null : Number(event.target.value), investedValueCurrency: event.target.value === "" ? null : form.investedValueCurrency ?? form.currency, investmentCostEdited: true })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="asset-invested-currency">Moeda do custo</Label>
            <Input id="asset-invested-currency" value={form.investedValueCurrency ?? ""} placeholder={form.currency} minLength={3} maxLength={8} pattern="[A-Za-z0-9]{3,8}" required={form.investedValue !== null} disabled={form.investedValue === null} onChange={(event) => setForm({ ...form, investedValueCurrency: event.target.value.toUpperCase() || null, investmentCostEdited: true })} />
          </div>
          <p className="text-xs text-[var(--muted-foreground)] sm:col-span-2">Informe o total efetivamente pago e sua moeda. A cotação atual não determina o custo histórico. Deixe vazio se não souber.</p>
        </>}
        {simpleScoreForm && <div className="space-y-2 sm:col-span-2"><Label htmlFor="asset-strength">{form.instrumentType === "ETF" ? "Nota do ETF (manual)" : form.instrumentType === "MUTUAL_FUND" ? "Nota do fundo (manual)" : "Nota de força"}</Label><Input id="asset-strength" type="number" min="-30" max="30" value={form.score} onChange={(event) => setForm({ ...form, score: Number(event.target.value) })} /></div>}
      </div>

      {form.id && formQuestionType && (<div className="space-y-4 border-t pt-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-3 text-center"><span className="block text-xs text-[var(--muted-foreground)]">Pontos positivos</span><strong className="text-xl">{positives}</strong></div>
          <div className="rounded-xl border p-3 text-center"><span className="block text-xs text-[var(--muted-foreground)]">Pontos negativos</span><strong className="text-xl">{negatives}</strong></div>
          <div className="rounded-xl border p-3 text-center"><span className="block text-xs text-[var(--muted-foreground)]">Pontuação final</span><strong className="text-xl">{positives - negatives}</strong></div>
        </div>
        <div className="divide-y rounded-xl border px-4">
          {formQuestions.map((question) => (<div key={question.id} className="flex items-center justify-between gap-4 py-4">
            <div><p className="text-sm leading-5">{question.text}</p><span className="mt-1 block text-xs font-semibold text-[var(--muted-foreground)]">{question.criterion}</span></div>
            <button type="button" role="switch" aria-checked={formAnswers[question.id] === true} aria-label={question.text} onClick={() => setFormAnswers({ ...formAnswers, [question.id]: formAnswers[question.id] !== true })} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${formAnswers[question.id] ? "bg-[var(--primary)]" : "bg-[var(--muted)]"}`}>
              <span className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform ${formAnswers[question.id] ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>))}
        </div>
      </div>)}
    </form>)}
  </Dialog>);
}
