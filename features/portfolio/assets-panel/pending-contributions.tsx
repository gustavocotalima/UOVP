"use client";

import { Clock3 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PrivateValue } from "@/components/ui/private-value";
import { formatCurrency, formatMoney } from "@/lib/money";
import type { AssetDto } from "../types";
import { reviewAwaitingContributionAction } from "../actions";

function PendingContributionReview({ asset, pendingId }: { asset: AssetDto; pendingId: string }) {
  const router = useRouter();
  const [holdingId, setHoldingId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function review(decision: "PROVIDER" | "PROJECT") {
    startTransition(async () => {
      try {
        await reviewAwaitingContributionAction({ pendingId, decision, holdingId, ...(decision === "PROJECT" ? { expectedQuantity: Number(quantity) } : {}) });
        router.refresh();
      } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível revisar o aporte."); }
    });
  }
  return <div className="space-y-2" data-private-editor>
    <label className="block">Posição / instituição
      <select className="mt-1 w-full rounded-lg border bg-[var(--card)] p-2" value={holdingId} onChange={(event) => setHoldingId(event.target.value)}>
        <option value="">Selecione a posição</option>
        {asset.holdings.filter((h) => h.positionSource === "PLUGGY").map((h) => <option key={h.id} value={h.id}>{h.institution || h.issuer} · {h.productName}</option>)}
      </select>
    </label>
    <label className="block">Quantidade total correta, incluindo este aporte
      <Input className="mt-1" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
    </label>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={pending || !holdingId || !quantity} onClick={() => review("PROJECT")}>Aplicar quantidade temporária</Button>
      <Button size="sm" variant="outline" disabled={pending || !holdingId} onClick={() => review("PROVIDER")}>Usar posição atual da instituição</Button>
    </div>
    {message && <p role="alert">{message}</p>}
  </div>;
}

export function PendingContributions({ asset, prices, pending, onPriceChange, onSave }: {
  asset: AssetDto; prices: Record<string, string>; pending: boolean;
  onPriceChange(id: string, value: string): void; onSave(id: string): void;
}) {
  const entries = asset.awaitingSyncContributions ?? [];
  if (!entries.length) return null;
  return <section aria-label={`Aportes aguardando sincronização de ${asset.ticker}`} className="mb-3 space-y-3 rounded-xl border border-[var(--primary)]/35 bg-[var(--primary)]/10 p-3 text-xs">
    <p className="flex items-center gap-1.5 font-semibold text-[var(--primary)]"><Clock3 className="size-4" /> Aguardando sync · {entries.length} aporte(s)</p>
    {entries.map((entry) => {
      const holding = asset.holdings.find((row) => row.id === entry.holdingId);
      return <div key={entry.id} data-pending-contribution={entry.id} className="space-y-2 border-t border-[var(--primary)]/20 pt-2">
        {holding && <p>{holding.institution || holding.issuer} · {holding.productName}</p>}
        <p><PrivateValue>{formatMoney(entry.value)}</PrivateValue>{asset.instrumentType !== "FIXED_INCOME" && <> · <PrivateValue>{Number(entry.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 10 })}</PrivateValue> un.</>}</p>
        {entry.quantityProjected && <p>Quantidade já incluída temporariamente na Carteira.</p>}
        {entry.needsReview && <p role="status">Aporte anterior precisa de revisão da posição de destino. A quantidade não foi alterada automaticamente.</p>}
        {entry.needsReview && <PendingContributionReview asset={asset} pendingId={entry.id} />}
        {entry.paidUnitPrice && <p>Preço pago: <PrivateValue>{entry.nativeCurrency && entry.paidUnitPriceNative ? formatCurrency(entry.paidUnitPriceNative, entry.nativeCurrency) : formatMoney(entry.paidUnitPrice)}</PrivateValue></p>}
        {asset.instrumentType !== "FIXED_INCOME" && !entry.paidUnitPrice && <div className="flex flex-wrap gap-2" data-private-editor>
          <Input type="number" min="0.00000001" step="any" value={prices[entry.id] ?? ""} onChange={(event) => onPriceChange(entry.id, event.target.value)} aria-label={`Preço unitário pago por ${asset.ticker} em ${entry.nativeCurrency ?? "BRL"}`} className="h-10 bg-[var(--card)]" />
          <Button type="button" size="sm" disabled={pending || !(Number(prices[entry.id]) > 0)} onClick={() => onSave(entry.id)}>Salvar preço</Button>
        </div>}
      </div>;
    })}
  </section>;
}
