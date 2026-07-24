"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META, type BudgetCategoryKey } from "@/features/budget/constants";
import { calendarParts } from "@/lib/calendar";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  createFinanceTransactionAction,
  saveFinanceTransactionManualFxAction,
  updateFinanceTransactionAction,
} from "./actions";
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
  const selectedTags = tags.filter((tag) => selected.includes(tag.id));
  const selectionLabel = selectedTags.length === 0
    ? "Sem tags"
    : selectedTags.length === 1
      ? selectedTags[0].name
      : `${selectedTags.length} tags selecionadas`;

  return (
    <details className="group">
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border bg-[var(--card)] px-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className={cn("truncate", selectedTags.length === 0 && "text-[var(--muted-foreground)]")}>
          {selectionLabel}
        </span>
        <ChevronDown className="size-4 shrink-0 text-[var(--muted-foreground)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 grid max-h-52 gap-1 overflow-y-auto rounded-xl border bg-[var(--card)] p-2 shadow-lg sm:grid-cols-2">
        {tags.map((tag) => {
          const active = selected.includes(tag.id);
          return (
            <label key={tag.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-[var(--muted)]">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => onChange(event.target.checked ? [...selected, tag.id] : selected.filter((id) => id !== tag.id))}
                className="size-4 accent-[var(--primary)]"
              />
              <span className="size-3 shrink-0 rounded-full" style={{ background: tag.color }} />
              <span className="truncate">{tag.name}</span>
            </label>
          );
        })}
        {!tags.length && <p className="p-2 text-xs text-[var(--muted-foreground)]">Crie tags na seção Tags.</p>}
      </div>
    </details>
  );
}

