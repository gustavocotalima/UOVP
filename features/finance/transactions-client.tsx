"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CopyCheck,
  Download,
  FileText,
  Filter,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META, type BudgetCategoryKey } from "@/features/budget/constants";
import { formatCurrency, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  applyFinanceTransactionClassificationToSimilarAction,
  deleteFinanceTransactionAction,
  saveFinanceTransactionNoteAction,
  setFinanceTransactionsIgnoredAction,
  toggleFinanceInternalTransferAction,
  updateFinanceTransactionCategoryAction,
  updateFinanceTransactionTagsAction,
} from "./actions";
import { calculatePeriod, isReportable, needsFinanceClassification } from "./calculations";
import { FinanceNotice, runFinanceAction } from "./shared";
import { NewTransactionDialog, TransactionEditorDialog } from "./transaction-dialogs";
import type { FinanceData, FinanceTransactionDto } from "./types";

type Filters = {
  min: string;
  max: string;
  kind: "" | "INCOME" | "EXPENSE";
  category: "" | "NONE" | BudgetCategoryKey;
  tagId: "" | "NONE" | string;
  assignmentSource: "" | FinanceTransactionDto["budgetCategorySource"];
  accountId: string;
  ignored: "" | "yes" | "no";
  internal: "" | "yes" | "no";
};

const EMPTY_FILTERS: Filters = { min: "", max: "", kind: "", category: "", tagId: "", assignmentSource: "", accountId: "", ignored: "", internal: "no" };

