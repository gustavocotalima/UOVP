"use client";

import { useMemo, useState, useTransition } from "react";
import { Calculator, CheckCircle2, Clock3, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DonutChart } from "@/components/charts/donut-chart";
import { formatMoney, formatPercent } from "@/lib/money";
import { executeContributionAction, simulateContributionAction } from "./actions";
import { INVESTMENT_CLASSES, INVESTMENT_CLASS_META, RATE_CONVENTIONS, RATE_CONVENTION_META, type RateConventionKey } from "./constants";
import type { AssetDto, PortfolioDto, SimulationDto } from "./types";

type NewFixedIncomeHolding = {
  catalogItemId: number | null;
  customTypeName: string;
  issuer: string;
  productName: string;
  rateConvention: RateConventionKey | null;
  benchmark: string;
  rateValue: string;
  purchaseDate: string;
  maturityDate: string;
};

type ContributionModalState = {
  suggestionId: string;
  quantity: string;
  destination: "EXISTING" | "NEW";
  holdingId: string;
  newHolding: NewFixedIncomeHolding;
};

const emptyNewHolding: NewFixedIncomeHolding = {
  catalogItemId: null,
  customTypeName: "",
  issuer: "",
  productName: "",
  rateConvention: null,
  benchmark: "",
  rateValue: "",
  purchaseDate: "",
  maturityDate: "",
};

function formatQuantity(value: string | number, maximumFractionDigits = 8) {
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits });
}

