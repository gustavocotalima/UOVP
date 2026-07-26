"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META, type BudgetCategoryKey } from "@/features/budget/constants";
import { formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/utils";
import { resetFinanceGoalsAction, saveFinanceGoalsAction } from "./actions";
import { FinanceNotice, runFinanceAction } from "./shared";
import type { FinanceData, FinanceGoalRecord } from "./types";

const DISPLAY_ORDER: BudgetCategoryKey[] = [
  "FINANCIAL_FREEDOM",
  "FIXED_COSTS",
  "COMFORT",
  "GOALS",
  "PLEASURES",
  "KNOWLEDGE",
];

export function GoalsClient({ data }: { data: FinanceData }) {
  const router = useRouter();
  const income = Number(data.profile.monthlyIncome);
  const [mode, setMode] = useState<"percentage" | "value">("percentage");
  const [goals, setGoals] = useState<FinanceGoalRecord>(data.goals);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const total = useMemo(() => BUDGET_CATEGORIES.reduce((sum, category) => sum + goals[category], 0), [goals]);

  function setGoal(category: BudgetCategoryKey, raw: number) {
    const percentage = mode === "percentage" ? raw : income > 0 ? (raw / income) * 100 : 0;
    setGoals((current) => ({ ...current, [category]: Math.max(0, Math.min(100, Number(percentage.toFixed(2)))) }));
  }

  async function save() {
    const ok = await runFinanceAction(() => saveFinanceGoalsAction(goals), setPending, setNotice, "Metas salvas.");
    if (ok) router.refresh();
  }

  async function reset() {
    const ok = await runFinanceAction(() => resetFinanceGoalsAction(), setPending, setNotice, "Valores restaurados.");
    if (ok) {
      setGoals({ FIXED_COSTS: 30, COMFORT: 15, GOALS: 15, PLEASURES: 10, FINANCIAL_FREEDOM: 25, KNOWLEDGE: 5 });
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {notice && <FinanceNotice type={notice.type}>{notice.text}</FinanceNotice>}
      <Card>
        <CardContent className="flex flex-col gap-5 p-4 sm:p-5 @3xl:flex-row @3xl:items-center @3xl:justify-between">
          <div><p className="text-sm text-[var(--muted-foreground)]">Renda mensal</p><p className="mt-1 text-2xl font-semibold">{formatMoney(income)}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">Base usada para calcular os valores das metas</p></div>
          <div className="grid grid-cols-2 rounded-xl bg-[var(--muted)] p-1">
            <button type="button" onClick={() => setMode("percentage")} className={cn("rounded-lg px-4 py-2 text-sm font-semibold", mode === "percentage" && "bg-[var(--card)] shadow-sm")}>Porcentagem</button>
            <button type="button" onClick={() => setMode("value")} className={cn("rounded-lg px-4 py-2 text-sm font-semibold", mode === "value" && "bg-[var(--card)] shadow-sm")}>Valor (R$)</button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div><CardTitle>Visualização de uso</CardTitle><p className="mt-1 text-sm text-[var(--muted-foreground)]">Distribuição planejada da sua renda</p></div>
          <Button variant="ghost" size="sm" onClick={reset} disabled={pending}><RotateCcw className="size-4" /> Resetar valores</Button>
        </CardHeader>
        <CardContent className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
          {DISPLAY_ORDER.map((category) => {
            const meta = BUDGET_CATEGORY_META[category];
            return <div key={category} className="rounded-xl border p-4"><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-medium"><span className="size-2.5 rounded-full" style={{ background: meta.color }} />{meta.label}</span><strong>{mode === "percentage" ? formatPercent(goals[category]) : formatMoney(income * goals[category] / 100)}</strong></div></div>;
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controle de Orçamento</CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">Ajuste cada categoria. O total precisa ser exatamente 100%.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {DISPLAY_ORDER.map((category) => {
            const meta = BUDGET_CATEGORY_META[category];
            const displayValue = mode === "percentage" ? goals[category] : income * goals[category] / 100;
            return (
              <div key={category} className="grid gap-3 md:grid-cols-[210px_1fr_140px] md:items-center">
                <label htmlFor={`goal-${category}`} className="text-sm font-medium">{meta.label}</label>
                <input id={`goal-${category}`} type="range" min="0" max="100" step="1" value={goals[category]} onChange={(event) => setGoals((current) => ({ ...current, [category]: Number(event.target.value) }))} className="h-2 w-full cursor-pointer accent-[var(--primary)]" />
                <div className="relative">
                  {mode === "value" && <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-[var(--muted-foreground)]">R$</span>}
                  <input type="number" min="0" max={mode === "percentage" ? 100 : income} step={mode === "percentage" ? 1 : 10} value={Number(displayValue.toFixed(2))} onChange={(event) => setGoal(category, Number(event.target.value))} className={cn("h-11 w-full rounded-xl border bg-transparent px-3 text-right text-sm font-semibold", mode === "value" && "pl-9")} />
                  {mode === "percentage" && <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-[var(--muted-foreground)]">%</span>}
                </div>
              </div>
            );
          })}
          <div className="flex flex-col gap-4 rounded-xl bg-[var(--muted)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-xs text-[var(--muted-foreground)]">Alocado</p><p className={cn("mt-1 text-xl font-semibold", Math.abs(total - 100) > 0.001 && "text-[var(--danger)]")}>{formatPercent(total)} / 100%</p></div>
            <Button onClick={save} disabled={pending || Math.abs(total - 100) > 0.001}><Save className="size-4" /> {pending ? "Salvando…" : "Salvar metas"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
