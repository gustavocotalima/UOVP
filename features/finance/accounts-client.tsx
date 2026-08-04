"use client";

import Script from "next/script";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  CreditCard,
  Eye,
  EyeOff,
  GripVertical,
  Landmark,
  LayoutGrid,
  Link2,
  List,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InstitutionLogo } from "@/components/ui/institution-logo";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatCurrency, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  deleteFinancialAccountAction,
  reorderFinancialAccountsAction,
  saveFinancialAccountAction,
} from "./actions";
import { accountSubtypeLabel } from "./account-labels";
import { financialAccountCurrencySymbol } from "./account-currency";
import { calculateAccountTotals } from "./calculations";
import { FinanceNotice, runFinanceAction } from "./shared";
import type { FinanceData, FinancialAccountDto } from "./types";
import { pluggyConnectErrorMessage } from "@/features/open-finance/pluggy-connect-error";

type AccountForm = {
  type: "BANK_ACCOUNT" | "CREDIT_CARD";
  subtype: string;
  name: string;
  institutionName: string;
  accountNumber: string;
  agency: string;
  numberLastFour: string;
  bankCode: string;
  brand: string;
  balance: string;
  currencyCode: "BRL" | "USD";
  manualFxRateToBrl: string;
  creditLimit: string;
  dueDay: string;
  closingDay: string;
};

function emptyForm(type: AccountForm["type"]): AccountForm {
  return {
    type,
    subtype: type === "BANK_ACCOUNT" ? "CHECKING_ACCOUNT" : "CREDIT_CARD",
    name: "",
    institutionName: "",
    accountNumber: "",
    agency: "",
    numberLastFour: "",
    bankCode: "",
    brand: "",
    balance: "0",
    currencyCode: "BRL",
    manualFxRateToBrl: "",
    creditLimit: "",
    dueDay: "",
    closingDay: "",
  };
}

