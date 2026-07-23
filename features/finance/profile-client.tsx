"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveFinanceProfileAction } from "./actions";
import { FinanceNotice, runFinanceAction } from "./shared";
import type { FinanceData } from "./types";

export function ProfileClient({ data }: { data: FinanceData }) {
  const router = useRouter();
  const [name, setName] = useState(data.user.name ?? "");
  const [income, setIncome] = useState(data.profile.monthlyIncome);
  const [start, setStart] = useState(String(data.profile.financialMonthStart));
  const [objectives, setObjectives] = useState(data.profile.objectives ?? "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const initials = (name || data.user.email || "U").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  async function save() {
    const ok = await runFinanceAction(
      () => saveFinanceProfileAction({ name, monthlyIncome: Number(income), financialMonthStart: Number(start), objectives }),
      setPending,
      setNotice,
      "Perfil atualizado.",
    );
    if (ok) router.refresh();
  }

  return (
    <div className="space-y-5">
      {notice && <FinanceNotice type={notice.type}>{notice.text}</FinanceNotice>}
      <Card>
        <CardHeader><CardTitle>Informações Pessoais</CardTitle><p className="text-sm text-[var(--muted-foreground)]">Atualize suas informações de perfil.</p></CardHeader>
        <CardContent className="space-y-6">
          <div className="grid size-20 place-items-center rounded-full bg-[var(--primary)]/15 text-xl font-semibold text-[var(--primary)]">{initials}</div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Label>Nome<Input className="mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Digite seu nome" /></Label>
            <Label>E-mail<Input className="mt-2" value={data.user.email ?? ""} disabled placeholder="Digite seu email" /></Label>
            <Label>Renda Mensal<Input className="mt-2" type="number" min="0" step="0.01" value={income} onChange={(event) => setIncome(event.target.value)} placeholder="R$ 0,00" /></Label>
            <Label>Início do Mês Financeiro<Input className="mt-2" type="number" min="1" max="28" value={start} onChange={(event) => setStart(event.target.value)} /></Label>
            <Label className="sm:col-span-2">Objetivos financeiros<textarea className="mt-2 min-h-32 w-full rounded-xl border bg-transparent p-3 text-sm" value={objectives} onChange={(event) => setObjectives(event.target.value)} placeholder="Digite seus objetivos" maxLength={4000} /></Label>
          </div>
          <Button onClick={save} disabled={pending || name.trim().length < 2}><Save className="size-4" /> {pending ? "Salvando…" : "Salvar"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
