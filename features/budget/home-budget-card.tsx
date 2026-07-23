"use client";

import { useState } from "react";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { BudgetHistoryChart } from "@/components/charts/budget-history-chart";

export function HomeBudgetCard({ history }: { history: { month: string; income: number; spent: number }[] }) {
  const [mode, setMode] = useState<"spent" | "income">("spent");
  return (
    <>
      <div className="mb-4 flex justify-end"><SegmentedTabs value={mode} onValueChange={setMode} ariaLabel="Métrica do histórico" options={[{ value: "spent", label: "Gastos" }, { value: "income", label: "Renda" }]} /></div>
      {history.length ? <BudgetHistoryChart data={history} mode={mode} /> : <div className="grid h-72 place-items-center text-sm text-[var(--muted-foreground)]">Registre sua renda e seus gastos para formar o histórico.</div>}
    </>
  );
}
