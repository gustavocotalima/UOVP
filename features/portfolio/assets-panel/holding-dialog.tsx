"use client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { RATE_CONVENTIONS, RATE_CONVENTION_META, type RateConventionKey } from "../constants";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function HoldingDialog({ controller }: {
  controller: Pick<AssetsPanelController, "holdingForm" | "setHoldingForm" | "pending" | "submitHolding" | "holdingAsset" | "holdingCatalog">;
}) {
  const { holdingForm, setHoldingForm, pending, submitHolding, holdingAsset, holdingCatalog } = controller;
  return (<Dialog privateEditor open={holdingForm !== null && Boolean(holdingAsset)} mobileMode="full" onOpenChange={(open) => !open && setHoldingForm(null)} dismissible={!pending} title={holdingForm?.id ? "Editar aplicação" : "Adicionar aplicação"} className="max-w-3xl" footer={holdingForm && <Button type="submit" form="fixed-income-holding-form" disabled={pending || (!holdingForm.catalogItemId && holdingForm.customTypeName.trim().length < 2)}>{pending ? "Salvando…" : "Salvar aplicação"}</Button>}>
    {holdingForm && holdingAsset && (<form id="fixed-income-holding-form" onSubmit={submitHolding} className="grid gap-4 sm:grid-cols-2">
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
      <div className="space-y-2"><Label htmlFor="holding-invested">Valor investido</Label><Input id="holding-invested" type="number" min="0" step="0.01" value={holdingForm.investedValue ?? ""} onChange={(event) => setHoldingForm({ ...holdingForm, investedValue: event.target.value ? Number(event.target.value) : null, investedValueCurrency: event.target.value === "" ? null : holdingForm.investedValueCurrency ?? "BRL", investmentCostEdited: true })} /></div>
      <div className="space-y-2"><Label htmlFor="holding-invested-currency">Moeda do custo</Label><Input id="holding-invested-currency" value={holdingForm.investedValueCurrency ?? ""} placeholder="BRL" minLength={3} maxLength={8} pattern="[A-Za-z0-9]{3,8}" required={holdingForm.investedValue !== null} disabled={holdingForm.investedValue === null} onChange={(event) => setHoldingForm({ ...holdingForm, investedValueCurrency: event.target.value.toUpperCase() || null, investmentCostEdited: true })} /></div>
      <div className="space-y-2"><Label htmlFor="holding-current">Valor atual</Label><Input id="holding-current" type="number" min="0" step="0.01" value={holdingForm.currentValue} onChange={(event) => setHoldingForm({ ...holdingForm, currentValue: Number(event.target.value) })} required /></div>
      <div className="space-y-2"><Label htmlFor="holding-rate-convention">Formato da taxa</Label><Select id="holding-rate-convention" className="w-full" value={holdingForm.rateConvention ?? ""} onChange={(event) => setHoldingForm({ ...holdingForm, rateConvention: event.target.value ? event.target.value as RateConventionKey : null })}><option value="">Não informado</option>{RATE_CONVENTIONS.map((convention) => <option key={convention} value={convention}>{RATE_CONVENTION_META[convention]}</option>)}</Select></div>
      <div className="space-y-2"><Label htmlFor="holding-benchmark">Indexador detalhado</Label><Input id="holding-benchmark" value={holdingForm.benchmark} onChange={(event) => setHoldingForm({ ...holdingForm, benchmark: event.target.value })} placeholder="Ex: CDI, IPCA, Selic" /></div>
      <div className="space-y-2"><Label htmlFor="holding-rate">Taxa</Label><Input id="holding-rate" type="number" step="0.000001" value={holdingForm.rateValue ?? ""} onChange={(event) => setHoldingForm({ ...holdingForm, rateValue: event.target.value ? Number(event.target.value) : null })} /></div>
      <div className="space-y-2"><Label htmlFor="holding-purchase-date">Data da compra</Label><Input id="holding-purchase-date" type="date" value={holdingForm.purchaseDate} onChange={(event) => setHoldingForm({ ...holdingForm, purchaseDate: event.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="holding-maturity-date">Vencimento</Label><Input id="holding-maturity-date" type="date" value={holdingForm.maturityDate} onChange={(event) => setHoldingForm({ ...holdingForm, maturityDate: event.target.value })} /></div>
    </form>)}
  </Dialog>);
}
