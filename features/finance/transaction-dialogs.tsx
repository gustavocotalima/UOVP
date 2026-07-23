"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META, type BudgetCategoryKey } from "@/features/budget/constants";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createFinanceTransactionAction, updateFinanceTransactionAction } from "./actions";
import { FinanceNotice, runFinanceAction } from "./shared";
import type { FinanceTagDto, FinanceTransactionDto, FinancialAccountDto } from "./types";

function monthValue(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function TagPicker({
  tags,
  selected,
  onChange,
}: {
  tags: FinanceTagDto[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const active = selected.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? selected.filter((id) => id !== tag.id) : [...selected, tag.id])}
            className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", active && "border-transparent text-white")}
            style={active ? { background: tag.color } : undefined}
          >
            {tag.name}
          </button>
        );
      })}
      {!tags.length && <p className="text-xs text-[var(--muted-foreground)]">Crie tags na seção Tags.</p>}
    </div>
  );
}

export function TransactionEditorDialog({
  transaction,
  accounts,
  tags,
  open,
  onOpenChange,
}: {
  transaction: FinanceTransactionDto | null;
  accounts: FinancialAccountDto[];
  tags: FinanceTagDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [category, setCategory] = useState<BudgetCategoryKey | "">("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!transaction) return;
    setDescription(transaction.description);
    setAccountId(transaction.accountId);
    setAmount(String(Math.abs(Number(transaction.amount))));
    setKind(transaction.kind);
    setDate(transaction.date.slice(0, 10));
    setReference(monthValue(transaction.referenceYear, transaction.referenceMonth));
    setCategory(transaction.budgetCategory ?? "");
    setTagIds(transaction.tags.map((tag) => tag.id));
    setNote(transaction.note ?? "");
    setNotice(null);
  }, [transaction]);

  if (!transaction) return null;
  const providerOwned = transaction.source === "PLUGGY";
  async function save() {
    if (!transaction) return;
    const parsedReference = parseMonth(reference);
    const ok = await runFinanceAction(
      () =>
        updateFinanceTransactionAction({
          id: transaction.id,
          ...(providerOwned
            ? {}
            : {
                description,
                accountId,
                amount: Number(amount),
                kind,
                date,
              }),
          referenceYear: parsedReference.year,
          referenceMonth: parsedReference.month,
          budgetCategory: category || null,
          tagIds,
          note,
        }),
      setPending,
      setNotice,
      "Transação atualizada.",
    );
    if (ok) {
      router.refresh();
      onOpenChange(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={formatMoney(Number(transaction.amount))}
      description={new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(transaction.date))}
      footer={<Button onClick={save} disabled={pending}>{pending ? "Salvando…" : "Salvar alterações"}</Button>}
    >
      <div className="space-y-5">
        {notice && <FinanceNotice type={notice.type}>{notice.text}</FinanceNotice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Label className="sm:col-span-2">Descrição<Input className="mt-2" value={description} disabled={providerOwned} onChange={(event) => setDescription(event.target.value)} /></Label>
          <Label>Conta<Select className="mt-2 w-full" value={accountId} disabled={providerOwned} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></Label>
          <Label>Tipo<Select className="mt-2 w-full" value={kind} disabled={providerOwned} onChange={(event) => setKind(event.target.value as "INCOME" | "EXPENSE")}><option value="EXPENSE">Saída</option><option value="INCOME">Entrada</option></Select></Label>
          <Label>Quantia<Input className="mt-2" type="number" min="0.01" step="0.01" value={amount} disabled={providerOwned} onChange={(event) => setAmount(event.target.value)} /></Label>
          <Label>Data<Input className="mt-2" type="date" value={date} disabled={providerOwned} onChange={(event) => setDate(event.target.value)} /></Label>
          <Label>Meta<Select className="mt-2 w-full" value={category} onChange={(event) => setCategory(event.target.value as BudgetCategoryKey | "")}><option value="">Sem meta</option>{BUDGET_CATEGORIES.map((item) => <option key={item} value={item}>{BUDGET_CATEGORY_META[item].label}</option>)}</Select></Label>
          <Label>Mês de referência<Input className="mt-2" type="month" value={reference} onChange={(event) => setReference(event.target.value)} /></Label>
        </div>
        <div><Label>Tags</Label><div className="mt-2"><TagPicker tags={tags} selected={tagIds} onChange={setTagIds} /></div></div>
        <Label>Observação<textarea className="mt-2 min-h-24 w-full rounded-xl border bg-transparent p-3 text-sm" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Digite uma observação" /></Label>
      </div>
    </Dialog>
  );
}

export function NewTransactionDialog({
  accounts,
  tags,
  year,
  month,
  open,
  onOpenChange,
}: {
  accounts: FinancialAccountDto[];
  tags: FinanceTagDto[];
  year: number;
  month: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState(monthValue(year, month));
  const [category, setCategory] = useState<BudgetCategoryKey | "">("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const valid = useMemo(() => description.trim().length >= 2 && accountId && Number(amount) > 0 && date && reference, [description, accountId, amount, date, reference]);

  useEffect(() => {
    if (!open) return;
    setKind("EXPENSE");
    setDescription("");
    setAccountId(accounts[0]?.id ?? "");
    setAmount("");
    setDate(new Date().toISOString().slice(0, 10));
    setReference(monthValue(year, month));
    setCategory("");
    setTagIds([]);
    setNote("");
    setNotice(null);
  }, [open, accounts, year, month]);

  async function save() {
    const parsedReference = parseMonth(reference);
    const ok = await runFinanceAction(
      () =>
        createFinanceTransactionAction({
          kind,
          description,
          accountId,
          amount: Number(amount),
          date,
          referenceYear: parsedReference.year,
          referenceMonth: parsedReference.month,
          budgetCategory: category || null,
          tagIds,
          note,
        }),
      setPending,
      setNotice,
      "Transação adicionada.",
    );
    if (ok) {
      setDescription("");
      setAmount("");
      setNote("");
      setTagIds([]);
      router.refresh();
      onOpenChange(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nova transação"
      className="max-w-2xl"
      footer={<Button onClick={save} disabled={pending || !valid}>{pending ? "Adicionando…" : "Adicionar transação"}</Button>}
    >
      <div className="space-y-5">
        {notice && <FinanceNotice type={notice.type}>{notice.text}</FinanceNotice>}
        <div className="grid grid-cols-2 rounded-xl bg-[var(--muted)] p-1">
          {(["EXPENSE", "INCOME"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setKind(value)} className={cn("rounded-lg px-4 py-2 text-sm font-semibold", kind === value && "bg-[var(--card)] shadow-sm")}>{value === "EXPENSE" ? "Saída" : "Entrada"}</button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label className="sm:col-span-2">Descrição<Input className="mt-2" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descreva a transação" /></Label>
          <Label>Conta<Select className="mt-2 w-full" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecionar conta</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></Label>
          <Label>Quantia<Input className="mt-2" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="R$ 0,00" /></Label>
          <Label>Meta<Select className="mt-2 w-full" value={category} onChange={(event) => setCategory(event.target.value as BudgetCategoryKey | "")}><option value="">Selecionar tipo</option>{BUDGET_CATEGORIES.map((item) => <option key={item} value={item}>{BUDGET_CATEGORY_META[item].label}</option>)}</Select></Label>
          <Label>Data<Input className="mt-2" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Label>
          <Label>Mês de referência<Input className="mt-2" type="month" value={reference} onChange={(event) => setReference(event.target.value)} /></Label>
        </div>
        <div><Label>Tags</Label><div className="mt-2"><TagPicker tags={tags} selected={tagIds} onChange={setTagIds} /></div></div>
        <Label>Observação<textarea className="mt-2 min-h-24 w-full rounded-xl border bg-transparent p-3 text-sm" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Digite uma observação" /></Label>
      </div>
    </Dialog>
  );
}
