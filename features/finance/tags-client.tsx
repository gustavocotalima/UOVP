"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  createFinanceDescriptionPrefixRuleAction,
  createFinanceTagAction,
  deleteFinanceClassificationRuleAction,
  deleteFinanceTagAction,
  updateFinanceClassificationRuleAction,
  updateFinanceTagAction,
} from "./actions";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_META, type BudgetCategoryKey } from "@/features/budget/constants";
import { FinanceNotice, runFinanceAction } from "./shared";
import type { FinanceClassificationRuleDto, FinanceTagDto } from "./types";

type RuleMetaMode = "KEEP" | "CLEAR" | BudgetCategoryKey;

export function TagsClient({
  tags,
  rules,
}: {
  tags: FinanceTagDto[];
  rules: FinanceClassificationRuleDto[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<FinanceTagDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [deleting, setDeleting] = useState<FinanceTagDto | null>(null);
  const [editingRule, setEditingRule] = useState<FinanceClassificationRuleDto | null>(null);
  const [deletingRule, setDeletingRule] = useState<FinanceClassificationRuleDto | null>(null);
  const [prefixRuleOpen, setPrefixRuleOpen] = useState(false);
  const [prefixValue, setPrefixValue] = useState("");
  const [prefixKind, setPrefixKind] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [prefixMetaMode, setPrefixMetaMode] = useState<RuleMetaMode>("KEEP");
  const [prefixTagIds, setPrefixTagIds] = useState<string[]>([]);
  const [ruleEnabled, setRuleEnabled] = useState(true);
  const [ruleMetaMode, setRuleMetaMode] = useState<RuleMetaMode>("KEEP");
  const [ruleAssignsTags, setRuleAssignsTags] = useState(false);
  const [ruleTagIds, setRuleTagIds] = useState<string[]>([]);
  const [ruleAssignsInternal, setRuleAssignsInternal] = useState(false);
  const [ruleInternal, setRuleInternal] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setColor("#3b82f6");
    setFormOpen(true);
  }

  function openEdit(tag: FinanceTagDto) {
    setEditing(tag);
    setName(tag.name);
    setColor(tag.color);
    setFormOpen(true);
  }

  async function save() {
    const ok = await runFinanceAction(
      () => editing ? updateFinanceTagAction({ id: editing.id, name, color }) : createFinanceTagAction({ name, color }),
      setPending,
      setNotice,
      editing ? "Tag atualizada." : "Tag criada.",
    );
    if (ok) {
      setFormOpen(false);
      router.refresh();
    }
  }

  async function remove() {
    if (!deleting) return;
    const ok = await runFinanceAction(() => deleteFinanceTagAction(deleting.id), setPending, setNotice, "Tag excluída.");
    if (ok) {
      setDeleting(null);
      router.refresh();
    }
  }

  function openRule(rule: FinanceClassificationRuleDto) {
    setEditingRule(rule);
    setRuleEnabled(rule.enabled);
    setRuleMetaMode(
      rule.assignsBudgetCategory
        ? rule.budgetCategory ?? "CLEAR"
        : "KEEP",
    );
    setRuleAssignsTags(rule.assignsTags);
    setRuleTagIds(rule.tags.map((tag) => tag.id));
    setRuleAssignsInternal(rule.assignsInternalTransfer);
    setRuleInternal(rule.internalTransfer);
  }

  async function saveRule() {
    if (!editingRule) return;
    const ok = await runFinanceAction(
      () => updateFinanceClassificationRuleAction({
        id: editingRule.id,
        enabled: ruleEnabled,
        assignsBudgetCategory: ruleMetaMode !== "KEEP",
        budgetCategory:
          ruleMetaMode === "KEEP" || ruleMetaMode === "CLEAR"
            ? null
            : ruleMetaMode,
        assignsTags: ruleAssignsTags,
        tagIds: ruleAssignsTags ? ruleTagIds : [],
        assignsInternalTransfer: ruleAssignsInternal,
        internalTransfer: ruleInternal,
      }),
      setPending,
      setNotice,
      "Regra automática atualizada.",
    );
    if (ok) {
      setEditingRule(null);
      router.refresh();
    }
  }

  function openPrefixRule() {
    setPrefixValue("");
    setPrefixKind("EXPENSE");
    setPrefixMetaMode("KEEP");
    setPrefixTagIds([]);
    setPrefixRuleOpen(true);
  }

  async function savePrefixRule() {
    const ok = await runFinanceAction(
      () => createFinanceDescriptionPrefixRuleAction({
        prefix: prefixValue,
        kind: prefixKind,
        assignsBudgetCategory: prefixMetaMode !== "KEEP",
        budgetCategory:
          prefixMetaMode === "KEEP" || prefixMetaMode === "CLEAR"
            ? null
            : prefixMetaMode,
        tagIds: prefixTagIds,
      }),
      setPending,
      setNotice,
      "Regra por prefixo criada e aplicada.",
    );
    if (ok) {
      setPrefixRuleOpen(false);
      router.refresh();
    }
  }

  async function removeRule() {
    if (!deletingRule) return;
    const ok = await runFinanceAction(
      () => deleteFinanceClassificationRuleAction(deletingRule.id),
      setPending,
      setNotice,
      "Regra automática excluída.",
    );
    if (ok) {
      setDeletingRule(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-5">
      {notice && <FinanceNotice type={notice.type}>{notice.text}</FinanceNotice>}
      <div className="flex items-center justify-between"><p className="text-sm text-[var(--muted-foreground)]">{tags.length} tags encontradas</p><Button onClick={openCreate}><Plus className="size-4" /> Criar Tag</Button></div>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-[var(--muted)]/40 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><tr><th className="w-14 p-4"></th><th className="p-4">Tag</th><th className="p-4 text-right">Ações</th></tr></thead>
            <tbody className="divide-y">
              {tags.map((tag) => <tr key={tag.id}><td className="p-4"><span className="block size-5 rounded-md" style={{ background: tag.color }} /></td><td className="p-4 font-medium">{tag.name}{tag.systemKey && <small className="ml-2 text-[10px] font-normal text-[var(--muted-foreground)]">Padrão</small>}</td><td className="p-4"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label="Editar tag" onClick={() => openEdit(tag)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" aria-label="Excluir tag" disabled={Boolean(tag.systemKey)} onClick={() => setDeleting(tag)}><Trash2 className="size-4" /></Button></div></td></tr>)}
            </tbody>
          </table>
          {!tags.length && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">Nenhuma tag criada.</p>}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Bot className="size-5" /> Regras automáticas</CardTitle>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Regras pessoais aprendidas ou criadas para classificar transações semelhantes.
              </p>
            </div>
            <Button variant="outline" onClick={openPrefixRule}><Plus className="size-4" /> Nova regra</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-y bg-[var(--muted)]/40 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr><th className="p-4">Correspondência</th><th className="p-4">Resultado</th><th className="p-4">Aplicações</th><th className="p-4">Status</th><th className="p-4 text-right">Ações</th></tr>
              </thead>
              <tbody className="divide-y">
                {rules.map((rule) => (
                  <tr key={rule.id} className={!rule.enabled ? "opacity-55" : undefined}>
                    <td className="p-4">
                      <strong>{rule.matchLabel}</strong>
                      <small className="mt-1 block text-[10px] text-[var(--muted-foreground)]">{ruleMatchLabel(rule.matchType)} · {rule.kind === "EXPENSE" ? "Saída" : "Entrada"}</small>
                    </td>
                    <td className="p-4 text-xs">{ruleResult(rule)}</td>
                    <td className="p-4">{rule.appliedCount}</td>
                    <td className="p-4"><span className={rule.enabled ? "text-[var(--success)]" : "text-[var(--muted-foreground)]"}>{rule.enabled ? "Ativa" : "Desativada"}</span></td>
                    <td className="p-4"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label="Editar regra" onClick={() => openRule(rule)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" aria-label="Excluir regra" onClick={() => setDeletingRule(rule)}><Trash2 className="size-4" /></Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rules.length && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">Nenhuma regra pessoal foi criada.</p>}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen} title={editing ? "Editar Tag" : "Criar Tag"} footer={<Button onClick={save} disabled={pending || !name.trim()}>{pending ? "Salvando…" : "Salvar"}</Button>}>
        <div className="space-y-5">
          <Label>Nome<Input className="mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Digite o nome da tag" /></Label>
          <div><Label>Cor da Tag</Label><div className="mt-2 flex items-center gap-3"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="size-11 cursor-pointer rounded-lg border bg-transparent p-1" /><Input value={color} onChange={(event) => setColor(event.target.value)} pattern="^#[0-9a-fA-F]{6}$" /></div></div>
          <div className="rounded-xl border p-3"><span className="rounded-full px-3 py-1.5 text-sm font-medium text-white" style={{ background: color }}>{name || "Nome"}</span></div>
        </div>
      </Dialog>
      <Dialog
        open={prefixRuleOpen}
        onOpenChange={setPrefixRuleOpen}
        title="Nova regra automática"
        description="Classifique transações cuja descrição começa sempre com o mesmo texto."
        footer={
          <Button
            onClick={savePrefixRule}
            disabled={
              pending
              || prefixValue.trim().length < 2
              || (prefixMetaMode === "KEEP" && prefixTagIds.length === 0)
            }
          >
            {pending ? "Aplicando…" : "Criar e aplicar"}
          </Button>
        }
      >
        <div className="space-y-5">
          <div>
            <Label htmlFor="rule-prefix">Descrição começa com</Label>
            <Input
              id="rule-prefix"
              className="mt-2"
              value={prefixValue}
              onChange={(event) => setPrefixValue(event.target.value)}
              placeholder="Ex: CREDITO RESGATE FUNDO"
              maxLength={120}
              autoFocus
            />
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              A regra aceita qualquer continuação. O asterisco final é opcional: IF e IF* produzem a mesma regra.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label>Tipo de transação<Select className="mt-2 w-full" value={prefixKind} onChange={(event) => setPrefixKind(event.target.value as "INCOME" | "EXPENSE")}><option value="EXPENSE">Saída</option><option value="INCOME">Entrada</option></Select></Label>
            <Label>Meta<Select className="mt-2 w-full" value={prefixMetaMode} onChange={(event) => setPrefixMetaMode(event.target.value as RuleMetaMode)}><option value="KEEP">Não alterar</option><option value="CLEAR">Sem meta</option>{BUDGET_CATEGORIES.map((category) => <option key={category} value={category}>{BUDGET_CATEGORY_META[category].label}</option>)}</Select></Label>
          </div>
          <div className="space-y-3">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const active = prefixTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPrefixTagIds(active ? prefixTagIds.filter((id) => id !== tag.id) : [...prefixTagIds, tag.id])}
                    className="rounded-full border px-3 py-1.5 text-xs font-medium"
                    style={active ? { background: tag.color, color: "white", borderColor: "transparent" } : undefined}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Dialog>
      <Dialog open={Boolean(editingRule)} onOpenChange={(open) => !open && setEditingRule(null)} title="Editar regra automática" description={editingRule?.matchLabel} footer={<Button onClick={saveRule} disabled={pending}>{pending ? "Salvando…" : "Salvar regra"}</Button>}>
        <div className="space-y-5">
          <label className="flex items-center gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={ruleEnabled} onChange={(event) => setRuleEnabled(event.target.checked)} /> Regra ativa</label>
          <Label>Meta<Select className="mt-2 w-full" value={ruleMetaMode} onChange={(event) => setRuleMetaMode(event.target.value as RuleMetaMode)}><option value="KEEP">Não alterar</option><option value="CLEAR">Sem meta</option>{BUDGET_CATEGORIES.map((category) => <option key={category} value={category}>{BUDGET_CATEGORY_META[category].label}</option>)}</Select></Label>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ruleAssignsTags} onChange={(event) => setRuleAssignsTags(event.target.checked)} /> Definir tags</label>
            {ruleAssignsTags && <div className="flex flex-wrap gap-2">{tags.map((tag) => { const active = ruleTagIds.includes(tag.id); return <button key={tag.id} type="button" aria-pressed={active} onClick={() => setRuleTagIds(active ? ruleTagIds.filter((id) => id !== tag.id) : [...ruleTagIds, tag.id])} className="rounded-full border px-3 py-1.5 text-xs font-medium" style={active ? { background: tag.color, color: "white", borderColor: "transparent" } : undefined}>{tag.name}</button>; })}</div>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ruleAssignsInternal} onChange={(event) => setRuleAssignsInternal(event.target.checked)} /> Definir transferência interna</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ruleInternal} disabled={!ruleAssignsInternal} onChange={(event) => setRuleInternal(event.target.checked)} /> Marcar como interna</label>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title="Excluir tag?" description="A tag será removida de todas as transações. As transações não serão excluídas." confirmLabel="Excluir" danger pending={pending} onConfirm={remove} />
      <ConfirmDialog open={Boolean(deletingRule)} onOpenChange={(open) => !open && setDeletingRule(null)} title="Excluir regra automática?" description="Transações não editadas manualmente voltarão a usar a classificação padrão da Pluggy." confirmLabel="Excluir" danger pending={pending} onConfirm={removeRule} />
    </div>
  );
}

function ruleMatchLabel(matchType: FinanceClassificationRuleDto["matchType"]) {
  return {
    MERCHANT_CNPJ: "CNPJ do comerciante",
    MERCHANT_NAME: "Comerciante",
    COUNTERPARTY_NAME: "Contraparte",
    DESCRIPTION: "Descrição exata",
    DESCRIPTION_PREFIX: "Descrição começa com",
    PROVIDER_CATEGORY: "Categoria Pluggy",
  }[matchType];
}

function ruleResult(rule: FinanceClassificationRuleDto) {
  const parts: string[] = [];
  if (rule.assignsBudgetCategory) parts.push(rule.budgetCategory ? BUDGET_CATEGORY_META[rule.budgetCategory].label : "Sem meta");
  if (rule.assignsTags) parts.push(rule.tags.length ? rule.tags.map((tag) => tag.name).join(", ") : "Sem tags");
  if (rule.assignsInternalTransfer) parts.push(rule.internalTransfer ? "Transferência interna" : "Não interna");
  return parts.join(" · ") || "Sem ações";
}