export function AccountsClient({ data }: { data: FinanceData }) {
  const router = useRouter();
  const totals = useMemo(() => calculateAccountTotals(data.accounts), [data.accounts]);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [scriptKey, setScriptKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [newChoiceOpen, setNewChoiceOpen] = useState(false);
  const [typeChoiceOpen, setTypeChoiceOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FinancialAccountDto | null>(null);
  const [form, setForm] = useState<AccountForm>(emptyForm("BANK_ACCOUNT"));
  const [accountFxRequired, setAccountFxRequired] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderType, setOrderType] = useState<"BANK_ACCOUNT" | "CREDIT_CARD">("BANK_ACCOUNT");
  const [order, setOrder] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<FinancialAccountDto | null>(null);
  const banks = data.accounts.filter((account) => account.type === "BANK_ACCOUNT");
  const cards = data.accounts.filter((account) => account.type === "CREDIT_CARD");

  async function requestJson(url: string, body: object) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      warning?: string;
      accessToken?: string;
    };
    if (!response.ok) throw new Error(payload.error || "A solicitação não foi concluída.");
    return payload;
  }

  async function sync() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await requestJson("/api/pluggy/sync", {});
      setNotice({
        type: result.warning ? "error" : "success",
        text: result.warning ?? "Contas e transações sincronizadas.",
      });
      router.refresh();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Não foi possível sincronizar." });
    } finally {
      setBusy(false);
    }
  }

  async function openPluggy() {
    setNewChoiceOpen(false);
    if (!data.pluggy.configured) {
      setNotice({ type: "error", text: "Configure suas credenciais individuais da Pluggy em Configurações." });
      return;
    }
    if (!scriptReady || !window.PluggyConnect) {
      setNotice({ type: "error", text: "O conector da Pluggy ainda está carregando." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const token = await requestJson("/api/pluggy/connect-token", {});
      if (!token.accessToken) throw new Error("A Pluggy não retornou um token de conexão.");
      const widget = new window.PluggyConnect({
        connectToken: token.accessToken,
        includeSandbox: false,
        language: "pt",
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        onSuccess: async (payload) => {
          try {
            const itemId = payload.item?.id ?? payload.id;
            if (!itemId) throw new Error("A conexão terminou sem identificar a instituição.");
            await requestJson("/api/pluggy/items", { itemId });
            setNotice({ type: "success", text: "Instituição conectada e sincronizada." });
            router.refresh();
          } catch (error) {
            setNotice({
              type: "error",
              text: error instanceof Error ? error.message : "Não foi possível sincronizar a instituição.",
            });
          } finally {
            setBusy(false);
          }
        },
        onError: async (error) => {
          setNotice({ type: "error", text: pluggyConnectErrorMessage(error) });
          setBusy(false);
        },
        onClose: () => setBusy(false),
      });
      widget.init();
    } catch (error) {
      setBusy(false);
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Não foi possível abrir a Pluggy." });
    }
  }

  function openManualForm(type: AccountForm["type"]) {
    setTypeChoiceOpen(false);
    setEditing(null);
    setForm(emptyForm(type));
    setAccountFxRequired(false);
    setFormOpen(true);
  }

  function openEdit(account: FinancialAccountDto) {
    setEditing(account);
    setForm({
      type: account.type,
      subtype: account.subtype ?? (account.type === "BANK_ACCOUNT" ? "CHECKING_ACCOUNT" : "CREDIT_CARD"),
      name: account.name,
      institutionName: account.institutionName ?? "",
      accountNumber: account.accountNumber ?? "",
      agency: account.agency ?? "",
      numberLastFour: account.numberLastFour ?? "",
      bankCode: account.bankCode ?? "",
      brand: account.brand ?? "",
      balance: account.balance,
      currencyCode: account.currencyCode === "USD" ? "USD" : "BRL",
      manualFxRateToBrl: "",
      creditLimit: account.creditLimit ?? "",
      dueDay: account.dueDay?.toString() ?? "",
      closingDay: account.closingDay?.toString() ?? "",
    });
    setAccountFxRequired(false);
    setFormOpen(true);
  }

  async function saveAccount() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await saveFinancialAccountAction({
          id: editing?.id,
          type: form.type,
          subtype: form.subtype,
          name: form.name,
          institutionName: form.institutionName,
          accountNumber: form.accountNumber,
          agency: form.agency,
          numberLastFour: form.numberLastFour,
          bankCode: form.bankCode,
          brand: form.brand,
          balance: Number(form.balance),
          currencyCode: form.currencyCode,
          manualFxRateToBrl: form.manualFxRateToBrl
            ? Number(form.manualFxRateToBrl)
            : undefined,
          creditLimit: form.creditLimit ? Number(form.creditLimit) : null,
          dueDay: form.dueDay ? Number(form.dueDay) : null,
          closingDay: form.closingDay ? Number(form.closingDay) : null,
        });
      if (!result.ok) {
        setAccountFxRequired(true);
        setNotice({ type: "error", text: result.message });
        return;
      }
      setNotice({ type: "success", text: editing ? "Conta atualizada." : "Conta adicionada." });
      setFormOpen(false);
      router.refresh();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Não foi possível salvar a conta.",
      });
    } finally {
      setBusy(false);
    }
  }

  function openOrder(type: "BANK_ACCOUNT" | "CREDIT_CARD" = "BANK_ACCOUNT") {
    setOrderType(type);
    setOrder(data.accounts.filter((account) => account.type === type).map((account) => account.id));
    setOrderOpen(true);
  }

  function moveOrder(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= order.length) return;
    setOrder((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveOrder() {
    const ok = await runFinanceAction(() => reorderFinancialAccountsAction(orderType, order), setBusy, setNotice, "Ordem das contas salva.");
    if (ok) {
      setOrderOpen(false);
      router.refresh();
    }
  }

  async function removeAccount() {
    if (!deleting) return;
    const ok = await runFinanceAction(() => deleteFinancialAccountAction(deleting.id), setBusy, setNotice, "Conta removida.");
    if (ok) {
      setDeleting(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      <Script
        key={scriptKey}
        src="https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js"
        strategy="afterInteractive"
        onLoad={() => {
          setScriptReady(true);
          setScriptFailed(false);
        }}
        onReady={() => {
          setScriptReady(true);
          setScriptFailed(false);
        }}
        onError={() => {
          setScriptReady(false);
          setScriptFailed(true);
        }}
      />
      {notice && <FinanceNotice type={notice.type}>{notice.text}</FinanceNotice>}
      {totals.missingFxCount > 0 && (
        <FinanceNotice type="info">
          {totals.missingFxCount} conta(s) em moeda estrangeira aguardam conversão e não entram nos totais em BRL.
        </FinanceNotice>
      )}
      {scriptFailed && (
        <FinanceNotice type="error">
          <span className="flex flex-wrap items-center gap-3">
            O conector da Pluggy não foi carregado.
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setScriptFailed(false);
                setScriptKey((current) => current + 1);
              }}
            >
              Tentar novamente
            </Button>
          </span>
        </FinanceNotice>
      )}
      {!data.pluggy.configured && <FinanceNotice type="info">Configure sua aplicação Pluggy em Configurações para conectar e sincronizar instituições.</FinanceNotice>}
      {data.pluggy.pendingCount > 0 && <FinanceNotice type="info">{data.pluggy.pendingCount} conexão(ões) precisam de atenção ou nova autorização.</FinanceNotice>}

      <div className="flex flex-col gap-3 @4xl:flex-row @4xl:items-center @4xl:justify-between">
        <div className="flex rounded-xl bg-[var(--muted)] p-1" role="group" aria-label="Alternar visualização das contas">
          <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")} className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold", view === "cards" && "bg-[var(--card)] shadow-sm")}><LayoutGrid className="size-4" /> Cards</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold", view === "list" && "bg-[var(--card)] shadow-sm")}><List className="size-4" /> Lista</button>
        </div>
        <div className="grid grid-cols-2 gap-2 @3xl:flex @3xl:flex-wrap">
          <Button variant="outline" onClick={sync} disabled={busy || !data.pluggy.configured || !data.pluggy.itemCount}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sincronizar</Button>
          <Button variant="outline" onClick={() => openOrder()} disabled={!data.accounts.length}><GripVertical className="size-4" /> Ordenar Contas</Button>
          <Button onClick={() => setNewChoiceOpen(true)}><Plus className="size-4" /> Nova conta</Button>
        </div>
      </div>

      <section className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3 @5xl:gap-4">
        <AccountSummary label="Saldo em contas" value={totals.bankBalance} icon={Landmark} />
        <AccountSummary label="Dívidas em cartões" value={-totals.cardDebt} icon={CreditCard} danger />
        <AccountSummary label="Resultado do período" value={totals.result} icon={WalletCards} danger={totals.result < 0} />
      </section>

      <AccountSection title="Contas Bancárias" accounts={banks} view={view} timeZone={data.profile.timeZone} onEdit={openEdit} onDelete={setDeleting} />
      <AccountSection title="Cartões" accounts={cards} view={view} timeZone={data.profile.timeZone} onEdit={openEdit} onDelete={setDeleting} />

      <Dialog open={newChoiceOpen} onOpenChange={setNewChoiceOpen} title="Como você gostaria de adicioná-lo?" className="max-w-xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice icon={Pencil} title="Inserir saldo manualmente" text="Cadastre uma conta ou cartão e mantenha o saldo por conta própria." onClick={() => { setNewChoiceOpen(false); setTypeChoiceOpen(true); }} />
          <Choice icon={Link2} title="Conectar ao banco" text="Importe saldos e transações com segurança via Pluggy e Open Finance." onClick={() => void openPluggy()} />
        </div>
      </Dialog>

      <Dialog open={typeChoiceOpen} onOpenChange={setTypeChoiceOpen} title="O que você gostaria de adicionar?" className="max-w-xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice icon={Landmark} title="Conta bancária" text="Conta corrente, poupança ou conta de pagamento." onClick={() => openManualForm("BANK_ACCOUNT")} />
          <Choice icon={CreditCard} title="Cartão de crédito" text="Cadastre limite, vencimento, bandeira e saldo utilizado." onClick={() => openManualForm("CREDIT_CARD")} />
        </div>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen} dismissible={!busy} title={editing ? "Editar conta" : form.type === "BANK_ACCOUNT" ? "Adicionar conta bancária" : "Adicionar cartão"} footer={<Button onClick={saveAccount} disabled={busy || form.name.trim().length < 2 || (accountFxRequired && !(Number(form.manualFxRateToBrl) > 0))}>{editing ? "Salvar alterações" : "Adicionar"}</Button>}>
        {editing?.source === "PLUGGY" && <div className="mb-5 rounded-xl bg-[var(--muted)] p-3 text-sm text-[var(--muted-foreground)]">Apenas o nome personalizado pode ser alterado. Saldos, limites e datas continuam sendo atualizados pela instituição.</div>}
        {accountFxRequired && <FinanceNotice type="error">Não foi possível obter USD/BRL automaticamente. Informe a cotação manual para continuar.</FinanceNotice>}
        <AccountFormFields
          form={form}
          setForm={setForm}
          providerOwned={editing?.source === "PLUGGY"}
          currencyLocked={Boolean(editing && editing.transactionCount > 0)}
          fxRequired={accountFxRequired}
        />
      </Dialog>

      <Dialog open={orderOpen} onOpenChange={setOrderOpen} dismissible={!busy} title="Ordenar contas" description="Reorganize suas contas na ordem desejada." footer={<><Button variant="outline" onClick={() => setOrderOpen(false)}>Cancelar</Button><Button onClick={saveOrder} disabled={busy || !order.length}>Salvar</Button></>}>
        <div className="grid grid-cols-2 rounded-xl bg-[var(--muted)] p-1" role="radiogroup" aria-label="Tipo de conta para ordenar">
          {(["BANK_ACCOUNT", "CREDIT_CARD"] as const).map((type) => <button key={type} type="button" role="radio" aria-checked={orderType === type} onClick={() => openOrder(type)} className={cn("rounded-lg px-3 py-2 text-sm font-semibold", orderType === type && "bg-[var(--card)] shadow-sm")}>{type === "BANK_ACCOUNT" ? "Contas Bancárias" : "Cartões"}</button>)}
        </div>
        <div className="mt-5 space-y-2">
          {order.map((id, index) => {
            const account = data.accounts.find((item) => item.id === id);
            if (!account) return null;
            return <div key={id} className="flex items-center gap-3 rounded-xl border p-3"><GripVertical className="size-4 text-[var(--muted-foreground)]" /><AccountLogo account={account} /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{account.name}</span><Button variant="ghost" size="icon" onClick={() => moveOrder(index, -1)} disabled={index === 0} aria-label="Mover para cima"><ArrowUp className="size-4" /></Button><Button variant="ghost" size="icon" onClick={() => moveOrder(index, 1)} disabled={index === order.length - 1} aria-label="Mover para baixo"><ArrowDown className="size-4" /></Button></div>;
          })}
        </div>
      </Dialog>

      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title="Remover conta?" description={deleting?.source === "PLUGGY" ? "A conta será ocultada. Uma nova sincronização da instituição pode reativá-la." : "A conta manual e suas transações serão removidas permanentemente."} confirmLabel="Remover" danger pending={busy} onConfirm={removeAccount} />
    </div>
  );
}

