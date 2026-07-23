"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Plus, Repeat2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { formatMoney, formatPercent } from "@/lib/money";
import { addExpenseAction, applyRecurringExpensesAction, deleteExpenseAction, saveBudgetTargetsAction, saveIncomeAction, updateExpenseAction } from "./actions";
import { budgetCategorySummary } from "./calculations";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META, type BudgetCategoryKey } from "./constants";

type BudgetDto = {
  id: string;
  year: number;
  month: number;
  income: string;
  targets: Record<BudgetCategoryKey, number>;
  expenses: { id: string; name: string; amount: string; category: BudgetCategoryKey; spentAt: string; recurringExpenseId: string | null }[];
  recurringExpenses: { id: string; name: string; amount: string; category: BudgetCategoryKey }[];
};

export function BudgetClient({ data }: { data: BudgetDto }) {
  const router = useRouter();
  const [section, setSection] = useState<"budget" | "goals">("budget");
  const [category, setCategory] = useState<BudgetCategoryKey | "ALL">("ALL");
  const [income, setIncome] = useState(Number(data.income));
  const [targets, setTargets] = useState(data.targets);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(0);
  const [expenseCategory, setExpenseCategory] = useState<BudgetCategoryKey>("FIXED_COSTS");
  const [recurring, setRecurring] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string>();
  const [showRecurring, setShowRecurring] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const filteredExpenses = category === "ALL" ? data.expenses : data.expenses.filter((expense) => expense.category === category);
  const totalSpent = data.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const utilized = income ? totalSpent / income * 100 : 0;
  const targetTotal = BUDGET_CATEGORIES.reduce((sum, key) => sum + targets[key], 0);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(data.year, data.month - 1, 1));
  const summaries = useMemo(() => Object.fromEntries(BUDGET_CATEGORIES.map((key) => [key, budgetCategorySummary(income, targets[key], data.expenses.filter((expense) => expense.category === key).reduce((sum, expense) => sum + Number(expense.amount), 0))])) as Record<BudgetCategoryKey, ReturnType<typeof budgetCategorySummary>>, [data.expenses, income, targets]);

  function changeMonth(delta: number) {
    const date = new Date(data.year, data.month - 1 + delta, 1);
    router.push(`/orcamento-domestico?year=${date.getFullYear()}&month=${date.getMonth() + 1}`);
  }

  function handleAction(action: () => Promise<void>, success: string) {
    setMessage(undefined);
    startTransition(async () => {
      try { await action(); setMessage(success); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível concluir."); }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs value={section} onValueChange={setSection} ariaLabel="Seções do orçamento" options={[{ value: "budget", label: "Orçamento Doméstico" }, { value: "goals", label: "Minhas metas" }]} />
        <div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => changeMonth(-1)} aria-label="Mês anterior"><ChevronLeft className="size-4" /></Button><strong className="min-w-44 text-center capitalize">{monthLabel}</strong><Button variant="outline" size="icon" onClick={() => changeMonth(1)} aria-label="Próximo mês"><ChevronRight className="size-4" /></Button></div>
      </div>

      {message && <p role="status" className="rounded-xl border bg-[var(--card)] p-4 text-sm">{message}</p>}

      {section === "budget" ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card><CardHeader><p className="text-sm text-[var(--muted-foreground)]">Total gasto</p><CardTitle className="text-2xl">{formatMoney(totalSpent)}</CardTitle></CardHeader></Card>
            <Card><CardHeader><p className="text-sm text-[var(--muted-foreground)]">Renda do mês</p><CardTitle className="text-2xl">{formatMoney(income)}</CardTitle></CardHeader></Card>
            <Card><CardHeader><p className="text-sm text-[var(--muted-foreground)]">Renda utilizada</p><CardTitle className={`text-2xl ${utilized > 100 ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{formatPercent(utilized)}</CardTitle></CardHeader></Card>
          </div>
          <Card><CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-end"><div className="w-full max-w-sm space-y-2"><Label htmlFor="monthly-income">Renda mensal</Label><Input id="monthly-income" type="number" min="0" step="0.01" value={income} onChange={(event) => setIncome(Number(event.target.value))} /></div><Button onClick={() => handleAction(() => saveIncomeAction(data.year, data.month, income), "Renda salva.")} disabled={pending}><Save className="size-4" /> Salvar renda</Button><div className="sm:ml-auto flex gap-2"><Button variant="outline" onClick={() => setShowRecurring(!showRecurring)}>Ver gastos</Button><Button variant="outline" onClick={() => handleAction(() => applyRecurringExpensesAction(data.year, data.month), "Gastos recorrentes preenchidos.")} disabled={pending}><Repeat2 className="size-4" /> Preencher</Button></div></CardContent></Card>
          {showRecurring && <Card><CardHeader><CardTitle>Gastos recorrentes</CardTitle></CardHeader><CardContent>{data.recurringExpenses.length ? <div className="grid gap-2 md:grid-cols-2">{data.recurringExpenses.map((expense) => <div key={expense.id} className="flex justify-between rounded-xl border p-3 text-sm"><span>{expense.name}<small className="block text-[var(--muted-foreground)]">{BUDGET_CATEGORY_META[expense.category].label}</small></span><strong>{formatMoney(expense.amount)}</strong></div>)}</div> : <p className="text-sm text-[var(--muted-foreground)]">Nenhum gasto recorrente cadastrado.</p>}</CardContent></Card>}
          <Card><CardHeader><CardTitle>{editingExpenseId ? "Editar gasto" : "Novo gasto"}</CardTitle></CardHeader><CardContent><form onSubmit={(event) => { event.preventDefault(); handleAction(() => editingExpenseId ? updateExpenseAction({ id: editingExpenseId, name, amount, category: expenseCategory }) : addExpenseAction({ year: data.year, month: data.month, name, amount, category: expenseCategory, recurring }), editingExpenseId ? "Gasto atualizado." : "Gasto adicionado."); setName(""); setAmount(0); setEditingExpenseId(undefined); }} className="grid gap-4 md:grid-cols-[1fr_180px_240px_auto] md:items-end"><div className="space-y-2"><Label htmlFor="expense-name">Nome</Label><Input id="expense-name" value={name} onChange={(event) => setName(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="expense-amount">Valor</Label><Input id="expense-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} required /></div><div className="space-y-2"><Label htmlFor="expense-category">Categoria</Label><Select id="expense-category" className="w-full" value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value as BudgetCategoryKey)}>{BUDGET_CATEGORIES.map((key) => <option key={key} value={key}>{BUDGET_CATEGORY_META[key].label}</option>)}</Select></div><div className="flex gap-2"><Button disabled={pending}>{editingExpenseId ? <Save className="size-4" /> : <Plus className="size-4" />} {editingExpenseId ? "Salvar" : "Adicionar"}</Button>{editingExpenseId && <Button type="button" variant="ghost" onClick={() => { setEditingExpenseId(undefined); setName(""); setAmount(0); }}>Cancelar</Button>}</div>{!editingExpenseId && <label className="flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /> Repetir nos próximos meses</label>}</form></CardContent></Card>
          <Card><CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between"><CardTitle>Gastos do mês</CardTitle><div className="flex max-w-full gap-1 overflow-x-auto">{(["ALL", ...BUDGET_CATEGORIES] as const).map((key) => <Button key={key} size="sm" variant={category === key ? "default" : "ghost"} onClick={() => setCategory(key)}>{key === "ALL" ? "Total" : BUDGET_CATEGORY_META[key].label}</Button>)}</div></CardHeader><CardContent>{filteredExpenses.length ? <div className="space-y-2">{filteredExpenses.map((expense) => <div key={expense.id} className="flex items-center gap-3 rounded-xl border p-3"><span className="size-2.5 rounded-full" style={{ background: BUDGET_CATEGORY_META[expense.category].color }} /><span className="flex-1"><strong className="text-sm">{expense.name}</strong><small className="block text-[var(--muted-foreground)]">{BUDGET_CATEGORY_META[expense.category].label}{expense.recurringExpenseId ? " · Recorrente" : ""}</small></span><strong>{formatMoney(expense.amount)}</strong><Button variant="ghost" size="icon" onClick={() => { setEditingExpenseId(expense.id); setName(expense.name); setAmount(Number(expense.amount)); setExpenseCategory(expense.category); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label={`Editar ${expense.name}`}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" onClick={() => confirm("Excluir este gasto?") && handleAction(() => deleteExpenseAction(expense.id), "Gasto excluído.")}><Trash2 className="size-4 text-[var(--danger)]" /></Button></div>)}</div> : <div className="grid h-36 place-items-center text-sm text-[var(--muted-foreground)]">Nenhum gasto nesta seleção.</div>}</CardContent></Card>
          <Card><CardHeader><CardTitle>Resumo por categoria</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b text-xs uppercase text-[var(--muted-foreground)]"><tr><th className="py-3">Categoria</th><th>Gasto</th><th>Deveria gastar</th><th>Utilizado</th><th>Saldo</th></tr></thead><tbody>{BUDGET_CATEGORIES.map((key) => <tr key={key} className="border-b last:border-0"><td className="py-4"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: BUDGET_CATEGORY_META[key].color }} />{BUDGET_CATEGORY_META[key].label}</span></td><td>{formatMoney(summaries[key].spentAmount)}</td><td>{formatMoney(summaries[key].targetAmount)}</td><td className={summaries[key].utilizedPercentage.gt(100) ? "text-[var(--danger)]" : ""}>{formatPercent(summaries[key].utilizedPercentage)}</td><td>{formatMoney(summaries[key].remainingAmount)}</td></tr>)}</tbody></table></CardContent></Card>
        </>
      ) : (
        <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Metas do orçamento</CardTitle><span className={Math.abs(targetTotal - 100) < 0.001 ? "text-[var(--success)]" : "text-[var(--danger)]"}>{formatPercent(targetTotal, 0)}</span></CardHeader><CardContent className="space-y-6">{BUDGET_CATEGORIES.map((key) => <label key={key} className="grid gap-2 sm:grid-cols-[220px_1fr_76px] sm:items-center"><span className="text-sm">{BUDGET_CATEGORY_META[key].label}</span><input type="range" min="0" max="100" value={targets[key]} onChange={(event) => setTargets({ ...targets, [key]: Number(event.target.value) })} className="accent-[var(--primary)]" /><div className="flex items-center rounded-lg border"><input aria-label={`Meta de ${BUDGET_CATEGORY_META[key].label}`} className="h-9 w-12 bg-transparent px-2 text-right text-sm" type="number" min="0" max="100" value={targets[key]} onChange={(event) => setTargets({ ...targets, [key]: Number(event.target.value) })} /><span className="pr-2 text-xs">%</span></div></label>)}<div className="flex gap-2"><Button variant="outline" onClick={() => setTargets(data.targets)}>Desfazer</Button><Button onClick={() => handleAction(() => saveBudgetTargetsAction(data.year, data.month, targets), "Metas salvas.")} disabled={pending || Math.abs(targetTotal - 100) > 0.001}><Save className="size-4" /> Salvar metas</Button></div></CardContent></Card>
      )}
    </div>
  );
}
