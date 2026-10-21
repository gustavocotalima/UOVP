"use client";
import { PrivateValue } from "@/components/ui/private-value";
import { Fragment } from "react";
import { ChevronDown, ChevronRight, Clock3, FileSpreadsheet, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateOnly } from "@/lib/calendar";
import { formatCurrency, formatMoney, formatPercent } from "@/lib/money";
import { FIXED_INCOME_INDEXATION_META, INSTRUMENT_TYPE_META, INVESTMENT_CLASS_META } from "../constants";
import { currentValue } from "./model";
import { TemporaryQuantityBadge, ProviderQuantity, MoneyWithNative, CostValue, holdingProfitability, reviewMoney, reviewDecimal, reviewDate } from "./presentation";
import { AssetLogo } from "./asset-logo";
import { HoldingHistoryDesktop } from "./holding-history";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function AssetsDesktop({ controller }: {
  controller: Pick<AssetsPanelController, "excludeAccountHolding" | "timeZone" | "valuesHidden" | "setMetadataEditor" | "expandedAssets" | "setDeleteTarget" | "pendingPriceByAsset" | "setPendingPriceByAsset" | "pending" | "filtered" | "searchExpandedAssets" | "holdingTransactions" | "loadHoldingTransactions" | "total" | "edit" | "startHolding" | "toggleExpanded" | "editAccountInvestment" | "savePendingContributionPrice">;
}) {
  const { excludeAccountHolding, timeZone, valuesHidden, setMetadataEditor, expandedAssets, setDeleteTarget, pendingPriceByAsset, setPendingPriceByAsset, pending, filtered, searchExpandedAssets, holdingTransactions, loadHoldingTransactions, total, edit, startHolding, toggleExpanded, editAccountInvestment, savePendingContributionPrice } = controller;
  return (<div className="hidden overflow-x-auto scrollbar-thin lg:block">
    <table className="w-full min-w-[1030px] table-fixed text-left text-sm">
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
          <th className="sticky right-0 z-10 whitespace-nowrap bg-[var(--card)] px-3 py-3 text-right">Ações</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((asset) => {
          const expandable = asset.instrumentType === "FIXED_INCOME" || asset.providerControlled || asset.holdings.length > 1 || Boolean(asset.awaitingSyncContribution);
          const showsApplicationCount = ["FIXED_INCOME", "MUTUAL_FUND"].includes(asset.instrumentType);
          const expanded = expandedAssets.has(asset.id) || searchExpandedAssets.has(asset.id);
          const holdingColumns = {
            invested: asset.holdings.some((holding) => holding.investedValue !== null),
            quantity: ["STOCK", "ETF", "REAL_ESTATE_FUND", "REIT", "CRYPTO"].includes(asset.instrumentType),
            averagePrice: asset.holdings.some((holding) => {
              const movementState = holdingTransactions[holding.id];
              return holding.averagePricePaid !== null
                || (movementState?.averagePricePaid ?? null) !== null
                || (holding.transactionCount > 0 && (!movementState || movementState.loading));
            }),
            profitability: asset.holdings.some((holding) => holdingProfitability(holding) !== null),
            purchaseDate: asset.holdings.some((holding) => holding.purchaseDate !== null),
            maturityDate: asset.holdings.some((holding) => holding.maturityDate !== null),
          };
          const holdingColumnCount = 4 + Object.values(holdingColumns).filter(Boolean).length;
          return (<Fragment key={asset.id}>
            <tr className="border-b last:border-0">
              <td className="overflow-hidden px-3 py-4">
                <div className="flex min-w-0 items-center gap-2">
                  {expandable ? (<button type="button" className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-[var(--muted)]" onClick={() => toggleExpanded(asset.id)} aria-label={`${expanded ? "Recolher" : "Expandir"} ${asset.name}`} aria-expanded={expanded}>
                    {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>) : <span className="size-7 shrink-0" />}
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
                {asset.instrumentType === "ETF" && asset.investmentClass === "STORE_OF_VALUE" && (<span className="mt-0.5 block whitespace-nowrap text-[10px] text-[var(--muted-foreground)]">
                  {asset.marketRegion === "INTERNATIONAL"
                    ? "Internacional"
                    : asset.marketRegion === "BRAZIL"
                      ? "Nacional"
                      : "Revisar mercado"}
                </span>)}
                {asset.instrumentType === "ETF" && asset.fixedIncomeFamilyName && asset.indexation && <span className="mt-0.5 block max-w-28 truncate text-[10px] text-[var(--muted-foreground)]" title={`${asset.fixedIncomeFamilyName} · ${FIXED_INCOME_INDEXATION_META[asset.indexation].label}`}>{asset.fixedIncomeFamilyName} · {FIXED_INCOME_INDEXATION_META[asset.indexation].label}</span>}
              </td>
              <td className="whitespace-nowrap px-3"><MoneyWithNative brl={asset.currentValue} native={asset.nativeCurrentValue} currency={asset.nativeCurrency} nativePrimary={asset.holdings.some((holding) => !!holding.accountBalanceSource)} unavailable={asset.holdings.some((holding) => holding.accountBalanceSource?.valuationUnavailable)} /></td>
              <td className="whitespace-nowrap px-3">{formatPercent(total ? currentValue(asset) / total * 100 : 0)}</td>
              <td className="whitespace-nowrap px-3">
                <span className="grid size-8 place-items-center rounded-full bg-[var(--muted)] font-semibold">{asset.score}</span>
                {asset.needsScore && <span className="mt-1 block text-[10px] text-[var(--primary)]">Revisar nota</span>}
              </td>
              <td className="whitespace-nowrap px-3">{showsApplicationCount ? `${asset.holdings.length} aplic.` : <PrivateValue>{Number(asset.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 10 })}</PrivateValue>}</td>
              <td className="whitespace-nowrap px-3 text-xs text-[var(--muted-foreground)]">
                <span className="block">{reviewDate(asset.priceUpdatedAt ?? asset.updatedAt, timeZone)}</span>
                {asset.awaitingSyncContribution && (<span className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--primary)]" title={valuesHidden ? undefined : asset.instrumentType === "FIXED_INCOME" || asset.awaitingSyncContribution.paidUnitPrice
                  ? `Aporte de ${formatMoney(asset.awaitingSyncContribution.value)} aguardando confirmação do provedor.`
                  : `Aporte de ${reviewDecimal(asset.awaitingSyncContribution.quantity)} unidades aguardando confirmação do provedor. Preço não informado.`}>
                  <Clock3 className="size-3" aria-hidden="true" />
                  Aguardando sync
                </span>)}
              </td>
              <td className="sticky right-0 z-10 bg-[var(--card)] px-3"><div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => edit(asset)} aria-label={`Editar ${asset.ticker}`}><Pencil className="size-4" /> Editar</Button></div></td>
            </tr>
            {expandable && expanded && (<tr className="border-b bg-[color-mix(in_srgb,var(--muted)_42%,transparent)]">
              <td colSpan={8} className="px-5 py-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><strong className="text-sm">Posições do ativo</strong><p className="text-xs text-[var(--muted-foreground)]">O valor é a soma das posições ativas abaixo.</p></div>
                  {asset.instrumentType === "FIXED_INCOME" && <Button size="sm" onClick={() => startHolding(asset)}><Plus className="size-4" /> Adicionar aplicação</Button>}
                </div>
                {asset.awaitingSyncContribution && (<div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--primary)]/35 bg-[var(--primary)]/10 px-4 py-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--primary)]">
                    <Clock3 className="size-4" aria-hidden="true" />
                    Aguardando sync
                  </span>
                  {asset.instrumentType === "FIXED_INCOME" ? (<span className="text-[var(--foreground)]"><PrivateValue>{formatMoney(asset.awaitingSyncContribution.value)}</PrivateValue></span>) : asset.awaitingSyncContribution.paidUnitPrice ? (<span className="text-[var(--foreground)]">
                    <PrivateValue>{reviewDecimal(asset.awaitingSyncContribution.quantity)}</PrivateValue> un. · {asset.awaitingSyncContribution.paidUnitPriceNative && asset.awaitingSyncContribution.nativeCurrency ? <PrivateValue>{formatCurrency(asset.awaitingSyncContribution.paidUnitPriceNative, asset.awaitingSyncContribution.nativeCurrency)}</PrivateValue> : <PrivateValue>{formatMoney(asset.awaitingSyncContribution.paidUnitPrice)}</PrivateValue>} cada · <PrivateValue>{formatMoney(asset.awaitingSyncContribution.value)}</PrivateValue>
                  </span>) : (<div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-[var(--foreground)]"><PrivateValue>{reviewDecimal(asset.awaitingSyncContribution.quantity)}</PrivateValue> un.</span>
                    <Input type="number" min="0.00000001" step="any" value={pendingPriceByAsset[asset.id] ?? ""} onChange={(event) => setPendingPriceByAsset((current) => ({ ...current, [asset.id]: event.target.value }))} aria-label={`Preço unitário pago por ${asset.ticker} em ${asset.awaitingSyncContribution.nativeCurrency ?? "BRL"}`} placeholder={`Preço pago (${asset.awaitingSyncContribution.nativeCurrency ?? "R$"})`} className="h-8 w-32 bg-[var(--card)]" />
                    <Button type="button" size="sm" onClick={() => savePendingContributionPrice(asset.id)} disabled={pending || !(Number(pendingPriceByAsset[asset.id]) > 0)}>
                      Salvar preço
                    </Button>
                  </div>)}
                </div>)}
                {asset.holdings.length ? (<div className="overflow-x-auto rounded-xl border bg-[var(--card)]">
                  <table className="w-full min-w-[920px] text-left text-xs">
                    <thead className="border-b text-[var(--muted-foreground)]"><tr><th className="px-3 py-2">Tipo / produto</th><th className="px-3 py-2">Emissor</th>{holdingColumns.invested && <th className="px-3 py-2">Investido</th>}<th className="px-3 py-2">Atual</th>{holdingColumns.quantity && <th className="px-3 py-2">Quantidade atual</th>}{holdingColumns.averagePrice && <th className="px-3 py-2">Preço médio</th>}{holdingColumns.profitability && <th className="px-3 py-2">Rentabilidade</th>}{holdingColumns.purchaseDate && <th className="px-3 py-2">Compra</th>}{holdingColumns.maturityDate && <th className="px-3 py-2">Vencimento</th>}<th className="px-3 py-2 text-right">Fonte / ações</th></tr></thead>
                    <tbody>{asset.holdings.map((holding) => {
                      const movementState = holdingTransactions[holding.id];
                      const hasMovementAverage = movementState && !movementState.loading && !movementState.error;
                      const displayedAveragePrice = hasMovementAverage ? movementState.averagePricePaid : holding.averagePricePaid;
                      const displayedAveragePriceCurrency = hasMovementAverage ? movementState.averagePriceCurrency : holding.averagePriceCurrency;
                      const displayedAveragePriceCoverage = hasMovementAverage ? movementState.averagePriceCoverage : holding.averagePriceCoverage;
                      return (<Fragment key={holding.id}>
                        <tr className="border-b">
                          <td className="px-3 py-3"><strong className="block max-w-52 truncate" title={holding.typeName}>{holding.typeName}</strong><span className="block max-w-52 truncate text-[var(--muted-foreground)]" title={holding.productName}>{holding.productName}</span></td>
                          <td className="px-3 py-3">{holding.issuer}</td>
                          {holdingColumns.invested && <td className="whitespace-nowrap px-3 py-3"><CostValue value={holding.investedValue} currency={holding.investedValueCurrency} /></td>}
                          <td className="whitespace-nowrap px-3 py-3">
                            <MoneyWithNative brl={holding.currentValue} native={holding.nativeCurrentValue} currency={holding.currency} strong nativePrimary={!!holding.accountBalanceSource} unavailable={holding.accountBalanceSource?.valuationUnavailable} />
                            {holding.accountBalanceSource && holding.currency !== "BRL" && holding.fxRateToBrl && <span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">1 {holding.currency} = {formatMoney(holding.fxRateToBrl)} · {holding.accountBalanceSource.fxSource ?? "Não informado"}{holding.fxUpdatedAt ? ` · ${formatDateOnly(holding.fxUpdatedAt)}` : ""}</span>}
                            {holding.pricingSource === "YAHOO" && holding.fxRateToBrl && (<span className="mt-1 block text-[10px] font-normal text-[var(--muted-foreground)]">
                              <PrivateValue>{reviewMoney(holding.unitPrice, holding.currency)}</PrivateValue> · câmbio {Number(holding.fxRateToBrl).toLocaleString("pt-BR", { maximumFractionDigits: 6 })}
                            </span>)}
                          </td>
                          {holdingColumns.quantity && <td className="whitespace-nowrap px-3 py-3"><PrivateValue>{Number(holding.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 10 })}</PrivateValue><ProviderQuantity metadata={holding.connectedMetadata} /></td>}
                          {holdingColumns.averagePrice && (<td className="whitespace-nowrap px-3 py-3">
                            {displayedAveragePrice === null
                              ? movementState?.loading ? "Calculando…" : "—"
                              : (<>
                                <CostValue value={displayedAveragePrice} currency={displayedAveragePriceCurrency} />
                                {displayedAveragePriceCoverage < 0.999 && (<span className="mt-1 block text-[10px] text-[var(--primary)]" title={`O histórico de compras disponível cobre ${(displayedAveragePriceCoverage * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da posição atual.`}>
                                  Histórico parcial
                                </span>)}
                              </>)}
                          </td>)}
                          {holdingColumns.profitability && <td className="whitespace-nowrap px-3 py-3">{holdingProfitability(holding) ?? "—"}</td>}
                          {holdingColumns.purchaseDate && <td className="whitespace-nowrap px-3 py-3">{holding.purchaseDate ? formatDateOnly(holding.purchaseDate) : "—"}</td>}
                          {holdingColumns.maturityDate && <td className="whitespace-nowrap px-3 py-3">{holding.maturityDate ? formatDateOnly(holding.maturityDate) : "—"}</td>}
                          <td className="px-3 py-3">
                            {holding.positionSource !== "MANUAL"
                              ? <div className="flex flex-col items-end gap-1 text-right"><span className="rounded-full bg-[var(--primary)]/12 px-2 py-1 text-[10px] font-semibold text-[var(--primary)]">{holding.accountBalanceSource ? `Saldo da conta · ${holding.accountBalanceSource.name}` : holding.positionSource === "BINANCE" ? "Binance" : "Pluggy"}</span>{holding.institution && <span className="block text-[10px] font-medium">{holding.institution}</span>}<span className="block text-[10px] text-[var(--muted-foreground)]">{holding.providerStatus ?? "Sincronizado"}</span>
                                {holding.accountBalanceSource && <><span className="text-[10px] text-[var(--muted-foreground)]">Mesmo valor de Saldo em conta</span><Button variant="ghost" size="sm" onClick={() => editAccountInvestment(asset, holding)}><Pencil className="size-3.5" /> Classificação</Button><Button variant="ghost" size="sm" onClick={() => excludeAccountHolding(holding)}>Remover da Carteira</Button></>}
                                <TemporaryQuantityBadge metadata={holding.connectedMetadata} />
                                {holding.connectedMetadata?.overrideFields.some((field) => field !== "QUANTITY") ? <span className="text-[10px] font-semibold text-[var(--primary)]">Editado manualmente</span> : null}
                                {holding.connectedMetadata && (<Button variant="ghost" size="sm" onClick={() => setMetadataEditor(holding.connectedMetadata)}>
                                  <Pencil className="size-3.5" /> Informações
                                </Button>)}
                              </div>
                              : <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => startHolding(asset, holding)}><Pencil className="size-3.5" /> Editar</Button><Button variant="ghost" size="sm" className="text-[var(--danger)]" onClick={() => setDeleteTarget({ kind: "holding", id: holding.id, label: holding.productName })}><Trash2 className="size-3.5" /> Excluir</Button></div>}
                          </td>
                        </tr>
                        <HoldingHistoryDesktop holding={holding} movementState={movementState} loadHoldingTransactions={loadHoldingTransactions} holdingColumnCount={holdingColumnCount} />
                      </Fragment>);
                    })}</tbody>
                  </table>
                </div>) : <div className="rounded-xl border border-dashed p-6 text-center text-sm text-[var(--muted-foreground)]">Nenhuma aplicação cadastrada. O grupo continua elegível para receber aportes.</div>}
              </td>
            </tr>)}
          </Fragment>);
        })}
      </tbody>
    </table>
    {!filtered.length && <div className="grid min-h-56 place-items-center text-center text-sm text-[var(--muted-foreground)]"><div><FileSpreadsheet className="mx-auto mb-3 size-8 opacity-45" /><p>Nenhum ativo encontrado.</p></div></div>}
  </div>);
}
