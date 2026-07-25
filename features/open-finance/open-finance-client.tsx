"use client";

import Script from "next/script";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Unplug,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { InstitutionLogo } from "@/components/ui/institution-logo";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { cn } from "@/lib/utils";
import type { OpenFinanceData } from "./data";
import {
  deletePluggyConnectionAction,
  resolvePluggyItemDisconnectionAction,
  setShowSoldInvestmentsAction,
} from "./diagram-actions";
import { pluggyConnectErrorMessage } from "./pluggy-connect-error";

type Tab = "connections" | "accounts" | "transactions" | "investments";
type PluggySuccessPayload = { id?: string; item?: { id?: string } };
type PluggyConnectError = {
  message?: string;
  code?: string | number;
  codeDescription?: string;
  data?: { items?: unknown[] };
};

declare global {
  interface Window {
    PluggyConnect?: new (options: {
      connectToken: string;
      includeSandbox?: boolean;
      language?: string;
      theme?: "light" | "dark";
      updateItem?: string;
      onSuccess?: (payload: PluggySuccessPayload) => void | Promise<void>;
      onError?: (error: PluggyConnectError) => void | Promise<void>;
      onClose?: () => void;
    }) => { init: () => void };
  }
}

const tabs = [
  {
    value: "connections",
    label: "Conexões",
    tabId: "open-finance-tab-connections",
    panelId: "open-finance-panel-connections",
  },
  {
    value: "accounts",
    label: "Contas",
    tabId: "open-finance-tab-accounts",
    panelId: "open-finance-panel-accounts",
  },
  {
    value: "transactions",
    label: "Transações",
    tabId: "open-finance-tab-transactions",
    panelId: "open-finance-panel-transactions",
  },
  {
    value: "investments",
    label: "Investimentos",
    tabId: "open-finance-tab-investments",
    panelId: "open-finance-panel-investments",
  },
] as const;

function money(value: string | number, currency = "BRL") {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  }
}

function date(value: string | null, timeZone: string) {
  if (!value) return "Ainda não sincronizado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(value));
}

function shortDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone }).format(new Date(value));
}

function statusLabel(status: string, executionStatus: string | null) {
  if (status === "DELETED") return "Desconectado";
  if (status === "UPDATED" && (!executionStatus || executionStatus === "SUCCESS")) return "Conectado";
  if (status.includes("UPDAT") || executionStatus === "PARTIAL_SUCCESS") return "Atualizando";
  return "Atenção";
}

function nonBrlAmounts(values: Record<string, number>) {
  return Object.entries(values)
    .filter(([currency, value]) => currency !== "BRL" && value !== 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) => money(value, currency));
}