export function TransactionsClient({ data }: { data: FinanceData }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceTransactionDto | null>(null);
  const [tagging, setTagging] = useState<FinanceTransactionDto | null>(null);
  const [tagSelection, setTagSelection] = useState<string[]>([]);
  const [noting, setNoting] = useState<FinanceTransactionDto | null>(null);
  const [note, setNote] = useState("");
  const [deleting, setDeleting] = useState<FinanceTransactionDto | null>(null);
  const [applyingSimilar, setApplyingSimilar] = useState<FinanceTransactionDto | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{ key: "description" | "amount" | "date" | "account"; direction: "asc" | "desc" }>({ key: "date", direction: "desc" });
  const [reviewingAllPeriods, setReviewingAllPeriods] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    const scopedTransactions = reviewingAllPeriods
      ? data.historyTransactions.filter(needsFinanceClassification)
      : data.transactions;
    return scopedTransactions
      .filter((transaction) => {
        const value = Number(transaction.amount);
        if (query && !`${transaction.description} ${transaction.merchantName ?? ""} ${transaction.accountName} ${transaction.note ?? ""}`.toLocaleLowerCase("pt-BR").includes(query)) return false;
        if (filters.min && Math.abs(value) < Number(filters.min)) return false;
        if (filters.max && Math.abs(value) > Number(filters.max)) return false;
        if (filters.kind && transaction.kind !== filters.kind) return false;
        if (filters.category === "NONE" && transaction.budgetCategory) return false;
        if (filters.category && filters.category !== "NONE" && transaction.budgetCategory !== filters.category) return false;
        if (filters.tagId === "NONE" && transaction.tags.length) return false;
        if (filters.tagId && filters.tagId !== "NONE" && !transaction.tags.some((tag) => tag.id === filters.tagId)) return false;
        if (filters.assignmentSource && transaction.budgetCategorySource !== filters.assignmentSource) return false;
        if (filters.accountId && transaction.accountId !== filters.accountId) return false;
        if (filters.ignored === "yes" && isReportable(transaction)) return false;
        if (filters.ignored === "no" && !isReportable(transaction)) return false;
        if (filters.internal === "yes" && !transaction.internalTransfer) return false;
        if (filters.internal === "no" && transaction.internalTransfer) return false;
        return true;
      })
      .sort((left, right) => {
        const direction = sort.direction === "asc" ? 1 : -1;
        if (sort.key === "amount") return (Number(left.amount) - Number(right.amount)) * direction;
        if (sort.key === "date") return left.date.localeCompare(right.date) * direction;
        return (sort.key === "description" ? left.description.localeCompare(right.description) : left.accountName.localeCompare(right.accountName)) * direction;
      });
  }, [data.historyTransactions, data.transactions, filters, reviewingAllPeriods, search, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const totals = useMemo(() => calculatePeriod(filtered), [filtered]);
  const activeFilterCount = (Object.keys(filters) as Array<keyof Filters>)
    .filter((key) => filters[key] !== EMPTY_FILTERS[key])
    .length;

  function changeSort(key: typeof sort.key) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  async function updateCategory(transaction: FinanceTransactionDto, category: string) {
    const ok = await runFinanceAction(() => updateFinanceTransactionCategoryAction(transaction.id, (category || null) as BudgetCategoryKey | null), setPending, setNotice, "Meta atualizada.");
    if (ok) router.refresh();
  }

  async function saveTags() {
    if (!tagging) return;
    const ok = await runFinanceAction(() => updateFinanceTransactionTagsAction(tagging.id, tagSelection), setPending, setNotice, "Tags atualizadas.");
    if (ok) {
      setTagging(null);
      router.refresh();
    }
  }

  async function saveNote() {
    if (!noting) return;
    const ok = await runFinanceAction(() => saveFinanceTransactionNoteAction(noting.id, note), setPending, setNotice, "Observação salva.");
    if (ok) {
      setNoting(null);
      router.refresh();
    }
  }

  async function setIgnored(ids: string[], ignored: boolean) {
    const ok = await runFinanceAction(() => setFinanceTransactionsIgnoredAction(ids, ignored), setPending, setNotice, ignored ? "Transações ocultadas dos relatórios." : "Transações incluídas nos relatórios.");
    if (ok) {
      setSelected([]);
      router.refresh();
    }
  }

  async function toggleInternal(transaction: FinanceTransactionDto) {
    const ok = await runFinanceAction(() => toggleFinanceInternalTransferAction(transaction.id), setPending, setNotice, transaction.internalTransfer ? "Marcação de transferência removida." : "Marcada como transferência interna.");
    if (ok) {
      setMenu(null);
      router.refresh();
    }
  }

  async function applyToSimilar() {
    if (!applyingSimilar) return;
    const ok = await runFinanceAction(
      () => applyFinanceTransactionClassificationToSimilarAction(applyingSimilar.id),
      setPending,
      setNotice,
      "Regra pessoal criada e aplicada às transações semelhantes.",
    );
    if (ok) {
      setApplyingSimilar(null);
      router.refresh();
    }
  }

  async function remove() {
    if (!deleting) return;
    const ok = await runFinanceAction(() => deleteFinanceTransactionAction(deleting.id), setPending, setNotice, "Transação removida.");
    if (ok) {
      setDeleting(null);
      router.refresh();
    }
  }

  async function syncImport() {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/pluggy/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        classification?: {
          metasAssigned: number;
          tagsAssigned: number;
          internalTransfersDetected: number;
          unclassified: number;
        };
      };
      if (!response.ok) throw new Error(payload.error || "Não foi possível importar as transações.");
      const classification = payload.classification;
      setNotice({
        type: "success",
        text: classification
          ? `Transações atualizadas: ${classification.metasAssigned} com meta, ${classification.tagsAssigned} com tags, ${classification.internalTransfersDetected} transferências internas e ${classification.unclassified} pendentes.`
          : "Transações importadas e atualizadas.",
      });
      setImportOpen(false);
      router.refresh();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Não foi possível importar as transações." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      {notice && <FinanceNotice type={notice.type}>{notice.text}</FinanceNotice>}
      {data.unclassifiedTransactionCount > 0 && !reviewingAllPeriods && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--primary)]/35 bg-[var(--primary)]/8 p-4">
          <div>
            <strong className="text-sm">{data.unclassifiedTransactionCount} transações precisam de classificação</strong>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">A Pluggy não forneceu dados suficientes para atribuir uma meta com segurança.</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setReviewingAllPeriods(true);
              setSearch("");
              setFilters(EMPTY_FILTERS);
              setDraftFilters(EMPTY_FILTERS);
              setSelected([]);
              setPage(1);
            }}
          >
            Revisar agora
          </Button>
        </div>
      )}
      {reviewingAllPeriods && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-[var(--card)] p-4">
          <div>
            <strong className="text-sm">Pendências de todos os períodos</strong>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Exibindo as {data.unclassifiedTransactionCount} transações que ainda precisam de classificação.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setReviewingAllPeriods(false);
              setSearch("");
              setFilters(EMPTY_FILTERS);
              setDraftFilters(EMPTY_FILTERS);
              setSelected([]);
              setPage(1);
            }}
          >
            Voltar para o período selecionado
          </Button>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setImportOpen(true)}><Download className="size-4" /> Importar transações</Button>
        <Button onClick={() => setNewOpen(true)} disabled={!data.accounts.length}><Plus className="size-4" /> Nova transação</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Filtros e Busca</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-3.5 size-4 text-[var(--muted-foreground)]" aria-hidden="true" /><Input className="pl-9" aria-label="Pesquisar transação" placeholder="Pesquisar transação" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
          <Button variant="outline" onClick={() => { setDraftFilters(filters); setFiltersOpen(true); }}><Filter className="size-4" /> Mais filtros {activeFilterCount > 0 && <span className="rounded-full bg-[var(--primary)] px-1.5 text-[10px] text-[var(--primary-foreground)]">{activeFilterCount}</span>}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><CardTitle>Transações</CardTitle><p className="mt-1 text-sm text-[var(--muted-foreground)]">Um total de {filtered.length} transações encontradas</p></div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[450px]">
            <MiniTotal label="Entradas" value={totals.income} tone="success" />
            <MiniTotal label="Saídas" value={totals.spent} tone="danger" />
            <MiniTotal label="Saldo" value={totals.balance} tone={totals.balance < 0 ? "danger" : "default"} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--muted)] p-3">
            <Switch
              aria-label="Ocultar transações selecionadas dos relatórios"
              disabled={!selected.length || pending}
              checked={selected.length > 0 && selected.every((id) => {
                const transaction = data.historyTransactions.find((item) => item.id === id);
                return transaction ? !isReportable(transaction) : false;
              })}
              onCheckedChange={(checked) => setIgnored(selected, checked)}
            />
            <div><strong className="text-sm">Ocultar dos Relatórios:</strong><p className="text-xs text-[var(--muted-foreground)]">Selecione transações e use este toggle para excluí-las das análises financeiras.</p></div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="border-b text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="pb-3 pr-3"><input type="checkbox" aria-label="Selecionar todos" checked={visible.length > 0 && visible.every((item) => selected.includes(item.id))} onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map((item) => item.id)])] : selected.filter((id) => !visible.some((item) => item.id === id)))} /></th>
                  <SortHeader label="Descrição" active={sort.key === "description"} direction={sort.direction} onClick={() => changeSort("description")} />
                  <SortHeader label="Valor" active={sort.key === "amount"} direction={sort.direction} onClick={() => changeSort("amount")} />
                  <SortHeader label="Data" active={sort.key === "date"} direction={sort.direction} onClick={() => changeSort("date")} />
                  <th className="pb-3">Mês de referência</th>
                  <SortHeader label="Conta" active={sort.key === "account"} direction={sort.direction} onClick={() => changeSort("account")} />
                  <th className="pb-3">Meta</th><th className="pb-3">Tags</th><th className="pb-3">Ocultar</th><th className="pb-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((transaction) => (
                  <tr key={transaction.id} className={cn(!isReportable(transaction) && "opacity-55")}>
                    <td className="py-3 pr-3"><input type="checkbox" aria-label={`Selecionar ${transaction.description}`} checked={selected.includes(transaction.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, transaction.id] : selected.filter((id) => id !== transaction.id))} /></td>
                    <td className="max-w-[280px] py-3 pr-4"><p className="truncate font-medium">{transaction.description}</p><button type="button" className="mt-1 text-[11px] text-[var(--primary)] hover:underline" onClick={() => { setNoting(transaction); setNote(transaction.note ?? ""); }}>{transaction.note ? transaction.note : "+ Adicionar observação"}</button></td>
                    <td className={cn("py-3 pr-4 font-semibold", transaction.kind === "INCOME" && "text-[var(--success)]")}>
                      <span>{formatCurrency(transaction.amount, transaction.currencyCode)}</span>
                      {transaction.originalAmount
                        && transaction.originalCurrencyCode
                        && transaction.originalCurrencyCode !== transaction.currencyCode && (
                          <small className="mt-1 block font-normal text-[var(--muted-foreground)]">
                            Original: {formatCurrency(
                              transaction.originalAmount,
                              transaction.originalCurrencyCode,
                            )}
                          </small>
                        )}
                    </td>
                    <td className="py-3 pr-4 text-xs">{new Intl.DateTimeFormat("pt-BR").format(new Date(transaction.date))}</td>
                    <td className="py-3 pr-4 text-xs">{new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(transaction.referenceYear, transaction.referenceMonth - 1, 1))}</td>
                    <td className="max-w-[170px] py-3 pr-4"><p className="truncate text-xs font-medium">{transaction.accountName}</p><p className="truncate text-[10px] text-[var(--muted-foreground)]">{transaction.institutionName}</p></td>
                    <td className="py-3 pr-4"><Select className="h-9 max-w-40" value={transaction.budgetCategory ?? ""} onChange={(event) => updateCategory(transaction, event.target.value)} disabled={pending}><option value="">Sem meta</option>{BUDGET_CATEGORIES.map((category) => <option key={category} value={category}>{BUDGET_CATEGORY_META[category].label}</option>)}</Select><AssignmentSource source={transaction.budgetCategorySource} /></td>
                    <td className="py-3 pr-4">
                      <button
                        type="button"
                        onClick={() => {
                          setTagging(transaction);
                          setTagSelection(transaction.tags.map((tag) => tag.id));
                        }}
                        className="flex h-9 w-40 items-center justify-between gap-2 rounded-xl border bg-[var(--card)] px-3 text-left text-xs"
                      >
                        <span className="truncate">
                          {transaction.tags.length === 0
                            ? "Sem tags"
                            : transaction.tags.length === 1
                              ? transaction.tags[0].name
                              : `${transaction.tags.length} tags`}
                        </span>
                        <ChevronDown className="size-4 shrink-0 text-[var(--muted-foreground)]" />
                      </button>
                      <AssignmentSource source={transaction.tagAssignmentSource} />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-col items-start gap-1">
                        <Switch
                          aria-label={transaction.internalTransfer
                            ? `${transaction.description} está ocultada por ser uma transferência interna`
                            : `${transaction.ignored ? "Incluir" : "Ocultar"} ${transaction.description} nos relatórios`}
                          checked={!isReportable(transaction)}
                          onCheckedChange={(checked) => setIgnored([transaction.id], checked)}
                          disabled={pending || transaction.internalTransfer}
                          title={transaction.internalTransfer
                            ? "Transferências internas são ocultadas automaticamente. Remova a marcação no menu de ações para incluí-la."
                            : undefined}
                        />
                        {transaction.internalTransfer && (
                          <span className="text-[9px] text-[var(--muted-foreground)]">Interna</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <ActionMenu
                        open={menu === transaction.id}
                        onOpenChange={(open) => setMenu(open ? transaction.id : null)}
                        label={`Ações de ${transaction.description}`}
                      >
                        <MenuButton icon={Pencil} label="Editar" onClick={() => { setEditing(transaction); setMenu(null); }} />
                        <MenuButton icon={FileText} label="Ver detalhes" onClick={() => { setEditing(transaction); setMenu(null); }} />
                        {transaction.source === "PLUGGY" && (
                          <MenuButton icon={CopyCheck} label="Aplicar às semelhantes" onClick={() => { setApplyingSimilar(transaction); setMenu(null); }} />
                        )}
                        <div role="separator" className="my-1 border-t" />
                        <MenuButton icon={ArrowDown} label={transaction.internalTransfer ? "Remover transferência interna" : "Marcar como transferência interna"} onClick={() => toggleInternal(transaction)} />
                        <div role="separator" className="my-1 border-t" />
                        <MenuButton icon={Trash2} label="Deletar" danger onClick={() => { setDeleting(transaction); setMenu(null); }} />
                      </ActionMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">Nenhuma transação encontrada.</div>}
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--muted-foreground)]">Mostrando {filtered.length ? (safePage - 1) * pageSize + 1 : 0}-{Math.min(safePage * pageSize, filtered.length)} de {filtered.length}</p>
            <div className="flex items-center gap-2"><Label htmlFor="transactions-page-size" className="text-xs text-[var(--muted-foreground)]">Itens por página:</Label><Select id="transactions-page-size" className="h-9" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></Select><Button variant="ghost" size="icon" aria-label="Página anterior" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><ChevronLeft className="size-4" /></Button><span className="text-xs" aria-live="polite">Página {safePage} de {totalPages}</span><Button variant="ghost" size="icon" aria-label="Próxima página" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}><ChevronRight className="size-4" /></Button></div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen} title="Filtros Avançados" description="Personalize a visualização das suas transações" footer={<><Button variant="outline" onClick={() => setDraftFilters(EMPTY_FILTERS)}>Limpar Tudo</Button><Button onClick={() => { setFilters(draftFilters); setFiltersOpen(false); setPage(1); }}>Aplicar Filtros</Button></>}>
        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Faixa de Valor</legend><div className="mt-2 grid grid-cols-2 gap-3"><Input type="number" min="0" aria-label="Valor mínimo" placeholder="Valor mínimo" value={draftFilters.min} onChange={(event) => setDraftFilters({ ...draftFilters, min: event.target.value })} /><Input type="number" min="0" aria-label="Valor máximo" placeholder="Valor máximo" value={draftFilters.max} onChange={(event) => setDraftFilters({ ...draftFilters, max: event.target.value })} /></div></fieldset>
          <FilterSelect label="Tipo de Transação" value={draftFilters.kind} onChange={(value) => setDraftFilters({ ...draftFilters, kind: value as Filters["kind"] })} options={[["", "Todos"], ["INCOME", "Receitas"], ["EXPENSE", "Despesas"]]} />
          <FilterSelect label="Metas" value={draftFilters.category} onChange={(value) => setDraftFilters({ ...draftFilters, category: value as Filters["category"] })} options={[["", "Todas"], ["NONE", "Sem meta"], ...BUDGET_CATEGORIES.map((category) => [category, BUDGET_CATEGORY_META[category].label] as [string, string])]} />
          <FilterSelect label="Tags" value={draftFilters.tagId} onChange={(value) => setDraftFilters({ ...draftFilters, tagId: value })} options={[["", "Todas"], ["NONE", "Sem tag"], ...data.tags.map((tag) => [tag.id, tag.name] as [string, string])]} />
          <FilterSelect label="Origem da classificação" value={draftFilters.assignmentSource} onChange={(value) => setDraftFilters({ ...draftFilters, assignmentSource: value as Filters["assignmentSource"] })} options={[["", "Todas"], ["UNASSIGNED", "Não classificada"], ["PROVIDER_DEFAULT", "Categoria Pluggy"], ["USER_RULE", "Regra pessoal"], ["MANUAL", "Manual"]]} />
          <FilterSelect label="Contas" value={draftFilters.accountId} onChange={(value) => setDraftFilters({ ...draftFilters, accountId: value })} options={[["", "Todas"], ...data.accounts.map((account) => [account.id, account.name] as [string, string])]} />
          <FilterSelect label="Ocultar dos Relatórios" value={draftFilters.ignored} onChange={(value) => setDraftFilters({ ...draftFilters, ignored: value as Filters["ignored"] })} options={[["", "Todos"], ["yes", "Ocultadas"], ["no", "Visíveis"]]} />
          <FilterSelect label="Transf. de Mesma Titularidade (Internas)" value={draftFilters.internal} onChange={(value) => setDraftFilters({ ...draftFilters, internal: value as Filters["internal"] })} options={[["", "Todas"], ["yes", "Somente internas"], ["no", "Excluir internas"]]} />
        </div>
      </Dialog>

      <NewTransactionDialog accounts={data.accounts} tags={data.tags} year={data.year} month={data.month} open={newOpen} onOpenChange={setNewOpen} />
      <TransactionEditorDialog transaction={editing} accounts={data.accounts} tags={data.tags} open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)} />

      <Dialog open={Boolean(tagging)} onOpenChange={(open) => !open && setTagging(null)} title="Selecionar tags" footer={<Button onClick={saveTags} disabled={pending}>Salvar</Button>}>
        <div className="grid gap-2 sm:grid-cols-2">{data.tags.map((tag) => <label key={tag.id} className="flex items-center gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={tagSelection.includes(tag.id)} onChange={(event) => setTagSelection(event.target.checked ? [...tagSelection, tag.id] : tagSelection.filter((id) => id !== tag.id))} /><span className="size-3 rounded-full" style={{ background: tag.color }} />{tag.name}</label>)}</div>
      </Dialog>

      <Dialog open={Boolean(noting)} onOpenChange={(open) => !open && setNoting(null)} title="Observação" description={noting?.description} footer={<Button onClick={saveNote} disabled={pending}>Salvar</Button>}>
        <textarea aria-label="Observação da transação" className="min-h-40 w-full rounded-xl border bg-transparent p-3 text-sm" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Digite uma observação" />
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen} title="Importar Transações" description="Importe e atualize as transações das instituições conectadas." footer={<><Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button><Button onClick={syncImport} disabled={pending || !data.pluggy.itemCount}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />} Iniciar Importação</Button></>}>
        <p className="text-sm leading-6 text-[var(--muted-foreground)]">Ao confirmar, as transações de todas as conexões Pluggy serão atualizadas. As classificações, tags, observações e preferências locais serão preservadas.</p>
      </Dialog>

      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title="Deletar transação?" description={deleting?.source === "PLUGGY" ? "A transação sincronizada será ocultada e não voltará nas próximas sincronizações." : "A transação manual será removida e o saldo da conta será recalculado."} confirmLabel="Deletar" danger pending={pending} onConfirm={remove} />
      <ConfirmDialog
        open={Boolean(applyingSimilar)}
        onOpenChange={(open) => !open && setApplyingSimilar(null)}
        title="Aplicar às transações semelhantes?"
        description="Será criada uma regra exata usando o comerciante, a contraparte ou a descrição. A meta, as tags e a marcação de transferência interna atuais serão aplicadas às transações correspondentes."
        confirmLabel="Aplicar às semelhantes"
        pending={pending}
        onConfirm={applyToSimilar}
      />
    </div>
  );
}

