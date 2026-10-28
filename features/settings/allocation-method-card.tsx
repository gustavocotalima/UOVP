"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ALLOCATION_LABELS, ALLOCATION_METHODS, type AllocationMethod } from "@/features/portfolio/calculation/types";
import { saveAllocationMethodAction } from "./actions";

export function AllocationMethodCard({ initialMethod }: { initialMethod: AllocationMethod }) {
  const [method, setMethod] = useState(initialMethod);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  function save(value: AllocationMethod) {
    setMessage("");
    start(async () => {
      try {
        const result = await saveAllocationMethodAction(value);
        setMethod(result.allocationMethod);
        setMessage("Sistema atualizado. Calcule novamente os aportes em rascunho.");
        router.refresh();
      } catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível salvar."); }
    });
  }
  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
            <Calculator className="size-5" />
          </span>
          <div>
            <CardTitle>Cálculo de aportes</CardTitle>
            <CardDescription>Escolha o sistema usado na Carteira e nas prévias dos assistentes de IA.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid max-w-md gap-2">
          <Label htmlFor="allocation-method">Sistema de cálculo de aportes</Label>
          <Select id="allocation-method" className="w-full" value={method} disabled={pending} onChange={(event) => save(event.target.value as AllocationMethod)}>
            {ALLOCATION_METHODS.map((m) => <option key={m} value={m}>{ALLOCATION_LABELS[m]}{m === "IMPROVED" ? " (padrão)" : ""}</option>)}
          </Select>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-[var(--muted)]/30 p-4">
            <dt className="text-sm font-medium">Melhorado</dt>
            <dd className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
              Prioriza o equilíbrio entre as metas e, dentro de cada classe, as proporções das notas. Aproveita o orçamento preservando esse equilíbrio, com margem de arredondamento conforme as cotas.
            </dd>
          </div>
          <div className="rounded-xl border bg-[var(--muted)]/30 p-4">
            <dt className="text-sm font-medium">Diagrama do Cerrado</dt>
            <dd className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
              <p>Reproduz as regras reconstruídas da AUVP.</p>
              <p>A equivalência completa depende dos mesmos dados, da ordem de inclusão dos ativos e da cotação utilizada.</p>
            </dd>
          </div>
        </dl>
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">Aportes registrados e aguardando sincronização são preservados.</p>
        {message && <p role="status" className="rounded-xl border bg-[var(--muted)]/30 p-3 text-sm">{message}</p>}
      </CardContent>
    </Card>
  );
}
