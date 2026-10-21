"use client";

import { useState } from "react";
import { PrivateValue } from "@/components/ui/private-value";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProjectionChart } from "@/components/charts/projection-chart";
import { formatMoney } from "@/lib/money";
import {
  INITIAL_FIRST_MILLION_INPUTS,
  calculateFirstMillionResult,
  parseFirstMillionDrafts,
  type FirstMillionDrafts,
} from "./first-million-input";

export function FirstMillionPanel() {
  const [drafts, setDrafts] = useState<FirstMillionDrafts>({ annualRate: "8", initialValue: "10000", desiredValue: "1000000" });
  const [result, setResult] = useState(() => calculateFirstMillionResult(INITIAL_FIRST_MILLION_INPUTS)!);
  const [calculated, setCalculated] = useState(true);
  const [error, setError] = useState<string>();
  const { matrix, monthlyRate, inputs: { desiredValue } } = result;

  function edit(key: keyof FirstMillionDrafts, value: string) {
    setDrafts((previous) => ({ ...previous, [key]: value }));
    setCalculated(false);
    setError(undefined);
  }

  function calculate() {
    const inputs = parseFirstMillionDrafts(drafts);
    if (!inputs) {
      setError("Preencha os valores com números válidos e não negativos. A taxa anual deve ficar entre 0% e 100%.");
      setCalculated(false);
      return;
    }
    const nextResult = calculateFirstMillionResult(inputs);
    if (!nextResult) {
      setError("A projeção excede a faixa numérica do gráfico. Reduza o valor inicial ou a taxa anual.");
      setCalculated(false);
      return;
    }
    setResult(nextResult);
    setError(undefined);
    setCalculated(true);
  }
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-3"><div><CardTitle className="text-2xl">Primeiro Milhão</CardTitle><p className="mt-1 text-sm text-[var(--muted-foreground)]">Compare quanto diferentes aportes mensais podem acumular ao longo do tempo.</p></div></CardHeader>
        <CardContent><form data-private-editor onSubmit={(event) => { event.preventDefault(); calculate(); }} className="grid gap-4 @3xl:grid-cols-2 @7xl:grid-cols-5 @7xl:items-end"><div className="space-y-2"><Label htmlFor="annual-rate">Rendimento anual (%)</Label><Input id="annual-rate" type="number" min="0" max="100" step="0.01" required value={drafts.annualRate} onChange={(event) => edit("annualRate", event.target.value)} /></div><div className="space-y-2"><Label htmlFor="monthly-rate">Rendimento mensal (%)</Label><Input id="monthly-rate" disabled value={calculated ? monthlyRate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""} placeholder="Calcule novamente" /></div><div className="space-y-2"><Label htmlFor="initial-value">Valor inicial</Label><Input id="initial-value" type="number" min="0" step="0.01" required value={drafts.initialValue} onChange={(event) => edit("initialValue", event.target.value)} /></div><div className="space-y-2"><Label htmlFor="desired-value">Valor desejado</Label><Input id="desired-value" type="number" min="0" step="0.01" required value={drafts.desiredValue} onChange={(event) => edit("desiredValue", event.target.value)} /></div><Button size="lg">Calcular</Button></form>{error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}</CardContent>
      </Card>
      {calculated && <><Card><CardHeader><CardTitle>Projeção patrimonial</CardTitle></CardHeader><CardContent><ProjectionChart rows={matrix} /></CardContent></Card><Card><CardHeader><CardTitle>Resultados por aporte</CardTitle></CardHeader><CardContent><div className="space-y-3 lg:hidden">{matrix.map((row) => <article key={row.contribution} className="rounded-xl border p-3"><strong className="text-sm">Aporte de <PrivateValue>{formatMoney(row.contribution)}</PrivateValue></strong><dl className="mt-3 grid grid-cols-2 gap-3">{row.values.map((value) => <div key={value.years}><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">{value.years} anos</dt><dd className={value.value >= desiredValue ? "mt-1 text-xs font-semibold text-[var(--success)]" : "mt-1 text-xs"}><PrivateValue>{formatMoney(value.value)}</PrivateValue></dd></div>)}</dl></article>)}</div><div className="hidden overflow-x-auto lg:block scrollbar-thin"><table className="w-full min-w-[920px] text-right text-sm"><thead className="border-b text-xs uppercase text-[var(--muted-foreground)]"><tr><th className="py-3 text-left">Aportes</th>{matrix[0].values.map((value) => <th key={value.years}>{value.years} anos</th>)}</tr></thead><tbody>{matrix.map((row) => <tr key={row.contribution} className="border-b last:border-0"><td className="py-3 text-left font-semibold"><PrivateValue>{formatMoney(row.contribution)}</PrivateValue></td>{row.values.map((value) => <td key={value.years} className={value.value >= desiredValue ? "font-semibold text-[var(--success)]" : ""}><PrivateValue>{formatMoney(value.value)}</PrivateValue></td>)}</tr>)}</tbody></table></div><p className="mt-4 text-xs text-[var(--muted-foreground)]">Valores em verde atingem o objetivo de <PrivateValue>{formatMoney(desiredValue)}</PrivateValue>. Aportes considerados no fim de cada mês.</p></CardContent></Card></>}
    </div>
  );
}
