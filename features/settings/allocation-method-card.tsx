"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  return <Card>
    <CardHeader><CardTitle>Cálculo de aportes</CardTitle><CardDescription>Escolha o sistema usado na Carteira e nas prévias dos assistentes de IA.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <Label htmlFor="allocation-method">Sistema de cálculo de aportes</Label>
      <Select id="allocation-method" value={method} disabled={pending} onChange={(event) => save(event.target.value as AllocationMethod)}>
        {ALLOCATION_METHODS.map((m) => <option key={m} value={m}>{ALLOCATION_LABELS[m]}{m === "IMPROVED" ? " (padrão)" : ""}</option>)}
      </Select>
      <p className="text-sm text-muted-foreground">Melhorado busca aproveitar o orçamento, respeitando metas com uma margem de arredondamento baseada nas cotas, e depois distribui pelas notas.</p>
      <p className="text-sm text-muted-foreground">Diagrama do Cerrado reproduz as regras reconstruídas da AUVP, incluindo suas passadas, exclusões e sobras. A equivalência depende dos mesmos dados e da ordem de inclusão dos ativos.</p>
      <p className="text-sm text-muted-foreground">A escolha vale somente para sua conta. Aportes registrados e aguardando sincronização são preservados.</p>
      {message && <p role="status" className="text-sm">{message}</p>}
    </CardContent>
  </Card>;
}