export function ContributionPanel({ assets, catalog }: { assets: AssetDto[]; catalog: PortfolioDto["catalog"] }) {
  const [value, setValue] = useState(1000);
  const [simulation, setSimulation] = useState<SimulationDto>();
  const [contributionModal, setContributionModal] = useState<ContributionModalState>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const chartData = useMemo(() => simulation ? INVESTMENT_CLASSES.map((investmentClass) => ({
    name: INVESTMENT_CLASS_META[investmentClass].label,
    color: INVESTMENT_CLASS_META[investmentClass].color,
    value: simulation.suggestions.filter((item) => item.investmentClass === investmentClass).reduce((sum, item) => sum + Number(item.value), 0),
  })).filter((item) => item.value > 0) : [], [simulation]);
  const selectedSuggestion = simulation?.suggestions.find((item) => item.id === contributionModal?.suggestionId);
  const selectedAsset = assets.find((asset) => asset.id === selectedSuggestion?.assetId);
  const selectedQuantity = Number(contributionModal?.quantity ?? 0);
  const selectedEquivalent = selectedQuantity * Number(selectedAsset?.unitPrice ?? 0);
  const isFixedIncome = selectedAsset?.instrumentType === "FIXED_INCOME";
  const selectedHolding = selectedAsset?.holdings.find((holding) => holding.id === contributionModal?.holdingId);
  const pluggyControlled = Boolean(
    selectedAsset?.pluggyControlled
    && (!isFixedIncome || (contributionModal?.destination === "EXISTING" && selectedHolding?.positionSource === "PLUGGY")),
  );
  const selectedCatalog = selectedAsset?.fixedIncomeFamilyCode
    ? catalog.filter((item) => item.familyCode === selectedAsset.fixedIncomeFamilyCode)
    : [];

  function openContribution(suggestionId: string, quantity: string) {
    const suggestion = simulation?.suggestions.find((item) => item.id === suggestionId);
    const asset = assets.find((item) => item.id === suggestion?.assetId);
    const firstHolding = asset?.holdings[0];
    setContributionModal({
      suggestionId,
      quantity,
      destination: firstHolding ? "EXISTING" : "NEW",
      holdingId: firstHolding?.id ?? "",
      newHolding: { ...emptyNewHolding },
    });
  }

  function calculate() {
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await simulateContributionAction(value);
        setSimulation(result);
        if (!result.suggestions.length) setMessage("Nenhum ativo elegível. Confira metas, notas e preços.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível calcular.");
      }
    });
  }

  function executeContribution() {
    if (!simulation || !contributionModal || !selectedSuggestion || !Number.isFinite(selectedQuantity) || selectedQuantity <= 0) return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        const destination = isFixedIncome
          ? contributionModal.destination === "EXISTING"
            ? { holdingId: contributionModal.holdingId }
            : {
                newHolding: {
                  catalogItemId: contributionModal.newHolding.catalogItemId,
                  customTypeName: contributionModal.newHolding.catalogItemId ? null : contributionModal.newHolding.customTypeName,
                  issuer: contributionModal.newHolding.issuer,
                  productName: contributionModal.newHolding.productName,
                  investedValue: 0,
                  currentValue: 0,
                  rateConvention: contributionModal.newHolding.rateConvention,
                  benchmark: contributionModal.newHolding.benchmark || null,
                  rateValue: contributionModal.newHolding.rateValue ? Number(contributionModal.newHolding.rateValue) : null,
                  purchaseDate: contributionModal.newHolding.purchaseDate || null,
                  maturityDate: contributionModal.newHolding.maturityDate || null,
                },
              }
          : undefined;
        const result = await executeContributionAction(simulation.id, selectedSuggestion.id, selectedQuantity, destination);
        setSimulation({
          ...simulation,
          suggestions: simulation.suggestions.map((item) => item.id === selectedSuggestion.id
            ? {
                ...item,
                quantity: selectedQuantity.toString(),
                value: (isFixedIncome ? selectedQuantity : selectedEquivalent).toString(),
                executed: !result.awaitingSync,
                executionStatus: result.awaitingSync ? "AWAITING_SYNC" : "EXECUTED",
              }
            : item),
        });
        setMessage(result.awaitingSync
          ? "Aporte planejado. Faça o investimento na instituição e sincronize a Pluggy para confirmar."
          : "Aporte registrado.");
        setContributionModal(undefined);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível registrar o aporte.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-end">
          <div className="w-full max-w-sm space-y-2"><Label htmlFor="contribution-value">Valor do aporte</Label><Input id="contribution-value" type="number" min="0.01" step="0.01" value={value} onChange={(event) => setValue(Number(event.target.value))} /></div>
          <Button size="lg" onClick={calculate} disabled={pending || value <= 0 || !assets.length}><Calculator className="size-4" /> {pending ? "Calculando…" : "Calcular"}</Button>
          {!assets.length && <p className="text-sm text-[var(--muted-foreground)]">Adicione ativos antes de simular.</p>}
        </CardContent>
      </Card>
      {message && <p role="status" className="rounded-xl border bg-[var(--card)] p-4 text-sm">{message}</p>}
      {simulation && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-[var(--primary)]">Distribuição do investimento</CardTitle>
              <p className="text-xs font-semibold text-[var(--muted-foreground)]">Mudar visualização</p>
            </CardHeader>
            <CardContent>
              {chartData.length ? <div className="mx-auto max-w-sm"><DonutChart data={chartData} centerLabel="Patrimônio total" /></div> : <div className="grid h-64 place-items-center text-sm text-[var(--muted-foreground)]">Sem sugestões.</div>}
              <div className="mx-auto mt-2 grid max-w-4xl gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {INVESTMENT_CLASSES.map((investmentClass) => {
                  const amount = chartData.find((item) => item.name === INVESTMENT_CLASS_META[investmentClass].label)?.value ?? 0;
                  const total = chartData.reduce((sum, item) => sum + item.value, 0);
                  return <div key={investmentClass} className="flex items-center gap-2 text-xs"><span className="size-3 rounded-full" style={{ background: INVESTMENT_CLASS_META[investmentClass].color }} /><span>{INVESTMENT_CLASS_META[investmentClass].label} <strong className="text-[var(--primary)]">({formatPercent(total ? amount / total * 100 : 0)})</strong></span></div>;
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-xl">Sugestões de investimento</CardTitle></CardHeader>
            <CardContent>
              <div className="max-h-[540px] overflow-auto scrollbar-thin">
                <table aria-label="Sugestões de investimento" className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-[var(--primary)] text-[var(--primary-foreground)]">
                    <tr>
                      <th className="px-4 py-4 text-center">Tipo</th>
                      <th className="px-4 py-4">Ticker</th>
                      <th className="px-4 py-4">Atual ($)</th>
                      <th className="px-4 py-4">Preço atual ($)</th>
                      <th className="px-4 py-4 text-center">Nota</th>
                      <th className="px-4 py-4 text-center">Total após<br />aporte (%)</th>
                      <th className="px-4 py-4 text-center">Sugest. de<br />aporte ($)</th>
                      <th className="px-4 py-4 text-center">Sugest. de<br />aporte (un)</th>
                      <th className="px-4 py-4 text-center">Aportar!</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulation.suggestions.map((item) => {
                      const asset = assets.find((candidate) => candidate.id === item.assetId);
                      const meta = INVESTMENT_CLASS_META[item.investmentClass];
                      return (
                        <tr key={item.id} className="border-b last:border-0">
                          <td className="px-4 py-4 text-center"><span className="inline-flex rounded-full px-4 py-2 font-semibold text-black" style={{ background: meta.color }}>{meta.label}</span></td>
                          <td className="px-4 py-4 font-semibold">{item.ticker}</td>
                          <td className="px-4 py-4 font-semibold text-[var(--success)]">{formatMoney(asset?.currentValue ?? 0)}</td>
                          <td className="px-4 py-4 font-semibold text-[var(--success)]">{formatMoney(asset?.unitPrice ?? 0)}</td>
                          <td className="px-4 py-4 text-center font-semibold">{asset?.score ?? 0}</td>
                          <td className="px-4 py-4 text-center font-semibold">{formatPercent(item.totalAfterSuggestionPercentage)}</td>
                          <td className="px-4 py-4 text-center font-semibold text-[var(--success)]">{formatMoney(item.value)}</td>
                          <td className="px-4 py-4 text-center font-semibold">{formatQuantity(item.quantity)}</td>
                          <td className="px-4 py-4 text-center">
                            {item.executed
                              ? <span className="inline-flex items-center gap-1 text-xs text-[var(--success)]"><CheckCircle2 className="size-4" /> Registrado</span>
                              : item.executionStatus === "AWAITING_SYNC"
                                ? <span className="inline-flex items-center gap-1 text-xs text-[var(--primary)]"><Clock3 className="size-4" /> Aguardando sync</span>
                                : <Button onClick={() => openContribution(item.id, item.quantity)} disabled={pending}><DollarSign className="size-5" /> Aportar</Button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog
        open={Boolean(contributionModal && selectedSuggestion && selectedAsset)}
        onOpenChange={(open) => !open && setContributionModal(undefined)}
        title="Novo aporte"
        titleAlign="center"
        className="max-w-xl border-white/10 bg-[#555] text-white"
      >
        {selectedSuggestion && selectedAsset && contributionModal && (
          <div className="space-y-6 px-4 pb-3 sm:px-10">
            <div>
              <p className="font-semibold text-[var(--primary)]">Ativo</p>
              <p className="mt-2 text-xl font-bold">{selectedSuggestion.ticker}</p>
            </div>
            <div>
              <p className="font-semibold text-[var(--primary)]">{isFixedIncome ? "Valor atual do grupo:" : "Unidades em carteira:"}</p>
              <p className="mt-2 text-xl font-bold">{isFixedIncome ? formatMoney(selectedAsset.currentValue) : formatQuantity(selectedAsset.quantity)}</p>
            </div>
            <div className="space-y-3">
              <Label htmlFor="contribution-quantity" className="text-xs font-semibold text-[var(--primary)]">{isFixedIncome ? "Valor a ser aportado:" : "Quantidade a ser aportada:"}</Label>
              <Input
                id="contribution-quantity"
                type="number"
                min={isFixedIncome ? "0.01" : selectedAsset.fractional ? "0.00000001" : "1"}
                step={isFixedIncome ? "0.01" : selectedAsset.fractional ? "any" : "1"}
                value={contributionModal.quantity}
                onChange={(event) => setContributionModal({ ...contributionModal, quantity: event.target.value })}
                className="border-white/60 bg-transparent text-white"
              />
              <p className="text-xs font-semibold">{isFixedIncome ? `Valor sugerido: ${formatMoney(selectedSuggestion.value)}` : `Quantidade sugerida: ${formatQuantity(selectedSuggestion.quantity)}, equivale a: ${formatMoney(selectedEquivalent)}`}</p>
            </div>
            {isFixedIncome && (
              <div className="space-y-4 rounded-xl border border-white/25 p-4">
                <div className="space-y-2">
                  <Label htmlFor="contribution-destination" className="text-xs font-semibold text-[var(--primary)]">Destino do aporte</Label>
                  <Select id="contribution-destination" className="w-full bg-[#555] text-white" value={contributionModal.destination} onChange={(event) => setContributionModal({ ...contributionModal, destination: event.target.value as "EXISTING" | "NEW" })}>
                    {selectedAsset.holdings.length > 0 && <option value="EXISTING">Aplicação existente</option>}
                    <option value="NEW">Nova aplicação</option>
                  </Select>
                </div>
                {contributionModal.destination === "EXISTING" ? (
                  <div className="space-y-2">
                    <Label htmlFor="contribution-holding" className="text-xs font-semibold text-[var(--primary)]">Aplicação</Label>
                    <Select id="contribution-holding" className="w-full bg-[#555] text-white" value={contributionModal.holdingId} onChange={(event) => setContributionModal({ ...contributionModal, holdingId: event.target.value })} required>
                      {selectedAsset.holdings.map((holding) => <option key={holding.id} value={holding.id}>{holding.productName} · {holding.issuer}</option>)}
                    </Select>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="contribution-catalog" className="text-xs font-semibold text-[var(--primary)]">Tipo do catálogo</Label>
                      <Select id="contribution-catalog" className="w-full bg-[#555] text-white" value={contributionModal.newHolding.catalogItemId ?? ""} onChange={(event) => setContributionModal({ ...contributionModal, newHolding: { ...contributionModal.newHolding, catalogItemId: event.target.value ? Number(event.target.value) : null } })}>
                        <option value="">Outro tipo personalizado</option>
                        {selectedCatalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </Select>
                    </div>
                    {!contributionModal.newHolding.catalogItemId && <div className="space-y-2 sm:col-span-2"><Label htmlFor="contribution-custom-type">Tipo personalizado</Label><Input id="contribution-custom-type" className="border-white/60 bg-transparent text-white" value={contributionModal.newHolding.customTypeName} onChange={(event) => setContributionModal({ ...contributionModal, newHolding: { ...contributionModal.newHolding, customTypeName: event.target.value } })} required /></div>}
                    <div className="space-y-2"><Label htmlFor="contribution-issuer">Emissor</Label><Input id="contribution-issuer" className="border-white/60 bg-transparent text-white" value={contributionModal.newHolding.issuer} onChange={(event) => setContributionModal({ ...contributionModal, newHolding: { ...contributionModal.newHolding, issuer: event.target.value } })} required /></div>
                    <div className="space-y-2"><Label htmlFor="contribution-product">Produto</Label><Input id="contribution-product" className="border-white/60 bg-transparent text-white" value={contributionModal.newHolding.productName} onChange={(event) => setContributionModal({ ...contributionModal, newHolding: { ...contributionModal.newHolding, productName: event.target.value } })} required /></div>
                    <div className="space-y-2"><Label htmlFor="contribution-rate-convention">Formato da taxa</Label><Select id="contribution-rate-convention" className="w-full bg-[#555] text-white" value={contributionModal.newHolding.rateConvention ?? ""} onChange={(event) => setContributionModal({ ...contributionModal, newHolding: { ...contributionModal.newHolding, rateConvention: event.target.value ? event.target.value as RateConventionKey : null } })}><option value="">Não informado</option>{RATE_CONVENTIONS.map((item) => <option key={item} value={item}>{RATE_CONVENTION_META[item]}</option>)}</Select></div>
                    <div className="space-y-2"><Label htmlFor="contribution-benchmark">Indexador</Label><Input id="contribution-benchmark" className="border-white/60 bg-transparent text-white" value={contributionModal.newHolding.benchmark} onChange={(event) => setContributionModal({ ...contributionModal, newHolding: { ...contributionModal.newHolding, benchmark: event.target.value } })} placeholder="CDI, IPCA, Selic" /></div>
                    <div className="space-y-2"><Label htmlFor="contribution-rate">Taxa</Label><Input id="contribution-rate" type="number" step="0.000001" className="border-white/60 bg-transparent text-white" value={contributionModal.newHolding.rateValue} onChange={(event) => setContributionModal({ ...contributionModal, newHolding: { ...contributionModal.newHolding, rateValue: event.target.value } })} /></div>
                    <div className="space-y-2"><Label htmlFor="contribution-purchase">Compra</Label><Input id="contribution-purchase" type="date" className="border-white/60 bg-transparent text-white" value={contributionModal.newHolding.purchaseDate} onChange={(event) => setContributionModal({ ...contributionModal, newHolding: { ...contributionModal.newHolding, purchaseDate: event.target.value } })} /></div>
                    <div className="space-y-2"><Label htmlFor="contribution-maturity">Vencimento</Label><Input id="contribution-maturity" type="date" className="border-white/60 bg-transparent text-white" value={contributionModal.newHolding.maturityDate} onChange={(event) => setContributionModal({ ...contributionModal, newHolding: { ...contributionModal.newHolding, maturityDate: event.target.value } })} /></div>
                  </div>
                )}
              </div>
            )}
            {pluggyControlled && (
              <div className="rounded-xl border border-[var(--primary)]/50 bg-[var(--primary)]/10 p-4 text-sm">
                Esta posição é controlada pela Pluggy. O aporte ficará aguardando e só alterará a carteira depois que a instituição informar a compra.
              </div>
            )}
            <div className="flex justify-center pt-5">
              <Button className="min-w-40" onClick={executeContribution} disabled={pending || !Number.isFinite(selectedQuantity) || selectedQuantity <= 0 || Boolean(isFixedIncome && contributionModal.destination === "EXISTING" && !contributionModal.holdingId) || Boolean(isFixedIncome && contributionModal.destination === "NEW" && ((!contributionModal.newHolding.catalogItemId && contributionModal.newHolding.customTypeName.trim().length < 2) || contributionModal.newHolding.issuer.trim().length < 2 || contributionModal.newHolding.productName.trim().length < 2))}>
                {pending ? "Salvando…" : pluggyControlled ? "Planejar aporte" : "Aportar"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