function AssignmentSource({ source }: { source: FinanceTransactionDto["budgetCategorySource"] }) {
  if (source === "UNASSIGNED") return null;
  const label = {
    PROVIDER_DEFAULT: "Pluggy",
    USER_RULE: "Regra pessoal",
    MANUAL: "Manual",
  }[source];
  return <small className="mt-1 block text-[9px] text-[var(--muted-foreground)]">{label}</small>;
}

function MiniTotal({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "default" }) {
  return <div className="rounded-xl bg-[var(--muted)] px-3 py-2"><p className="text-[10px] text-[var(--muted-foreground)]">{label}</p><p className={cn("mt-1 text-sm font-semibold", tone === "success" && "text-[var(--success)]", tone === "danger" && "text-[var(--danger)]")}>{formatMoney(value)}</p></div>;
}

function SortHeader({ label, active, direction, onClick }: { label: string; active: boolean; direction: "asc" | "desc"; onClick: () => void }) {
  return <th className="pb-3 pr-4" aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}><button type="button" onClick={onClick} className="flex items-center gap-1">{label}{active && (direction === "asc" ? <ArrowUp className="size-3" aria-hidden="true" /> : <ArrowDown className="size-3" aria-hidden="true" />)}</button></th>;
}

function MenuButton({ icon: Icon, label, onClick, danger = false }: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" role="menuitem" tabIndex={-1} onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-[var(--muted)]", danger && "text-[var(--danger)]")}><Icon className="size-4" aria-hidden="true" />{label}</button>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <Label>{label}<Select className="mt-2 w-full" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue || "all"} value={optionValue}>{optionLabel}</option>)}</Select></Label>;
}
