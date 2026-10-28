"use client";
import { PrivateValue } from "@/components/ui/private-value";
import { ChevronDown, ChevronRight, Clock3, FileSpreadsheet, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PendingContributions } from "./pending-contributions";
import { formatDateOnly } from "@/lib/calendar";
import { formatMoney, formatPercent } from "@/lib/money";
import { INSTRUMENT_TYPE_META, INVESTMENT_CLASS_META } from "../constants";
import { currentValue } from "./model";
import { TemporaryQuantityBadge, ProviderQuantity, MoneyWithNative, CostValue, holdingProfitability, pluggyInvestmentSourceLabel, reviewDate } from "./presentation";
import { AssetLogo } from "./asset-logo";
import { HoldingHistoryMobile } from "./holding-history";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function AssetsMobile({ controller }: {
  controller: Pick<AssetsPanelController, "excludeAccountHolding" | "timeZone" | "setMetadataEditor" | "expandedAssets" | "setDeleteTarget" | "pendingPriceByAsset" | "setPendingPriceByAsset" | "pending" | "filtered" | "searchExpandedAssets" | "holdingTransactions" | "loadHoldingTransactions" | "total" | "edit" | "startHolding" | "toggleExpanded" | "editAccountInvestment" | "savePendingContributionPrice">;
}) {
  const { excludeAccountHolding, timeZone, setMetadataEditor, expandedAssets, setDeleteTarget, pendingPriceByAsset, setPendingPriceByAsset, pending, filtered, searchExpandedAssets, holdingTransactions, loadHoldingTransactions, total, edit, startHolding, toggleExpanded, editAccountInvestment, savePendingContributionPrice } = controller;
  return (<div className="space-y-3 lg:hidden">
    {filtered.map((asset) => {
      const expandable = asset.instrumentType === "FIXED_INCOME" || asset.providerControlled || asset.holdings.length > 1 || Boolean(asset.awaitingSyncContribution);
      const showsApplicationCount = ["FIXED_INCOME", "MUTUAL_FUND"].includes(asset.instrumentType);
      const expanded = expandedAssets.has(asset.id) || searchExpandedAssets.has(asset.id);
      return (<article key={asset.id} data-testid="mobile-asset-card" className="overflow-hidden rounded-2xl border bg-[var(--card)]">
        <div className="p-4">
          <div className="flex min-w-0 items-start gap-3">
            {expandable ? (<button type="button" className="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-[var(--muted)]" onClick={() => toggleExpanded(asset.id)} aria-label={`${expanded ? "Recolher" : "Expandir"} ${asset.name}`} aria-expanded={expanded}>
              {expanded ? <ChevronDown className="size-5" /> : <ChevronRight className="size-5" />}
            </button>) : <span className="w-1 shrink-0" />}
            <AssetLogo asset={asset} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <strong className="block truncate text-base">{asset.ticker}</strong>
                  <span className="block truncate text-xs text-[var(--muted-foreground)]">{asset.name}</span>
                </span>
                <Button variant="ghost" size="icon" onClick={() => edit(asset)} aria-label={`Editar ${asset.ticker}`}><Pencil className="size-4" /></Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full px-2 py-1 text-[11px]" style={{ background: `${INSTRUMENT_TYPE_META[asset.instrumentType].color}20`, color: INSTRUMENT_TYPE_META[asset.instrumentType].color }}>{INSTRUMENT_TYPE_META[asset.instrumentType].label}</span>
                <span className="text-[11px] text-[var(--muted-foreground)]">{INVESTMENT_CLASS_META[asset.investmentClass].shortLabel}</span>
                {asset.instrumentType === "ETF" && asset.investmentClass === "STORE_OF_VALUE" && (<span className="text-[11px] text-[var(--muted-foreground)]">
                  {asset.marketRegion === "INTERNATIONAL"
                    ? "Internacional"
                    : asset.marketRegion === "BRAZIL"
                      ? "Nacional"
                      : "Revisar mercado"}
                </span>)}
                {asset.awaitingSyncContribution && <span className="inline-flex items-center gap-1 text-[11px] text-[var(--primary)]"><Clock3 className="size-3" /> Aguardando sync</span>}
              </div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 text-sm">
            <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Valor atual</dt><dd className="mt-1"><MoneyWithNative brl={asset.currentValue} native={asset.nativeCurrentValue} currency={asset.nativeCurrency} strong nativePrimary={asset.holdings.some((holding) => !!holding.accountBalanceSource)} unavailable={asset.holdings.some((holding) => holding.accountBalanceSource?.valuationUnavailable)} /></dd></div>
            <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">% da carteira</dt><dd className="mt-1 font-semibold">{formatPercent(total ? currentValue(asset) / total * 100 : 0)}</dd></div>
            <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Nota</dt><dd className="mt-1 flex items-center gap-2 font-semibold">{asset.score}{asset.needsScore && <span className="text-[10px] font-normal text-[var(--primary)]">Revisar</span>}</dd></div>
            <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">{showsApplicationCount ? "Aplicações" : "Quantidade"}</dt><dd className="mt-1 font-semibold">{showsApplicationCount ? asset.holdings.length : <PrivateValue>{Number(asset.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 10 })}</PrivateValue>}</dd></div>
            <div className="col-span-2"><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Atualizado</dt><dd className="mt-1 text-xs">{reviewDate(asset.priceUpdatedAt ?? asset.updatedAt, timeZone)}</dd></div>
          </dl>
        </div>

        {expandable && expanded && (<div className="space-y-3 border-t bg-[var(--muted)]/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div><strong className="text-sm">Posições do ativo</strong><p className="text-[11px] text-[var(--muted-foreground)]">Soma das posições ativas.</p></div>
            {asset.instrumentType === "FIXED_INCOME" && <Button size="sm" onClick={() => startHolding(asset)}><Plus className="size-4" /> Aplicação</Button>}
          </div>

          <PendingContributions asset={asset} prices={pendingPriceByAsset} pending={pending} onPriceChange={(id, value) => setPendingPriceByAsset((current) => ({ ...current, [id]: value }))} onSave={savePendingContributionPrice} />

          {asset.holdings.map((holding) => {
            const movementState = holdingTransactions[holding.id];
            const hasMovementAverage = movementState && !movementState.loading && !movementState.error;
            const displayedAveragePrice = hasMovementAverage ? movementState.averagePricePaid : holding.averagePricePaid;
            const displayedAveragePriceCurrency = hasMovementAverage ? movementState.averagePriceCurrency : holding.averagePriceCurrency;
            const displayedAveragePriceCoverage = hasMovementAverage ? movementState.averagePriceCoverage : holding.averagePriceCoverage;
            return (<section key={holding.id} className="rounded-xl border bg-[var(--card)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><strong className="block truncate text-sm">{holding.typeName}</strong><span className="block truncate text-xs text-[var(--muted-foreground)]">{holding.productName}</span></div>
                {holding.positionSource !== "MANUAL"
                  ? <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="max-w-48 truncate rounded-full bg-[var(--primary)]/12 px-2 py-1 text-[10px] font-semibold text-[var(--primary)]" title={holding.accountBalanceSource ? `Saldo da conta · ${holding.accountBalanceSource.name}` : undefined}>{holding.accountBalanceSource ? `Saldo da conta · ${holding.accountBalanceSource.name}` : holding.positionSource === "BINANCE" ? "Binance" : pluggyInvestmentSourceLabel(holding.providerInvestmentSource)}</span>
                    {holding.accountBalanceSource && <><Button variant="ghost" size="sm" onClick={() => editAccountInvestment(asset, holding)}><Pencil className="size-3.5" /> Classificação</Button><Button variant="ghost" size="sm" onClick={() => excludeAccountHolding(holding)}>Remover da Carteira</Button></>}
                    <TemporaryQuantityBadge metadata={holding.connectedMetadata} />
                    {holding.connectedMetadata?.overrideFields.some((field) => field !== "QUANTITY") ? <span className="text-[10px] font-semibold text-[var(--primary)]">Editado manualmente</span> : null}
                    {holding.connectedMetadata && (<Button variant="ghost" size="sm" onClick={() => setMetadataEditor(holding.connectedMetadata)}>
                      <Pencil className="size-3.5" /> Informações
                    </Button>)}
                  </div>
                  : <div className="flex"><Button variant="ghost" size="icon" onClick={() => startHolding(asset, holding)} aria-label={`Editar ${holding.productName}`}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" className="text-[var(--danger)]" onClick={() => setDeleteTarget({ kind: "holding", id: holding.id, label: holding.productName })} aria-label={`Excluir ${holding.productName}`}><Trash2 className="size-4" /></Button></div>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
                <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Emissor</dt><dd className="mt-1">{holding.issuer || "—"}</dd></div>
                {holding.institution && <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Instituição</dt><dd className="mt-1">{holding.institution}</dd></div>}
                <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Atual</dt><dd className="mt-1"><MoneyWithNative brl={holding.currentValue} native={holding.nativeCurrentValue} currency={holding.currency} strong nativePrimary={!!holding.accountBalanceSource} unavailable={holding.accountBalanceSource?.valuationUnavailable} /></dd></div>
                {holding.investedValue !== null && <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Investido</dt><dd className="mt-1"><CostValue value={holding.investedValue} currency={holding.investedValueCurrency} /></dd></div>}
                {["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT", "CRYPTO"].includes(asset.instrumentType) && <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Quantidade atual</dt><dd className="mt-1"><PrivateValue>{Number(holding.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 10 })}</PrivateValue><ProviderQuantity metadata={holding.connectedMetadata} /></dd></div>}
                {displayedAveragePrice !== null && <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Preço médio</dt><dd className="mt-1"><CostValue value={displayedAveragePrice} currency={displayedAveragePriceCurrency} />{displayedAveragePriceCoverage < 0.999 && <span className="block text-[9px] text-[var(--primary)]">Histórico parcial</span>}</dd></div>}
                {holdingProfitability(holding) && <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Rentabilidade</dt><dd className="mt-1">{holdingProfitability(holding)}</dd></div>}
                {holding.purchaseDate && <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Compra</dt><dd className="mt-1">{formatDateOnly(holding.purchaseDate)}</dd></div>}
                {holding.maturityDate && <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Vencimento</dt><dd className="mt-1">{formatDateOnly(holding.maturityDate)}</dd></div>}
                {holding.positionSource !== "MANUAL" && <div><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">Status</dt><dd className="mt-1">{holding.providerStatus ?? "Sincronizado"}</dd></div>}
              </dl>
              {holding.accountBalanceSource && <p className="mt-3 text-xs text-[var(--muted-foreground)]">Mesmo dinheiro incluído em Saldo em conta. Valor e moeda são controlados pela conta; nenhuma movimentação de investimento é criada.</p>}
              {holding.accountBalanceSource && holding.currency !== "BRL" && holding.fxRateToBrl && <p className="mt-2 text-xs text-[var(--muted-foreground)]">Câmbio corrente: 1 {holding.currency} = {formatMoney(holding.fxRateToBrl)} · {holding.accountBalanceSource.fxSource ?? "Não informado"}{holding.fxUpdatedAt ? ` · ${formatDateOnly(holding.fxUpdatedAt)}` : ""}</p>}

              {holding.providerInvestmentSource && holding.providerInvestmentSource !== "INVESTMENTS_API" && (<p className="mt-3 rounded-lg border border-dashed p-3 text-xs text-[var(--muted-foreground)]">
                A instituição disponibiliza somente o saldo atual desta posição, sem movimentações individuais.
              </p>)}

              <HoldingHistoryMobile holding={holding} movementState={movementState} loadHoldingTransactions={loadHoldingTransactions} />
            </section>);
          })}
          {!asset.holdings.length && <div className="rounded-xl border border-dashed p-5 text-center text-sm text-[var(--muted-foreground)]">Nenhuma aplicação cadastrada.</div>}
        </div>)}
      </article>);
    })}
    {!filtered.length && <div className="grid min-h-56 place-items-center text-center text-sm text-[var(--muted-foreground)]"><div><FileSpreadsheet className="mx-auto mb-3 size-8 opacity-45" /><p>Nenhum ativo encontrado.</p></div></div>}
  </div>);
}
