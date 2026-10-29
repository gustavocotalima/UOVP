"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChart } from "@/components/charts/donut-chart";
import { formatPercent } from "@/lib/money";
import { saveInvestmentTargetsAction } from "./actions";
import { INVESTMENT_CLASSES, INVESTMENT_CLASS_META, INVESTMENT_PRESETS, type InvestmentClassKey } from "./constants";
import { investmentTargetsTotalCents, parseTargetDraft, parseTargetDrafts, toTargetDrafts } from "./target-drafts";

export function TargetsPanel({ initialTargets }: { initialTargets: Record<InvestmentClassKey, number> }) {
  const [targets, setTargets] = useState(initialTargets);
  const [drafts, setDrafts] = useState(() => toTargetDrafts(initialTargets));
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const total = INVESTMENT_CLASSES.reduce((sum, key) => sum + targets[key], 0);
  const parsedDrafts = parseTargetDrafts(drafts);
  const valid = parsedDrafts !== null && investmentTargetsTotalCents(parsedDrafts) === 10_000;
  const chartData = INVESTMENT_CLASSES.filter((key) => targets[key] > 0).map((key) => ({
    name: INVESTMENT_CLASS_META[key].label,
    color: INVESTMENT_CLASS_META[key].color,
    value: targets[key],
  }));

  function replaceTargets(values: Record<InvestmentClassKey, number>) {
    setTargets({ ...values });
    setDrafts(toTargetDrafts(values));
    setMessage(undefined);
  }

  function editTarget(key: InvestmentClassKey, draft: string) {
    setDrafts((previous) => ({ ...previous, [key]: draft }));
    const value = parseTargetDraft(draft);
    if (value !== null) setTargets((previous) => ({ ...previous, [key]: value }));
    setMessage(undefined);
  }

  function save() {
    setMessage(undefined);
    const values = parseTargetDrafts(drafts);
    if (!values || investmentTargetsTotalCents(values) !== 10_000) {
      setMessage("Preencha todas as metas de 0% a 100%, com até duas casas decimais e totalizando 100%.");
      return;
    }
    startTransition(async () => {
      try {
        await saveInvestmentTargetsAction(values);

        setMessage("Metas salvas.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar.");
      }
    });
  }

  return (
    <div className="grid gap-4 @6xl:grid-cols-[minmax(0,1fr)_340px] @6xl:gap-6 min-[2048px]:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Perfis de investidor</CardTitle></CardHeader>
          <CardContent className="grid gap-3 @4xl:grid-cols-3">
            {INVESTMENT_PRESETS.map((preset) => (
              <button key={preset.slug} type="button" onClick={() => replaceTargets(preset.targets)} className="rounded-2xl border p-4 text-left transition hover:border-[var(--primary)] hover:bg-[var(--muted)]">
                <strong>{preset.name}</strong>
                <p className="mt-2 text-sm leading-5 text-[var(--muted-foreground)]">{preset.description}</p>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Metas por classe</CardTitle><span className={`rounded-full px-3 py-1 text-sm font-semibold ${valid ? "bg-green-500/10 text-[var(--success)]" : "bg-red-500/10 text-[var(--danger)]"}`}>{formatPercent(total)}</span></CardHeader>
          <CardContent className="space-y-6">
            {INVESTMENT_CLASSES.map((investmentClass) => (
              <label key={investmentClass} className="grid gap-2 @3xl:grid-cols-[220px_1fr_76px] @3xl:items-center">
                <span className="flex items-center gap-2 text-sm"><span className="size-2.5 rounded-full" style={{ background: INVESTMENT_CLASS_META[investmentClass].color }} />{INVESTMENT_CLASS_META[investmentClass].label}</span>
                <input aria-label={`Ajustar meta de ${INVESTMENT_CLASS_META[investmentClass].label}`} type="range" min="0" max="100" step="1" value={targets[investmentClass]} onChange={(event) => editTarget(investmentClass, event.target.value)} className="accent-[var(--primary)]" />
                <div className="flex items-center rounded-lg border"><input aria-label={`Meta de ${INVESTMENT_CLASS_META[investmentClass].label}`} aria-invalid={parseTargetDraft(drafts[investmentClass]) === null} className="h-9 w-12 bg-transparent px-2 text-right text-sm" type="number" min="0" max="100" step="0.01" required value={drafts[investmentClass]} onChange={(event) => editTarget(investmentClass, event.target.value)} /><span className="pr-2 text-xs text-[var(--muted-foreground)]">%</span></div>
              </label>
            ))}
            {parsedDrafts === null && <p role="status" className="text-sm text-[var(--danger)]">Preencha todas as metas com valores de 0% a 100% e até duas casas decimais.</p>}
            {message && <p role="status" className="text-sm text-[var(--muted-foreground)]">{message}</p>}
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => replaceTargets(initialTargets)}><RotateCcw className="size-4" /> Desfazer</Button><Button onClick={save} disabled={!valid || pending}><Save className="size-4" /> {pending ? "Salvando…" : "Salvar metas"}</Button></div>
          </CardContent>
        </Card>
      </div>
      <Card className="h-fit"><CardHeader><CardTitle>Distribuição-alvo</CardTitle></CardHeader><CardContent><DonutChart unit="percent" privateValues={false} data={chartData} centerLabel="Meta total" /><div className="space-y-2">{chartData.map((item) => <div key={item.name} className="flex justify-between text-xs"><span>{item.name}</span><strong>{formatPercent(item.value)}</strong></div>)}</div></CardContent></Card>
    </div>
  );
}
