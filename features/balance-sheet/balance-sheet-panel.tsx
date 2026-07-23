"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/money";
import { deleteBalanceEntryAction, saveBalanceEntryAction } from "./actions";
import { BALANCE_CATEGORIES, BALANCE_META, type BalanceCategoryKey } from "./constants";

type Entry = { id: string; category: BalanceCategoryKey; name: string; value: string };

export function BalanceSheetPanel({ entries }: { entries: Entry[] }) {
  const [editing, setEditing] = useState<{ id?: string; category: BalanceCategoryKey; name: string; value: number }>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const { requestConfirmation, confirmationDialog } = useConfirmDialog();
  const assets = entries.filter((entry) => BALANCE_META[entry.category].side === "asset").reduce((sum, entry) => sum + Number(entry.value), 0);
  const liabilities = entries.filter((entry) => BALANCE_META[entry.category].side === "liability").reduce((sum, entry) => sum + Number(entry.value), 0);
  const netWorth = assets - liabilities;

  async function removeEntry(entry: Entry) {
    const confirmed = await requestConfirmation({
      title: "Excluir lançamento?",
      description: `${entry.name} será removido do balanço patrimonial. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir lançamento",
      danger: true,
    });
    if (!confirmed) return;
    setMessage(undefined);
    startTransition(async () => {
      try {
        await deleteBalanceEntryAction(entry.id);
        setMessage("Lançamento excluído.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível excluir.");
      }
    });
  }

  function renderSide(side: "asset" | "liability") {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle className={side === "asset" ? "text-[var(--success)]" : "text-[var(--danger)]"}>{side === "asset" ? "Ativos" : "Passivos"}</CardTitle><strong className="text-xl">{formatMoney(side === "asset" ? assets : liabilities)}</strong></CardHeader>
        <CardContent className="space-y-5">
          {BALANCE_CATEGORIES.filter((category) => BALANCE_META[category].side === side).map((category) => (
            <section key={category}>
              <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">{BALANCE_META[category].label}</h3><Button variant="ghost" size="icon" onClick={() => setEditing({ category, name: "", value: 0 })} aria-label={`Adicionar em ${BALANCE_META[category].label}`}><Plus className="size-5" /></Button></div>
              <div className="space-y-2">{entries.filter((entry) => entry.category === category).map((entry) => <div key={entry.id} className="flex items-center gap-2 rounded-xl border p-3 text-sm"><span className="flex-1">{entry.name}</span><strong>{formatMoney(entry.value)}</strong><Button variant="ghost" size="icon" onClick={() => setEditing({ id: entry.id, category, name: entry.name, value: Number(entry.value) })} aria-label={`Editar ${entry.name}`}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" onClick={() => removeEntry(entry)} disabled={pending} aria-label={`Excluir ${entry.name}`}><Trash2 className="size-4 text-[var(--danger)]" /></Button></div>)}</div>
              {editing?.category === category && <form onSubmit={(event) => { event.preventDefault(); startTransition(async () => { try { await saveBalanceEntryAction(editing); setEditing(undefined); setMessage("Lançamento salvo."); } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar."); } }); }} className="mt-3 grid gap-2 rounded-xl bg-[var(--muted)] p-3 sm:grid-cols-[1fr_150px_auto]"><div><Label className="sr-only" htmlFor={`entry-name-${category}`}>Nome</Label><Input id={`entry-name-${category}`} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="Nome" required /></div><div><Label className="sr-only" htmlFor={`entry-value-${category}`}>Valor</Label><Input id={`entry-value-${category}`} type="number" min="0" step="0.01" value={editing.value} onChange={(event) => setEditing({ ...editing, value: Number(event.target.value) })} required /></div><div className="flex gap-1"><Button disabled={pending}>Salvar</Button><Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>Cancelar</Button></div></form>}
            </section>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="mx-auto max-w-sm text-center"><CardContent className="pt-6"><p className="text-sm text-[var(--muted-foreground)]">Patrimônio Líquido</p><strong className={`mt-2 block text-3xl ${netWorth >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{formatMoney(netWorth)}</strong></CardContent></Card>
      {message && <p role="status" className="rounded-xl border bg-[var(--card)] p-3 text-sm">{message}</p>}
      <div className="grid gap-6 lg:grid-cols-2">{renderSide("asset")}{renderSide("liability")}</div>
      {confirmationDialog}
    </div>
  );
}
