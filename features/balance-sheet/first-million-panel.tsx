"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProjectionChart } from "@/components/charts/projection-chart";
import { effectiveMonthlyRate, firstMillionMatrix } from "@/features/portfolio/calculations";
import { formatMoney } from "@/lib/money";

export function FirstMillionPanel() {
  const [annualRate, setAnnualRate] = useState(8);
  const [initialValue, setInitialValue] = useState(10000);
  const [desiredValue, setDesiredValue] = useState(1000000);
  const [calculated, setCalculated] = useState(true);
  const matrix = useMemo(() => firstMillionMatrix(initialValue, annualRate).map((row) => ({ contribution: row.monthlyContribution, values: row.values.map((value) => ({ years: value.years, value: value.value.toNumber() })) })), [annualRate, initialValue]);
  const monthlyRate = effectiveMonthlyRate(annualRate).times(100).toDecimalPlaces(2).toNumber();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-3"><div><CardTitle className="text-2xl">Primeiro Milhão</CardTitle><p className="mt-1 text-sm text-[var(--muted-foreground)]">Compare quanto diferentes aportes mensais podem acumular ao longo do tempo.</p></div></CardHeader>
        <CardContent><form onSubmit={(event) => { event.preventDefault(); setCalculated(true); }} className="grid gap-4 @3xl:grid-cols-2 @7xl:grid-cols-5 @7xl:items-end"><div className="space-y-2"><Label htmlFor="annual-rate">Rendimento anual (%)</Label><Input id="annual-rate" type="number" min="0" max="100" step="0.01" value={annualRate} onChange={(event) => { setAnnualRate(Number(event.target.value)); setCalculated(false); }} /></div><div className="space-y-2"><Label htmlFor="monthly-rate">Rendimento mensal (%)</Label><Input id="monthly-rate" disabled value={monthlyRate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /></div><div className="space-y-2"><Label htmlFor="initial-value">Valor inicial</Label><Input id="initial-value" type="number" min="0" step="0.01" value={initialValue} onChange={(event) => { setInitialValue(Number(event.target.value)); setCalculated(false); }} /></div><div className="space-y-2"><Label htmlFor="desired-value">Valor desejado</Label><Input id="desired-value" type="number" min="0" step="0.01" value={desiredValue} onChange={(event) => { setDesiredValue(Number(event.target.value)); setCalculated(false); }} /></div><Button size="lg">Calcular</Button></form></CardContent>
      </Card>
      {calculated && <><Card><CardHeader><CardTitle>Projeção patrimonial</CardTitle></CardHeader><CardContent><ProjectionChart rows={matrix} /></CardContent></Card><Card><CardHeader><CardTitle>Resultados por aporte</CardTitle></CardHeader><CardContent><div className="space-y-3 lg:hidden">{matrix.map((row) => <article key={row.contribution} className="rounded-xl border p-3"><strong className="text-sm">Aporte de {formatMoney(row.contribution)}</strong><dl className="mt-3 grid grid-cols-2 gap-3">{row.values.map((value) => <div key={value.years}><dt className="text-[10px] uppercase text-[var(--muted-foreground)]">{value.years} anos</dt><dd className={value.value >= desiredValue ? "mt-1 text-xs font-semibold text-[var(--success)]" : "mt-1 text-xs"}>{formatMoney(value.value)}</dd></div>)}</dl></article>)}</div><div className="hidden overflow-x-auto lg:block scrollbar-thin"><table className="w-full min-w-[920px] text-right text-sm"><thead className="border-b text-xs uppercase text-[var(--muted-foreground)]"><tr><th className="py-3 text-left">Aportes</th>{matrix[0].values.map((value) => <th key={value.years}>{value.years} anos</th>)}</tr></thead><tbody>{matrix.map((row) => <tr key={row.contribution} className="border-b last:border-0"><td className="py-3 text-left font-semibold">{formatMoney(row.contribution)}</td>{row.values.map((value) => <td key={value.years} className={value.value >= desiredValue ? "font-semibold text-[var(--success)]" : ""}>{formatMoney(value.value)}</td>)}</tr>)}</tbody></table></div><p className="mt-4 text-xs text-[var(--muted-foreground)]">Valores em verde atingem o objetivo de {formatMoney(desiredValue)}. Aportes considerados no fim de cada mês.</p></CardContent></Card></>}
    </div>
  );
}