type TransactionEditorDialogProps = {
  transaction: FinanceTransactionDto | null;
  accounts: FinancialAccountDto[];
  tags: FinanceTagDto[];
  timeZone?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

export function TransactionEditorDialog(props: TransactionEditorDialogProps) {
  if (!props.open || !props.transaction) return null;

  return (
    <TransactionEditorDialogContent
      key={props.transaction.id}
      {...props}
      transaction={props.transaction}
    />
  );
}

function TransactionEditorDialogContent({
  transaction,
  accounts,
  tags,
  timeZone = "America/Sao_Paulo",
  open,
  onOpenChange,
  onSaved,
}: Omit<TransactionEditorDialogProps, "transaction"> & {
  transaction: FinanceTransactionDto;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(transaction.description);
  const [accountId, setAccountId] = useState(transaction.accountId);
  const [amount, setAmount] = useState(String(Math.abs(Number(transaction.amount))));
  const [kind, setKind] = useState<"INCOME" | "EXPENSE">(transaction.kind);
  const [date, setDate] = useState(transaction.date.slice(0, 10));
  const [reference, setReference] = useState(
    monthValue(transaction.referenceYear, transaction.referenceMonth),
  );
  const [category, setCategory] = useState<BudgetCategoryKey | "">(
    transaction.budgetCategory ?? "",
  );
  const [tagIds, setTagIds] = useState<string[]>(transaction.tags.map((tag) => tag.id));
  const [note, setNote] = useState(transaction.note ?? "");
  const [manualFxRate, setManualFxRate] = useState(
    transaction.fxSource === "MANUAL" ? transaction.fxRateToBrl ?? "" : "",
  );
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const providerOwned = transaction.source === "PLUGGY";
  const hasOriginalCurrency = Boolean(
    transaction.originalAmount
    && transaction.originalCurrencyCode
    && transaction.originalCurrencyCode !== transaction.currencyCode,
  );
  async function save() {
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
      if (manualFxRate) {
        const fxOk = await runFinanceAction(
          () => saveFinanceTransactionManualFxAction({
            id: transaction.id,
            rateToBrl: Number(manualFxRate),
            rateDate: date,
          }),
          setPending,
          setNotice,
          "Taxa de câmbio salva.",
        );
        if (!fxOk) return;
      }
      onSaved?.();
      router.refresh();
      onOpenChange(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!pending}
      title={formatCurrency(transaction.amount, transaction.currencyCode)}
      description={new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone }).format(new Date(transaction.date))}
      footer={<Button onClick={save} disabled={pending}>{pending ? "Salvando…" : "Salvar alterações"}</Button>}
    >
      <div className="space-y-5">
        {notice && <FinanceNotice type={notice.type}>{notice.text}</FinanceNotice>}
        {providerOwned && (
          <div className="rounded-xl border bg-[var(--muted)]/25 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Classificação Pluggy
            </p>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <ProviderDetail
                label="Valor na moeda da conta"
                value={formatCurrency(transaction.amount, transaction.currencyCode)}
              />
              <ProviderDetail
                label="Valor reportável em BRL"
                value={transaction.reportingAmountBrl === null
                  ? "Conversão pendente"
                  : formatCurrency(transaction.reportingAmountBrl, "BRL")}
              />
              <ProviderDetail
                label="Câmbio"
                value={transaction.fxRateToBrl
                  ? `${transaction.fxRateToBrl} · ${transaction.fxSource ?? "—"}`
                  : null}
              />
              {hasOriginalCurrency && (
                <ProviderDetail
                  label="Valor original"
                  value={formatCurrency(
                    transaction.originalAmount!,
                    transaction.originalCurrencyCode!,
                  )}
                />
              )}
              <ProviderDetail label="Categoria" value={transaction.providerCategory} />
              <ProviderDetail label="ID da categoria" value={transaction.providerCategoryId} />
              <ProviderDetail label="Comerciante" value={transaction.merchantName} />
              <ProviderDetail label="Razão social" value={transaction.merchantBusinessName} />
              <ProviderDetail label="CNPJ" value={transaction.merchantCnpj} />
              <ProviderDetail label="Contraparte" value={transaction.counterpartyName} />
              <ProviderDetail label="Meio de pagamento" value={transaction.paymentMethod} />
              <ProviderDetail
                label="Origem da meta"
                value={assignmentSourceLabel(transaction.budgetCategorySource)}
              />
              <ProviderDetail
                label="Origem das tags"
                value={assignmentSourceLabel(transaction.tagAssignmentSource)}
              />
              <ProviderDetail
                label="Transferência interna"
                value={transaction.internalTransfer ? "Sim" : "Não"}
              />
              <ProviderDetail
                label="Origem da transferência"
                value={assignmentSourceLabel(transaction.internalTransferSource)}
              />
              <ProviderDetail
                label="Regra aplicada"
                value={transaction.classificationRule?.matchLabel ?? null}
              />
            </dl>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Label className="sm:col-span-2">Descrição<Input className="mt-2" value={description} disabled={providerOwned} onChange={(event) => setDescription(event.target.value)} /></Label>
          <Label>Conta<Select className="mt-2 w-full" value={accountId} disabled={providerOwned} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></Label>
          <Label>Tipo<Select className="mt-2 w-full" value={kind} disabled={providerOwned} onChange={(event) => setKind(event.target.value as "INCOME" | "EXPENSE")}><option value="EXPENSE">Saída</option><option value="INCOME">Entrada</option></Select></Label>
          <Label>Quantia<Input className="mt-2" type="number" min="0.01" step="0.01" value={amount} disabled={providerOwned} onChange={(event) => setAmount(event.target.value)} /></Label>
          <Label>Data<Input className="mt-2" type="date" value={date} disabled={providerOwned} onChange={(event) => setDate(event.target.value)} /></Label>
          <Label>Meta<Select className="mt-2 w-full" value={category} onChange={(event) => setCategory(event.target.value as BudgetCategoryKey | "")}><option value="">Sem meta</option>{BUDGET_CATEGORIES.map((item) => <option key={item} value={item}>{BUDGET_CATEGORY_META[item].label}</option>)}</Select></Label>
          <Label>Mês de referência<Input className="mt-2" type="month" value={reference} onChange={(event) => setReference(event.target.value)} /></Label>
        </div>
        {transaction.currencyCode !== "BRL" && (
          <Label>
            Taxa manual para BRL
            <Input
              className="mt-2"
              type="number"
              min="0.00000001"
              step="0.00000001"
              value={manualFxRate}
              onChange={(event) => setManualFxRate(event.target.value)}
              placeholder={transaction.reportingAmountBrl === null
                ? "Obrigatória enquanto não houver cotação histórica"
                : "Preencha somente para substituir o câmbio automático"}
            />
          </Label>
        )}
        <div><Label>Tags</Label><div className="mt-2"><TagPicker tags={tags} selected={tagIds} onChange={setTagIds} /></div></div>
        <Label>Observação<textarea className="mt-2 min-h-24 w-full rounded-xl border bg-transparent p-3 text-sm" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Digite uma observação" /></Label>
      </div>
    </Dialog>
  );
}

function assignmentSourceLabel(source: FinanceTransactionDto["budgetCategorySource"]) {
  return {
    UNASSIGNED: "Não classificada",
    PROVIDER_DEFAULT: "Categoria Pluggy",
    USER_RULE: "Regra pessoal",
    MANUAL: "Definida manualmente",
  }[source];
}

function ProviderDetail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{value || "—"}</dd>
    </div>
  );
}

type NewTransactionDialogProps = {
  accounts: FinancialAccountDto[];
  tags: FinanceTagDto[];
  year: number;
  month: number;
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

export function NewTransactionDialog(props: NewTransactionDialogProps) {
  if (!props.open) return null;

  return <NewTransactionDialogContent {...props} />;
}

function NewTransactionDialogContent({
  accounts,
  tags,
  year,
  month,
  timeZone,
  open,
  onOpenChange,
  onSaved,
}: NewTransactionDialogProps) {
  const router = useRouter();
  const [kind, setKind] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => {
    const today = calendarParts(new Date(), timeZone);
    return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  });
  const [reference, setReference] = useState(monthValue(year, month));
  const [category, setCategory] = useState<BudgetCategoryKey | "">("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const valid = useMemo(() => description.trim().length >= 2 && accountId && Number(amount) > 0 && date && reference, [description, accountId, amount, date, reference]);

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
      onSaved?.();
      router.refresh();
      onOpenChange(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!pending}
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
