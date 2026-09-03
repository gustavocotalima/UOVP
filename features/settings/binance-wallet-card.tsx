"use client";

import { useState, useTransition, type FormEvent } from "react";
import Decimal from "decimal.js";
import { AlertTriangle, Coins, ExternalLink, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  disconnectBinanceAction,
  resolveBinanceWalletAssetAction,
  saveBinanceConnectionAction,
  syncBinanceWalletAction,
} from "@/features/portfolio/binance-wallet-actions";
import type { BinanceConnectionStatus } from "@/features/portfolio/binance-wallet-credentials";

function quantity(value: string) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 10 }).format(Number(value));
}

function combinedQuantity(...values: string[]) {
  return values.reduce((total, value) => total.add(value), new Decimal(0)).toString();
}

function dateTime(value: string | null) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function BinanceWalletCard({ initialStatus }: { initialStatus: BinanceConnectionStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await saveBinanceConnectionAction({ apiKey, apiSecret });
        setStatus(result.connection);
        setApiKey("");
        setApiSecret("");
        setMessage({
          kind: result.sync.status === "FAILED" ? "error" : "success",
          text: result.sync.message ?? "Binance conectada e carteira consultada.",
        });
      } catch (error) {
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível conectar a Binance." });
      }
    });
  }

  function synchronize() {
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await syncBinanceWalletAction();
        setStatus(result.connection);
        setMessage({
          kind: result.sync.status === "FAILED" || result.sync.status === "PARTIAL" ? "error" : "success",
          text: result.sync.message ?? "Carteira da Binance sincronizada.",
        });
      } catch (error) {
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível sincronizar a Binance." });
      }
    });
  }

  function resolveAsset(
    walletAssetId: string,
    resolution: "ADD" | "REPLACE_MANUAL" | "KEEP_BOTH" | "IGNORE",
  ) {
    setMessage(undefined);
    startTransition(async () => {
      try {
        setStatus(await resolveBinanceWalletAssetAction({ walletAssetId, resolution }));
        setMessage({ kind: "success", text: resolution === "IGNORE" ? "Ativo ignorado." : "Ativo adicionado à carteira." });
      } catch (error) {
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível atualizar o ativo." });
      }
    });
  }

  function disconnect(resolution: "KEEP_MANUAL" | "REMOVE") {
    startTransition(async () => {
      try {
        await disconnectBinanceAction(resolution);
        setStatus({ ...initialStatus, configured: false, assets: [], syncPending: false });
        setDisconnectOpen(false);
        setMessage({ kind: "success", text: resolution === "KEEP_MANUAL" ? "Binance desconectada; posições preservadas como manuais." : "Binance e posições importadas removidas." });
      } catch (error) {
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível desconectar a Binance." });
      }
    });
  }

  const waiting = status.assets.filter((asset) => asset.status === "AVAILABLE" || asset.status === "NEEDS_REVIEW");
  const tracked = status.assets.filter((asset) => asset.status === "TRACKED");
  const ignored = status.assets.filter((asset) => asset.status === "IGNORED");

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
                <Coins className="size-5" />
              </span>
              <div>
                <CardTitle>Carteira Binance</CardTitle>
                <CardDescription>Importe saldos de Spot, Funding e Simple Earn. Você escolhe quais ativos entram na carteira.</CardDescription>
              </div>
            </div>
            {status.configured && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={synchronize} disabled={pending}>
                  <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} /> Sincronizar
                </Button>
                <Button type="button" variant="danger" onClick={() => setDisconnectOpen(true)} disabled={pending}>
                  <Trash2 className="size-4" /> Desconectar
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error"
              ? "rounded-xl bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]"
              : "rounded-xl bg-[var(--success)]/10 p-3 text-sm text-[var(--success)]"}>
              {message.text}
            </p>
          )}

          {status.configured ? (
            <>
              <div className="grid gap-3 rounded-xl border bg-[var(--muted)]/25 p-4 sm:grid-cols-2 lg:grid-cols-5">
                <div><p className="text-xs text-[var(--muted-foreground)]">API Key</p><p className="mt-1 font-semibold">••••{status.apiKeyLastFour}</p></div>
                <div><p className="text-xs text-[var(--muted-foreground)]">Última sincronização</p><p className="mt-1 font-semibold">{dateTime(status.lastSyncAt)}</p></div>
                <div><p className="text-xs text-[var(--muted-foreground)]">Acompanhados</p><p className="mt-1 font-semibold">{tracked.length}</p></div>
                <div><p className="text-xs text-[var(--muted-foreground)]">Aguardando seleção</p><p className="mt-1 font-semibold">{waiting.length}</p></div>
                <div><p className="text-xs text-[var(--muted-foreground)]">Ignorados</p><p className="mt-1 font-semibold">{ignored.length}</p></div>
              </div>
              {status.permissionWarning && (
                <div className="flex items-start gap-3 rounded-xl border border-[var(--danger)]/35 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                  <p>Esta chave permite {status.withdrawalsEnabled ? "saques" : "operações"}. O UOVP usa somente leitura, mas recomendamos criar uma chave sem negociação e sem saques.</p>
                </div>
              )}
              {!status.ipRestricted && (
                <div className="flex items-start gap-3 rounded-xl border p-4 text-sm text-[var(--muted-foreground)]">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" />
                  <p>A chave não possui restrição de IP. A conexão funciona, mas restringir a chave ao IP do servidor reduz o risco de uso indevido.</p>
                </div>
              )}
              {status.lastError && <p role="alert" className="text-sm text-[var(--danger)]">{status.lastError}</p>}

              {waiting.length > 0 && (
                <section className="space-y-3">
                  <div><h3 className="font-semibold">Escolha os ativos</h3><p className="text-sm text-[var(--muted-foreground)]">Nada novo entra nos totais até você confirmar.</p></div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {waiting.map((asset) => (
                      <div key={asset.id} className="rounded-xl border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div><p className="font-semibold">{asset.symbol}</p><p className="text-xs text-[var(--muted-foreground)]">{asset.name ?? "Criptoativo"}</p></div>
                          <p className="text-sm font-semibold">{quantity(asset.totalQuantity)}</p>
                        </div>
                        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                          Spot {quantity(asset.spotQuantity)} · Funding {quantity(asset.fundingQuantity)} · Earn {quantity(combinedQuantity(asset.earnFlexibleQuantity, asset.earnLockedQuantity))}
                        </p>
                        {asset.valuationSupported === false && (
                          <p className="mt-2 text-xs font-medium text-[var(--danger)]">{asset.valuationError ?? "Sem cotação suportada pela Binance."}</p>
                        )}
                        <div className="mt-4 flex flex-wrap gap-2">
                          {asset.status === "NEEDS_REVIEW" ? (
                            <>
                              <Button size="sm" onClick={() => resolveAsset(asset.id, "REPLACE_MANUAL")} disabled={pending || asset.valuationSupported === false}>Substituir manual</Button>
                              <Button size="sm" variant="outline" onClick={() => resolveAsset(asset.id, "KEEP_BOTH")} disabled={pending || asset.valuationSupported === false}>Manter ambos</Button>
                            </>
                          ) : (
                            <Button size="sm" onClick={() => resolveAsset(asset.id, "ADD")} disabled={pending || asset.valuationSupported === false}>Acompanhar</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => resolveAsset(asset.id, "IGNORE")} disabled={pending}>Ignorar</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {tracked.length > 0 && (
                <section className="space-y-3">
                  <h3 className="font-semibold">Ativos acompanhados</h3>
                  <div className="divide-y rounded-xl border">
                    {tracked.map((asset) => (
                      <div key={asset.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(80px,auto))] sm:items-center">
                        <div><p className="font-semibold">{asset.symbol}</p><p className="text-xs text-[var(--muted-foreground)]">Total {quantity(asset.totalQuantity)}</p></div>
                        <p className="text-xs"><span className="text-[var(--muted-foreground)]">Spot</span><br />{quantity(asset.spotQuantity)}</p>
                        <p className="text-xs"><span className="text-[var(--muted-foreground)]">Funding</span><br />{quantity(asset.fundingQuantity)}</p>
                        <p className="text-xs"><span className="text-[var(--muted-foreground)]">Earn flexível</span><br />{quantity(asset.earnFlexibleQuantity)}</p>
                        <p className="text-xs"><span className="text-[var(--muted-foreground)]">Earn bloqueado</span><br />{quantity(asset.earnLockedQuantity)}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {ignored.length > 0 && (
                <section className="space-y-3">
                  <h3 className="font-semibold">Ativos ignorados</h3>
                  <div className="divide-y rounded-xl border">
                    {ignored.map((asset) => (
                      <div key={asset.id} className="flex items-center justify-between gap-3 p-4">
                        <div><p className="font-semibold">{asset.symbol}</p><p className="text-xs text-[var(--muted-foreground)]">Excluído dos totais da carteira</p></div>
                        <p className="text-sm font-semibold">{quantity(asset.totalQuantity)}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <form onSubmit={connect} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="binance-api-key">API Key</Label><Input id="binance-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required maxLength={512} /></div>
                <div className="space-y-2"><Label htmlFor="binance-api-secret">Secret Key</Label><Input id="binance-api-secret" type="password" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} autoComplete="off" required maxLength={512} /></div>
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <a className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline" href="https://www.binance.com/en/my/settings/api-management" target="_blank" rel="noreferrer">Criar chave somente leitura <ExternalLink className="size-4" /></a>
                <Button disabled={pending || apiKey.trim().length < 8 || apiSecret.trim().length < 8}>{pending ? "Validando…" : "Validar e conectar"}</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Desconectar a Binance"
        description="Escolha o que deve acontecer com as posições importadas."
        className="max-w-lg"
      >
        <div className="space-y-3">
          <Button className="w-full justify-start" variant="outline" onClick={() => disconnect("KEEP_MANUAL")} disabled={pending}>Preservar como posições manuais</Button>
          <Button className="w-full justify-start" variant="danger" onClick={() => disconnect("REMOVE")} disabled={pending}>Remover posições importadas</Button>
        </div>
      </Dialog>
    </>
  );
}