export function OpenFinanceClient({ data }: { data: OpenFinanceData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("connections");
  const [expandedInvestment, setExpandedInvestment] = useState<string | null>(null);
  const [transactions, setTransactions] = useState(data.transactions);
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [investmentTransactions, setInvestmentTransactions] = useState<
    Record<string, OpenFinanceData["investments"][number]["transactions"]>
  >({});
  const [investmentTransactionPages, setInvestmentTransactionPages] = useState<
    Record<string, { page: number; total: number }>
  >({});
  const [investmentTransactionsLoading, setInvestmentTransactionsLoading] = useState<string | null>(null);
  const [showSoldInvestments, setShowSoldInvestments] = useState(data.showSoldInvestments);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [scriptKey, setScriptKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [disconnectionError, setDisconnectionError] = useState<string | null>(null);
  const [connectionToDelete, setConnectionToDelete] = useState<
    OpenFinanceData["items"][number] | null
  >(null);
  const [resolvedDisconnections, setResolvedDisconnections] = useState<Set<string>>(() => new Set());
  const keepManualFocusRef = useRef<HTMLSpanElement>(null);
  const pendingDisconnection = data.pendingDisconnections.find(
    (item) => !resolvedDisconnections.has(item.id),
  );
  const transactionPageSize = 25;

  useEffect(() => {
    if (tab !== "transactions") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setTransactionsLoading(true);
    });
    fetch(`/api/open-finance/transactions?page=${transactionPage}&pageSize=${transactionPageSize}`)
      .then(async (response) => {
        const payload = await response.json() as {
          error?: string;
          total: number;
          transactions: OpenFinanceData["transactions"];
        };
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as transações.");
        if (!cancelled) {
          setTransactions(payload.transactions);
          setTransactionTotal(payload.total);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({
            type: "error",
            text: error instanceof Error ? error.message : "Não foi possível carregar as transações.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setTransactionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, transactionPage]);

  async function loadInvestmentTransactions(id: string, page: number) {
    if (investmentTransactionsLoading === id) return;
    setInvestmentTransactionsLoading(id);
    try {
      const response = await fetch(
        `/api/open-finance/investments/${encodeURIComponent(id)}/transactions?page=${page}&pageSize=25`,
      );
      const payload = await response.json() as {
        error?: string;
        page: number;
        total: number;
        transactions: OpenFinanceData["investments"][number]["transactions"];
      };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as movimentações.");
      setInvestmentTransactions((current) => ({
        ...current,
        [id]: page === 1
          ? payload.transactions
          : [...(current[id] ?? []), ...payload.transactions],
      }));
      setInvestmentTransactionPages((current) => ({
        ...current,
        [id]: { page: payload.page, total: payload.total },
      }));
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Não foi possível carregar as movimentações.",
      });
    } finally {
      setInvestmentTransactionsLoading(null);
    }
  }

  async function toggleInvestment(id: string) {
    if (expandedInvestment === id) {
      setExpandedInvestment(null);
      return;
    }
    setExpandedInvestment(id);
    if (investmentTransactions[id]) return;
    await loadInvestmentTransactions(id, 1);
  }

  async function requestJson(url: string, body: object) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; accessToken?: string };
    if (!response.ok) throw new Error(payload.error || "A solicitação não foi concluída.");
    return payload;
  }

  async function sync(itemId?: string) {
    setBusy(itemId ?? "all");
    setNotice(null);
    try {
      await requestJson("/api/pluggy/sync", itemId ? { itemId } : {});
      setNotice({ type: "success", text: itemId ? "Instituição sincronizada." : "Todas as conexões foram sincronizadas." });
      router.refresh();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Falha na sincronização." });
    } finally {
      setBusy(null);
    }
  }

  async function openPluggy(itemId?: string) {
    if (!scriptReady || !window.PluggyConnect) {
      setNotice({ type: "error", text: "O conector da Pluggy ainda está carregando." });
      return;
    }
    setBusy(itemId ?? "connect");
    setNotice(null);
    try {
      const token = await requestJson("/api/pluggy/connect-token", itemId ? { itemId } : {});
      if (!token.accessToken) throw new Error("A Pluggy não retornou um token de conexão.");
      const PluggyConnect = window.PluggyConnect;
      const widget = new PluggyConnect({
        connectToken: token.accessToken,
        includeSandbox: false,
        language: "pt",
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        ...(itemId ? { updateItem: itemId } : {}),
        onSuccess: async (payload) => {
          const connectedItemId = payload.item?.id ?? payload.id ?? itemId;
          if (!connectedItemId) {
            setNotice({ type: "error", text: "A conexão terminou sem identificar a instituição." });
            return;
          }
          try {
            await requestJson("/api/pluggy/items", { itemId: connectedItemId });
            setNotice({ type: "success", text: itemId ? "Instituição atualizada e sincronizada." : "Instituição conectada e sincronizada." });
            router.refresh();
          } catch (error) {
            setNotice({ type: "error", text: error instanceof Error ? error.message : "Falha ao salvar a conexão." });
          }
        },
        onError: async (error) => {
          setNotice({ type: "error", text: pluggyConnectErrorMessage(error) });
          setBusy(null);
        },
        onClose: () => setBusy(null),
      });
      widget.init();
    } catch (error) {
      setBusy(null);
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Não foi possível abrir a Pluggy." });
    }
  }

  async function toggleSoldInvestments() {
    const next = !showSoldInvestments;
    setShowSoldInvestments(next);
    try {
      await setShowSoldInvestmentsAction(next);
    } catch (error) {
      setShowSoldInvestments(!next);
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Não foi possível salvar a visualização.",
      });
    }
  }

  async function resolveDisconnection(resolution: "KEEP_MANUAL" | "REMOVE") {
    const disconnected = pendingDisconnection;
    if (!disconnected) return;
    setBusy(`disconnect:${disconnected.id}`);
    setNotice(null);
    setDisconnectionError(null);
    try {
      await resolvePluggyItemDisconnectionAction(disconnected.id, resolution);
      setNotice({
        type: "success",
        text: resolution === "KEEP_MANUAL"
          ? "Contas, transações e posições foram mantidas como dados manuais."
          : "Os dados desconectados foram excluídos dos relatórios e do diagrama.",
      });
      setResolvedDisconnections((current) => new Set(current).add(disconnected.id));
      router.refresh();
    } catch (error) {
      setDisconnectionError(
        error instanceof Error ? error.message : "Não foi possível concluir a decisão.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function deleteConnection() {
    const connection = connectionToDelete;
    if (!connection) return;
    setBusy(`delete:${connection.id}`);
    setNotice(null);
    try {
      await deletePluggyConnectionAction(connection.pluggyItemId);
      setConnectionToDelete(null);
      setNotice({
        type: "success",
        text: "Instituição desconectada. Agora escolha o que fazer com os dados importados.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Não foi possível desconectar a instituição.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
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

      {scriptFailed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--danger)]/45 bg-[var(--danger)]/10 p-4 text-sm">
          <p>Não foi possível carregar o conector da Pluggy.</p>
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
        </div>
      )}

      {!data.configured && (
        <div className="flex items-start gap-3 rounded-2xl border border-[var(--danger)]/45 bg-[var(--danger)]/10 p-4 text-sm">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-[var(--danger)]" />
          <p>
            Configure suas credenciais individuais da Pluggy em{" "}
            <a className="font-semibold underline" href="/configuracoes">
              Configurações
            </a>{" "}
            antes de conectar instituições.
          </p>
        </div>
      )}

      {!data.webhookConfigured && (
        <div className="flex items-start gap-3 rounded-2xl border border-[var(--primary)]/45 bg-[var(--primary)]/10 p-4 text-sm">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" />
          <p>
            Configure o seu segredo individual do webhook da Pluggy em{" "}
            <a className="font-semibold underline" href="/configuracoes">
              Configurações
            </a>{" "}
            para detectar automaticamente conexões removidas.
          </p>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={cn(
            "flex items-start gap-3 rounded-2xl border p-4 text-sm",
            notice.type === "success"
              ? "border-[var(--success)]/45 bg-[var(--success)]/10"
              : "border-[var(--danger)]/45 bg-[var(--danger)]/10",
          )}
        >
          {notice.type === "success" ? <ShieldCheck className="size-5 text-[var(--success)]" /> : <AlertCircle className="size-5 text-[var(--danger)]" />}
          <p>{notice.text}</p>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={Landmark}
          label="Saldo em contas"
          value={money(data.totals.cash)}
          otherCurrencies={nonBrlAmounts(data.totalsByCurrency.cash)}
        />
        <SummaryCard
          icon={CreditCard}
          label="Saldo de cartões"
          value={money(data.totals.credit)}
          otherCurrencies={nonBrlAmounts(data.totalsByCurrency.credit)}
        />
        <SummaryCard
          icon={TrendingUp}
          label="Investimentos conectados"
          value={money(data.totals.investments)}
          otherCurrencies={nonBrlAmounts(data.totalsByCurrency.investments)}
        />
      </section>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs value={tab} onValueChange={setTab} options={tabs} ariaLabel="Dados Open Finance" />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => sync()}
            disabled={!data.items.some((item) => item.status !== "DELETED") || busy !== null}
          >
            {busy === "all" ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Sincronizar dados
          </Button>
          <Button onClick={() => openPluggy()} disabled={!data.configured || !scriptReady || busy !== null}>
            {busy === "connect" ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            Conectar instituição
          </Button>
        </div>
      </div>

      {tab === "connections" && (
        <section
          id="open-finance-panel-connections"
          role="tabpanel"
          aria-labelledby="open-finance-tab-connections"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {data.items.map((item) => {
            const healthy = statusLabel(item.status, item.executionStatus) === "Conectado";
            const disconnected = item.status === "DELETED";
            return (
              <Card key={item.id}>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <InstitutionLogo src={item.connectorImageUrl} name={item.connectorName} />
                    <div className="min-w-0">
                      <CardTitle className="truncate">{item.connectorName}</CardTitle>
                      <CardDescription>{item.accountCount} conta(s) · {item.investmentCount} investimento(s)</CardDescription>
                    </div>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", healthy ? "bg-[var(--success)]/15 text-[var(--success)]" : "bg-[var(--primary)]/15 text-[var(--primary)]")}>
                    {statusLabel(item.status, item.executionStatus)}
                  </span>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1 text-xs text-[var(--muted-foreground)]">
                    <p>Dados locais: {date(item.lastSyncAt, data.timeZone)}</p>
                    <p>Instituição: {date(item.providerUpdatedAt, data.timeZone)}</p>
                    {item.consentExpiresAt && <p>Consentimento até: {date(item.consentExpiresAt, data.timeZone)}</p>}
                  </div>
                  {item.errorMessage && <p className="rounded-xl bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)]">{item.errorMessage}</p>}
                  {!disconnected && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => sync(item.pluggyItemId)} disabled={busy !== null}>
                          {busy === item.pluggyItemId ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                          Ler dados
                        </Button>
                        <Button size="sm" variant="secondary" className="flex-1" onClick={() => openPluggy(item.pluggyItemId)} disabled={!scriptReady || busy !== null}>
                          Atualizar banco
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full text-[var(--danger)] hover:bg-[var(--danger)]/10"
                        onClick={() => setConnectionToDelete(item)}
                        disabled={busy !== null}
                      >
                        <Unplug className="size-4" />
                        Desconectar instituição
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {!data.items.length && <EmptyState title="Nenhuma instituição conectada" text="Conecte uma instituição para importar seus dados de Open Finance." />}
        </section>
      )}

      {tab === "accounts" && (
        <section
          id="open-finance-panel-accounts"
          role="tabpanel"
          aria-labelledby="open-finance-tab-accounts"
        >
          <DataCard title="Contas e cartões" description={`${data.accounts.length} produto(s) sincronizado(s)`}>
            <div className="divide-y">
              {data.accounts.map((account) => (
                <div key={account.id} className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--muted)]">
                      {account.type === "CREDIT" ? <CreditCard className="size-5" /> : <WalletCards className="size-5" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{account.name}</p>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">
                        {account.institution}{account.numberLastFour ? ` · final ${account.numberLastFour}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="font-semibold tabular-nums">{money(account.balance, account.currencyCode)}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{date(account.updatedAt, data.timeZone)}</p>
                  </div>
                </div>
              ))}
              {!data.accounts.length && <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Sincronize uma conexão para carregar contas.</p>}
            </div>
          </DataCard>
        </section>
      )}

      {tab === "transactions" && (
        <section
          id="open-finance-panel-transactions"
          role="tabpanel"
          aria-labelledby="open-finance-tab-transactions"
        >
          <DataCard title="Transações recentes" description={`${transactionTotal} lançamento(s), carregados em páginas de ${transactionPageSize}.`}>
            <div className="divide-y">
              {transactions.map((transaction) => {
                const incoming = Number(transaction.amount) >= 0;
                return (
                  <div key={transaction.id} className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", incoming ? "bg-[var(--success)]/12 text-[var(--success)]" : "bg-[var(--danger)]/10 text-[var(--danger)]")}>
                        {incoming ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{transaction.merchantName || transaction.description}</p>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          {transaction.institution} · {transaction.accountName}{transaction.category ? ` · ${transaction.category}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="pl-12 text-left sm:pl-0 sm:text-right">
                      <p className={cn("text-sm font-semibold tabular-nums", incoming ? "text-[var(--success)]" : "")}>{money(transaction.amount, transaction.currencyCode)}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">{date(transaction.date, data.timeZone)}</p>
                    </div>
                  </div>
                );
              })}
              {transactionsLoading && <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Carregando transações…</p>}
              {!transactionsLoading && !transactions.length && <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Nenhuma transação sincronizada.</p>}
            </div>
            {transactionTotal > transactionPageSize && (
              <div className="mt-4 flex items-center justify-end gap-2 border-t pt-4">
                <Button variant="outline" size="sm" disabled={transactionsLoading || transactionPage === 1} onClick={() => setTransactionPage((page) => Math.max(1, page - 1))}>Anterior</Button>
                <span className="text-xs text-[var(--muted-foreground)]">Página {transactionPage} de {Math.ceil(transactionTotal / transactionPageSize)}</span>
                <Button variant="outline" size="sm" disabled={transactionsLoading || transactionPage >= Math.ceil(transactionTotal / transactionPageSize)} onClick={() => setTransactionPage((page) => page + 1)}>Próxima</Button>
              </div>
            )}
          </DataCard>
        </section>
      )}

      {tab === "investments" && (
        <section
          id="open-finance-panel-investments"
          role="tabpanel"
          aria-labelledby="open-finance-tab-investments"
        >
          <InvestmentPortfolio
            investments={data.investments.filter((investment) =>
              (investment.status === "ACTIVE" && investment.providerAvailable)
              || (showSoldInvestments && investment.status === "TOTAL_WITHDRAWAL"),
            )}
            total={data.totals.investments}
            soldCount={data.soldInvestmentCount}
            showSold={showSoldInvestments}
            onToggleSold={() => void toggleSoldInvestments()}
            expandedId={expandedInvestment}
            onToggle={(id) => void toggleInvestment(id)}
            loadedTransactions={investmentTransactions}
            transactionPages={investmentTransactionPages}
            loadingInvestmentId={investmentTransactionsLoading}
            onLoadMore={(id, page) => void loadInvestmentTransactions(id, page)}
            timeZone={data.timeZone}
          />
        </section>
      )}

      <Dialog
        open={Boolean(pendingDisconnection)}
        onOpenChange={() => undefined}
        dismissible={false}
        title="Conexão removida"
        description="Escolha o que fazer com os dados que vieram desta instituição."
        className="max-w-xl"
        initialFocusRef={keepManualFocusRef}
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => void resolveDisconnection("REMOVE")}
              disabled={busy !== null}
            >
              {busy?.startsWith("disconnect:") ? "Salvando…" : "Remover dos relatórios"}
            </Button>
            <span ref={keepManualFocusRef} className="inline-flex">
              <Button
                className="w-full"
                onClick={() => void resolveDisconnection("KEEP_MANUAL")}
                disabled={busy !== null}
              >
                {busy?.startsWith("disconnect:") ? "Salvando…" : "Manter como manuais"}
              </Button>
            </span>
          </>
        }
      >
        {pendingDisconnection && (
          <div className="space-y-4">
            {disconnectionError && (
              <p
                role="alert"
                className="rounded-xl border border-[var(--danger)]/45 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]"
              >
                {disconnectionError}
              </p>
            )}
            <div className="flex items-start gap-4 rounded-2xl border bg-[var(--muted)]/35 p-4">
              <InstitutionLogo
                src={pendingDisconnection.connectorImageUrl}
                name={pendingDisconnection.connectorName}
              />
              <div>
                <p className="font-semibold">{pendingDisconnection.connectorName}</p>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                  A conexão foi excluída. As {pendingDisconnection.accountCount} conta(s), suas
                  transações e {pendingDisconnection.investmentCount} posição(ões) continuam nos
                  totais enquanto você decide. Você pode preservar os últimos dados como manuais ou
                  removê-los dos relatórios e do diagrama.
                </p>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(connectionToDelete)}
        onOpenChange={(open) => {
          if (!open) setConnectionToDelete(null);
        }}
        title={`Desconectar ${connectionToDelete?.connectorName ?? "instituição"}?`}
        description="O consentimento será revogado na Pluggy. Em seguida, você poderá manter os dados já importados como manuais ou removê-los dos relatórios e do diagrama."
        confirmLabel="Desconectar"
        danger
        pending={busy?.startsWith("delete:") ?? false}
        onConfirm={() => void deleteConnection()}
      />

    </>
  );
}

type Investment = OpenFinanceData["investments"][number];

const INVESTMENT_TYPE_LABELS: Record<string, string> = {
  FIXED_INCOME: "Renda fixa",
  VARIABLE_INCOME: "Ações",
  EQUITY: "Ações",
  STOCK: "Ações",
  ETF: "ETFs",
  MUTUAL_FUND: "Fundos de investimento",
  REAL_ESTATE: "Fundos imobiliários",
  SECURITY: "Previdência e seguros",
  TREASURY: "Tesouro Direto",
  PENSION: "Previdência",
  COE: "COE",
  CRYPTO: "Criptomoedas",
  OTHER: "Outros",
};

const INVESTMENT_TYPE_ORDER = [
  "Renda fixa",
  "Tesouro Direto",
  "Ações",
  "ETFs",
  "Fundos imobiliários",
  "Fundos de investimento",
  "Previdência e seguros",
  "Previdência",
  "COE",
  "Criptomoedas",
  "Outros",
];

function investmentGroup(type: string) {
  return INVESTMENT_TYPE_LABELS[type.toUpperCase()] ?? type.replaceAll("_", " ");
}

function investmentSubtype(value: string | null, type: string) {
  const normalized = (value || type).toUpperCase();
  const labels: Record<string, string> = {
    STOCK: "Ação",
    FUND: "Fundo",
    REAL_ESTATE_FUND: "Fundo imobiliário",
    INVESTMENT_FUND: "Fundo de investimento",
    RETIREMENT: "Previdência",
  };
  return labels[normalized] ?? normalized.replaceAll("_", " ");
}

function decimal(value: string | null, maximumFractionDigits = 8) {
  if (value === null) return "—";
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits });
}

function percentage(value: string | null, suffix = "%") {
  if (value === null) return "—";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}${suffix}`;
}

function status(value: string | null) {
  if (!value) return null;
  const labels: Record<string, string> = {
    ACTIVE: "Ativo",
    PENDING: "Pendente",
    TOTAL_WITHDRAWAL: "Resgate total",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function rate(investment: Investment) {
  if (investment.rate !== null) {
    return `${percentage(investment.rate)}${investment.rateType ? ` ${investment.rateType}` : ""}`;
  }
  if (investment.fixedAnnualRate !== null) {
    return `${percentage(investment.fixedAnnualRate)} a.a.${investment.rateType ? ` · ${investment.rateType}` : ""}`;
  }
  if (investment.annualRate !== null) return `${percentage(investment.annualRate)} a.a.`;
  return "N/A";
}

function InvestmentPortfolio({
  investments,
  total,
  soldCount,
  showSold,
  onToggleSold,
  expandedId,
  onToggle,
  loadedTransactions,
  transactionPages,
  loadingInvestmentId,
  onLoadMore,
  timeZone,
}: {
  investments: OpenFinanceData["investments"];
  total: number;
  soldCount: number;
  showSold: boolean;
  onToggleSold: () => void;
  expandedId: string | null;
  onToggle: (id: string) => void;
  loadedTransactions: Record<string, OpenFinanceData["investments"][number]["transactions"]>;
  transactionPages: Record<string, { page: number; total: number }>;
  loadingInvestmentId: string | null;
  onLoadMore: (id: string, page: number) => void;
  timeZone: string;
}) {
  const groups = [...investments.reduce((map, investment) => {
    const sold = investment.status === "TOTAL_WITHDRAWAL";
    const label = `${sold ? "Vendidos · " : ""}${investmentGroup(investment.type)}`;
    map.set(label, [...(map.get(label) ?? []), investment]);
    return map;
  }, new Map<string, Investment[]>())].sort(([left], [right]) => {
    const leftSold = left.startsWith("Vendidos · ");
    const rightSold = right.startsWith("Vendidos · ");
    if (leftSold !== rightSold) return leftSold ? 1 : -1;
    const leftLabel = left.replace(/^Vendidos · /, "");
    const rightLabel = right.replace(/^Vendidos · /, "");
    const leftIndex = INVESTMENT_TYPE_ORDER.indexOf(leftLabel);
    const rightIndex = INVESTMENT_TYPE_ORDER.indexOf(rightLabel);
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex) || left.localeCompare(right);
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-4 border-b">
        <div className="flex items-center gap-3">
          <BriefcaseBusiness className="size-5 text-[var(--primary)]" />
          <div>
            <CardTitle>Carteira ({investments.filter((investment) => investment.status === "ACTIVE" && investment.providerAvailable).length} ativos)</CardTitle>
            <CardDescription>Posições e movimentações informadas diretamente pelas instituições.</CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {soldCount > 0 && (
            <Button size="sm" variant="outline" onClick={onToggleSold}>
              {showSold ? "Ocultar vendidos" : `Mostrar vendidos (${soldCount})`}
            </Button>
          )}
          <strong className="text-xl tabular-nums text-[var(--success)]">{money(total)}</strong>
        </div>
      </CardHeader>

      {!investments.length && (
        <CardContent className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          Nenhum investimento sincronizado.
        </CardContent>
      )}

      {groups.map(([label, groupInvestments]) => {
        const groupTotal = groupInvestments.reduce((sum, investment) => sum + Number(investment.balance), 0);
        return (
          <section key={label}>
            <div className="flex items-center justify-between border-b bg-[var(--muted)]/35 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <span>{label}</span>
              <span className="tabular-nums">{money(groupTotal)}</span>
            </div>
            {groupInvestments.map((investment) => {
              const expanded = investment.id === expandedId;
              const sold = investment.status === "TOTAL_WITHDRAWAL";
              const share = !sold && total ? (Number(investment.balance) / total) * 100 : 0;
              return (
                <div key={investment.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => onToggle(investment.id)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 text-left transition hover:bg-[var(--muted)]/25"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--muted)]">
                        <TrendingUp className="size-4 text-[var(--muted-foreground)]" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <strong className="block truncate text-sm">{investment.name}</strong>
                          {sold && <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">Vendido</span>}
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                          {investment.institutionImageUrl && (
                            <span className="grid size-4 shrink-0 place-items-center overflow-hidden rounded bg-white p-0.5">
                              <Image src={investment.institutionImageUrl} alt="" width={16} height={16} unoptimized className="size-full object-contain" />
                            </span>
                          )}
                          <span className="truncate">{investment.investmentInstitution || investment.institution}</span>
                          <span>·</span>
                          <span className="shrink-0">{investmentSubtype(investment.subtype, investment.type)}</span>
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-3 text-right">
                      <span>
                        <strong className="block text-sm tabular-nums text-[var(--success)]">
                          {money(investment.balance, investment.currencyCode)}
                        </strong>
                        <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                          {share.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                        </span>
                      </span>
                      {expanded ? <ChevronUp className="size-4 text-[var(--muted-foreground)]" /> : <ChevronDown className="size-4 text-[var(--muted-foreground)]" />}
                    </span>
                  </button>
                  {expanded && (
                    <InvestmentDetails
                      investment={{
                        ...investment,
                        transactions: loadedTransactions[investment.id] ?? [],
                      }}
                      loading={loadingInvestmentId === investment.id}
                      loadedTotal={transactionPages[investment.id]?.total ?? investment.transactionCount}
                      timeZone={timeZone}
                      onLoadMore={() => onLoadMore(
                        investment.id,
                        (transactionPages[investment.id]?.page ?? 0) + 1,
                      )}
                    />
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </Card>
  );
}

function InvestmentDetails({
  investment,
  loading = false,
  loadedTotal,
  timeZone,
  onLoadMore,
}: {
  investment: Investment;
  loading?: boolean;
  loadedTotal: number;
  timeZone: string;
  onLoadMore: () => void;
}) {
  const details = [
    { label: "Saldo", value: money(investment.balance, investment.currencyCode) },
    { label: "Rentabilidade", value: rate(investment) },
    investment.amountOriginal !== null ? { label: "Valor investido", value: money(investment.amountOriginal, investment.currencyCode) } : null,
    investment.amount !== null ? { label: "Valor bruto informado", value: money(investment.amount, investment.currencyCode) } : null,
    investment.amountProfit !== null ? { label: "Lucro / prejuízo", value: money(investment.amountProfit, investment.currencyCode) } : null,
    investment.amountWithdrawal !== null ? { label: "Disponível para resgate", value: money(investment.amountWithdrawal, investment.currencyCode) } : null,
    investment.code ? { label: "Código / ticker", value: investment.code } : null,
    investment.isin ? { label: "ISIN", value: investment.isin } : null,
    investment.quantity !== null ? { label: "Quantidade", value: decimal(investment.quantity) } : null,
    investment.value !== null ? { label: "Valor unitário", value: money(investment.value, investment.currencyCode) } : null,
    investment.lastMonthRate !== null ? { label: "Rentabilidade no mês", value: percentage(investment.lastMonthRate) } : null,
    investment.lastTwelveMonthsRate !== null ? { label: "Rentabilidade em 12 meses", value: percentage(investment.lastTwelveMonthsRate) } : null,
    investment.annualRate !== null ? { label: "Rentabilidade anual", value: percentage(investment.annualRate) } : null,
    investment.fixedAnnualRate !== null ? { label: "Taxa fixa anual", value: percentage(investment.fixedAnnualRate) } : null,
    investment.taxes !== null ? { label: "Imposto de renda", value: money(investment.taxes, investment.currencyCode) } : null,
    investment.taxes2 !== null ? { label: "IOF / outros impostos", value: money(investment.taxes2, investment.currencyCode) } : null,
    investment.issuer ? { label: "Emissor", value: investment.issuer } : null,
    investment.issuerCnpj ? { label: "CNPJ do emissor", value: investment.issuerCnpj } : null,
    investment.institutionNumber ? { label: "CNPJ da instituição", value: investment.institutionNumber } : null,
    investment.insurerName ? { label: "Seguradora", value: investment.insurerName } : null,
    investment.insurerCnpj ? { label: "CNPJ da seguradora", value: investment.insurerCnpj } : null,
    investment.owner ? { label: "Titular", value: investment.owner } : null,
    investment.number ? { label: "Número", value: investment.number } : null,
    investment.issueDate ? { label: "Emissão", value: shortDate(investment.issueDate, timeZone) } : null,
    investment.purchaseDate ? { label: "Compra", value: shortDate(investment.purchaseDate, timeZone) } : null,
    investment.gracePeriodDate ? { label: "Fim da carência", value: shortDate(investment.gracePeriodDate, timeZone) } : null,
    investment.dueDate ? { label: "Vencimento", value: shortDate(investment.dueDate, timeZone) } : null,
    investment.quotaDate ? { label: "Data da posição", value: shortDate(investment.quotaDate, timeZone) } : null,
    status(investment.status) ? { label: "Status", value: status(investment.status)! } : null,
    { label: "Atualizado pela instituição", value: date(investment.updatedAt, timeZone) },
  ].filter((item): item is { label: string; value: string } => item !== null);

  return (
    <div className="border-t bg-[var(--muted)]/10 px-5 py-5">
      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {details.map((detail) => (
          <div key={detail.label} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{detail.label}</dt>
            <dd className="mt-1 break-words text-sm font-medium tabular-nums">{detail.value}</dd>
          </div>
        ))}
      </dl>

      {investment.metadata && <JsonDetails title="Dados adicionais" value={investment.metadata} />}

      <div className="mt-6">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Movimentações ({investment.transactionCount})
        </p>
        <div className="space-y-2">
          {loading && (
            <p className="rounded-xl border border-dashed p-4 text-center text-xs text-[var(--muted-foreground)]">
              Carregando movimentações…
            </p>
          )}
          {investment.transactions.map((transaction) => (
            <div key={transaction.id} className="rounded-xl border bg-[var(--card)] px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cn(
                    "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
                    transaction.movementType === "DEBIT"
                      ? "bg-[var(--danger)]/10 text-[var(--danger)]"
                      : "bg-[var(--success)]/10 text-[var(--success)]",
                  )}>
                    {transaction.movementType === "DEBIT" ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <strong className="block text-xs">{transaction.type.replaceAll("_", " ")}</strong>
                    <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                      {shortDate(transaction.date, timeZone)}
                      {transaction.quantity !== null ? ` · ${decimal(transaction.quantity)} un.` : ""}
                      {transaction.description ? ` · ${transaction.description}` : ""}
                    </p>
                    <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                      {transaction.value !== null ? `Valor unitário: ${money(transaction.value, investment.currencyCode)}` : ""}
                      {transaction.netAmount !== null ? `${transaction.value !== null ? " · " : ""}Líquido: ${money(transaction.netAmount, investment.currencyCode)}` : ""}
                      {transaction.agreedRate !== null ? ` · Taxa acordada: ${percentage(transaction.agreedRate)}` : ""}
                      {transaction.brokerageNumber ? ` · Nota: ${transaction.brokerageNumber}` : ""}
                    </p>
                  </div>
                </div>
                <strong className="shrink-0 text-xs tabular-nums text-[var(--success)]">
                  {transaction.amount !== null ? money(transaction.amount, investment.currencyCode) : "—"}
                </strong>
              </div>
              {Boolean(transaction.expenses) && (
                <JsonDetails title="Despesas da movimentação" value={transaction.expenses} compact />
              )}
            </div>
          ))}
          {!loading && investment.transactions.length < loadedTotal && (
            <div className="pt-2 text-center">
              <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>
                Carregar mais movimentações
              </Button>
            </div>
          )}
          {!loading && !investment.transactions.length && (
            <p className="rounded-xl border border-dashed p-4 text-center text-xs text-[var(--muted-foreground)]">
              A instituição não informou movimentações para este ativo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function JsonDetails({ title, value, compact = false }: { title: string; value: unknown; compact?: boolean }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== null && entry !== "");
  if (!entries.length) return null;
  return (
    <div className={compact ? "mt-2 border-t pt-2" : "mt-6 border-t pt-4"}>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</p>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([key, entry]) => (
          <div key={key} className="text-xs">
            <dt className="text-[var(--muted-foreground)]">{key}</dt>
            <dd className="break-words font-medium">{typeof entry === "object" ? JSON.stringify(entry) : String(entry)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  otherCurrencies = [],
}: {
  icon: typeof Landmark;
  label: string;
  value: string;
  otherCurrencies?: string[];
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="grid size-11 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]"><Icon className="size-5" /></span>
        <div>
          <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          {otherCurrencies.length > 0 && (
            <p className="mt-1 text-xs tabular-nums text-[var(--muted-foreground)]">
              Outras moedas: {otherCurrencies.join(" · ")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DataCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Card className="md:col-span-2 xl:col-span-3">
      <CardContent className="flex flex-col items-center py-12 text-center">
        <span className="mb-4 grid size-12 place-items-center rounded-full bg-[var(--muted)]"><Landmark className="size-5" /></span>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-sm text-[var(--muted-foreground)]">{text}</p>
      </CardContent>
    </Card>
  );
}