function AccountLogo({ account }: { account: FinancialAccountDto }) {
  return (
    <InstitutionLogo
      src={account.institutionImageUrl}
      name={account.institutionName || account.name}
      kind={account.type === "CREDIT_CARD" ? "card" : "bank"}
    />
  );
}

function AccountSummary({ label, value, icon: Icon, danger = false }: { label: string; value: number; icon: typeof Landmark; danger?: boolean }) {
  return <Card><CardContent className="flex items-center gap-4 p-5"><span className="grid size-11 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]"><Icon className="size-5" /></span><div><p className="text-xs text-[var(--muted-foreground)]">{label}</p><p className={cn("mt-1 text-xl font-semibold", danger && "text-[var(--danger)]")}>{formatMoney(value)}</p></div></CardContent></Card>;
}

function AccountSection({ title, accounts, view, timeZone, onEdit, onDelete }: { title: string; accounts: FinancialAccountDto[]; view: "cards" | "list"; timeZone: string; onEdit: (account: FinancialAccountDto) => void; onDelete: (account: FinancialAccountDto) => void }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2"><h2 className="text-lg font-semibold">{title}</h2><span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">{accounts.length}</span></div>
      {view === "cards" ? (
        <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
          {accounts.map((account) => <AccountCard key={account.id} account={account} timeZone={timeZone} onEdit={onEdit} onDelete={onDelete} />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 @3xl:grid-cols-2 lg:hidden">
            {accounts.map((account) => <AccountCard key={account.id} account={account} timeZone={timeZone} onEdit={onEdit} onDelete={onDelete} />)}
          </div>
          <Card className="hidden overflow-hidden lg:block"><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><tr><th className="p-4">Conta</th><th>Tipo</th><th>Agência / Conta</th><th>Saldo</th><th>Sincronização</th><th className="pr-4 text-right">Ações</th></tr></thead><tbody className="divide-y">{accounts.map((account) => <tr key={account.id}><td className="p-4"><div className="flex items-center gap-3"><AccountLogo account={account} /><div><p className="font-semibold">{account.name}</p><p className="text-xs text-[var(--muted-foreground)]">{account.institutionName}</p></div></div></td><td>{accountSubtypeLabel(account.subtype, account.type)}</td><td>{account.type === "CREDIT_CARD" ? `•••• ${account.numberLastFour || "—"}` : `${account.agency ? `Ag ${account.agency} · ` : ""}${account.accountNumber || "—"}`}</td><td><p className="font-semibold">{formatCurrency(account.balance, account.currencyCode)}</p><AccountBrlEquivalent account={account} /></td><td className="text-xs text-[var(--muted-foreground)]">{account.providerUpdatedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(account.providerUpdatedAt)) : "Manual"}</td><td className="pr-4"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => onEdit(account)} aria-label="Editar conta"><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" onClick={() => onDelete(account)} aria-label="Excluir conta"><Trash2 className="size-4" /></Button></div></td></tr>)}</tbody></table></div></Card>
        </>
      )}
      {!accounts.length && <Card><CardContent className="py-10 text-center text-sm text-[var(--muted-foreground)]">Nenhuma conta nesta categoria.</CardContent></Card>}
    </section>
  );
}

function AccountCard({ account, timeZone, onEdit, onDelete }: { account: FinancialAccountDto; timeZone: string; onEdit: (account: FinancialAccountDto) => void; onDelete: (account: FinancialAccountDto) => void }) {
  const [show, setShow] = useState(false);
  const used = Math.abs(Number(account.balance));
  const limit = account.creditLimit ? Number(account.creditLimit) : null;
  const usage = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AccountLogo account={account} />
          <div className="min-w-0">
            <CardTitle className="truncate">{account.name}</CardTitle>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {accountSubtypeLabel(account.subtype, account.type)}
            </p>
          </div>
        </div>
        <div className="flex">
          <Button variant="ghost" size="icon" onClick={() => onEdit(account)} aria-label="Editar conta"><Pencil className="size-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(account)} aria-label="Excluir conta"><Trash2 className="size-4" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        {account.type === "BANK_ACCOUNT" ? (
          <>
            <p className="text-xs text-[var(--muted-foreground)]">Saldo disponível</p>
            <p className="mt-1 text-2xl font-semibold">{formatCurrency(account.balance, account.currencyCode)}</p>
            <AccountBrlEquivalent account={account} className="mt-1" />
            <AccountFxDetails account={account} timeZone={timeZone} />
            <p className="mt-4 text-xs text-[var(--muted-foreground)]">
              {account.providerUpdatedAt
                ? `${account.source === "PLUGGY" ? "Sincronizado" : "Câmbio atualizado"} em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(account.providerUpdatedAt))}`
                : "Conta manual"}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="font-mono tracking-[0.14em]">
                {show ? `•••• •••• •••• ${account.numberLastFour || "0000"}` : "•••• •••• •••• ••••"}
              </p>
              <Button variant="ghost" size="icon" onClick={() => setShow(!show)} aria-label={show ? "Ocultar numero" : "Mostrar numero"}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">Limite Total</p>
                <p className="mt-1 font-semibold">{limit == null ? "•••" : formatCurrency(limit, account.currencyCode)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">Utilizado</p>
                <p className="mt-1 font-semibold">{formatCurrency(used, account.currencyCode)}</p>
                <AccountBrlEquivalent account={account} className="mt-1" />
              </div>
            </div>
            <div className="mt-4">
              <div
                className="h-2 overflow-hidden rounded-full bg-[var(--muted)]"
                role="progressbar"
                aria-label="Percentual do limite utilizado"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={usage == null ? undefined : Math.round(usage)}
              >
                {usage != null && (
                  <div
                    className="h-full bg-[var(--primary)]"
                    style={{ width: `${usage}%` }}
                  />
                )}
              </div>
              <p className="mt-1 text-right text-[11px] text-[var(--muted-foreground)]">
                {usage == null ? "—" : `${Math.round(usage)}%`}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs">
              <span>{account.brand || "CARTÃO"}</span>
              <span className="text-[var(--success)]">{account.source === "PLUGGY" ? "Sincronizado" : "Manual"}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Choice({ icon: Icon, title, text, onClick }: { icon: typeof Landmark; title: string; text: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="rounded-2xl border p-5 text-left transition hover:border-[var(--primary)] hover:bg-[var(--primary)]/5"><span className="mb-4 grid size-11 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]"><Icon className="size-5" /></span><p className="font-semibold">{title}</p><p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{text}</p></button>;
}

function AccountFormFields({
  form,
  setForm,
  providerOwned = false,
  currencyLocked = false,
  fxRequired = false,
}: {
  form: AccountForm;
  setForm: React.Dispatch<React.SetStateAction<AccountForm>>;
  providerOwned?: boolean;
  currencyLocked?: boolean;
  fxRequired?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Label className="sm:col-span-2">
        {form.type === "BANK_ACCOUNT" ? "Nome da conta" : "Nome do cartão"}
        <Input className="mt-2" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={form.type === "BANK_ACCOUNT" ? "Ex.: Conta Inter" : "Ex.: Visa Infinite"} />
      </Label>
      <Label>Banco / Instituição<Input disabled={providerOwned} className="mt-2" value={form.institutionName} onChange={(event) => setForm({ ...form, institutionName: event.target.value })} /></Label>
      <Label>
        Moeda
        <Select
          disabled={providerOwned || currencyLocked}
          className="mt-2 w-full"
          value={form.currencyCode}
          onChange={(event) => setForm({
            ...form,
            currencyCode: event.target.value as AccountForm["currencyCode"],
            manualFxRateToBrl: "",
          })}
        >
          <option value="BRL">Real brasileiro (BRL)</option>
          <option value="USD">Dólar americano (USD)</option>
        </Select>
        {currencyLocked && !providerOwned && (
          <span className="mt-1 block text-xs font-normal text-[var(--muted-foreground)]">
            A moeda não pode ser alterada porque esta conta já possui transações.
          </span>
        )}
      </Label>
      {form.type === "BANK_ACCOUNT" ? (
        <>
          <Label>Agência<Input disabled={providerOwned} className="mt-2" value={form.agency} onChange={(event) => setForm({ ...form, agency: event.target.value })} /></Label>
          <Label>Número da conta<Input disabled={providerOwned} className="mt-2" value={form.accountNumber} onChange={(event) => setForm({ ...form, accountNumber: event.target.value })} /></Label>
          <Label>
            Tipo
            <Select
              disabled={providerOwned}
              className="mt-2 w-full"
              value={form.subtype}
              onChange={(event) => setForm({ ...form, subtype: event.target.value })}
            >
              <option value="CHECKING_ACCOUNT">Conta corrente</option>
              <option value="SAVINGS_ACCOUNT">Poupança</option>
              <option value="PAYMENT_ACCOUNT">Conta de pagamento</option>
              <option value="INVESTMENT_ACCOUNT">Conta de investimento</option>
              <option value="SALARY_ACCOUNT">Conta salário</option>
            </Select>
          </Label>
        </>
      ) : (
        <>
          <Label>Últimos 4 dígitos<Input disabled={providerOwned} className="mt-2" value={form.numberLastFour} maxLength={4} onChange={(event) => setForm({ ...form, numberLastFour: event.target.value.replace(/\D/g, "").slice(0, 4) })} /></Label>
          <Label>Bandeira<Select disabled={providerOwned} className="mt-2 w-full" value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })}><option value="">Selecione</option><option>VISA</option><option>MASTERCARD</option><option>ELO</option><option>AMEX</option><option>OUTRA</option></Select></Label>
          <Label>Limite total<Input disabled={providerOwned} className="mt-2" type="number" min="0" step="0.01" value={form.creditLimit} onChange={(event) => setForm({ ...form, creditLimit: event.target.value })} /></Label>
          <Label>Dia do vencimento<Input disabled={providerOwned} className="mt-2" type="number" min="1" max="31" value={form.dueDay} onChange={(event) => setForm({ ...form, dueDay: event.target.value })} /></Label>
          <Label>Dia do fechamento<Input disabled={providerOwned} className="mt-2" type="number" min="1" max="31" value={form.closingDay} onChange={(event) => setForm({ ...form, closingDay: event.target.value })} /></Label>
        </>
      )}
      <Label className="sm:col-span-2">
        {form.type === "BANK_ACCOUNT" ? "Saldo" : "Valor utilizado"}
        <Input disabled={providerOwned} className="mt-2" type="number" step="0.01" value={form.balance} onChange={(event) => setForm({ ...form, balance: event.target.value })} placeholder={`${financialAccountCurrencySymbol(form.currencyCode)} 0,00`} />
      </Label>
      {form.currencyCode === "USD" && fxRequired && !providerOwned && (
        <Label className="sm:col-span-2">
          Cotação manual USD/BRL
          <Input
            className="mt-2"
            type="number"
            min="0.00000001"
            step="0.00000001"
            value={form.manualFxRateToBrl}
            onChange={(event) => setForm({ ...form, manualFxRateToBrl: event.target.value })}
            placeholder="Ex.: 5,45"
          />
          <span className="mt-1 block text-xs font-normal text-[var(--muted-foreground)]">
            Informe quantos reais correspondem a US$ 1.
          </span>
        </Label>
      )}
    </div>
  );
}

function AccountBrlEquivalent({
  account,
  className,
}: {
  account: FinancialAccountDto;
  className?: string;
}) {
  if (account.currencyCode === "BRL") return null;
  return (
    <p className={cn("text-xs text-[var(--muted-foreground)]", className)}>
      {account.balanceBrl === null
        ? "Conversão para BRL pendente"
        : `Equivale a ${formatCurrency(account.balanceBrl, "BRL")}`}
    </p>
  );
}

function AccountFxDetails({
  account,
  timeZone,
}: {
  account: FinancialAccountDto;
  timeZone: string;
}) {
  if (account.currencyCode === "BRL" || !account.balanceFxRateToBrl) return null;
  const date = account.balanceFxRateDate
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone }).format(new Date(account.balanceFxRateDate))
    : null;
  return (
    <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
      USD/BRL {Number(account.balanceFxRateToBrl).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
      {date ? ` · ${date}` : ""}
      {account.balanceFxSource ? ` · ${account.balanceFxSource}` : ""}
    </p>
  );
}
