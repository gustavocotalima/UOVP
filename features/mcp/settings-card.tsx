"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Bot, Copy, Link2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  registerMcpClientAction,
  revokeAllMcpGrantsAction,
  revokeMcpGrantAction,
  setMcpEnabledAction,
} from "./actions";
import type { McpScope, McpSettingsDto } from "./types";

const scopeLabels: Record<McpScope, string> = {
  "finance:read": "Resumos, orçamento e metas",
  "accounts:read": "Contas, cartões e faturas",
  "transactions:read": "Transações individuais",
  "portfolio:read": "Carteira e simulações",
  "balance-sheet:read": "Bens e dívidas",
};

function dateTime(value: string | null) {
  if (!value) return "Ainda não acessou";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

type Confirmation = { kind: "DISABLE" } | { kind: "REVOKE_ALL" } | { kind: "REVOKE"; grantId: string; clientName: string };

export function McpSettingsCard({ initialSettings }: { initialSettings: McpSettingsDto }) {
  const [settings, setSettings] = useState(initialSettings);
  const [clientName, setClientName] = useState("");
  const [redirectUris, setRedirectUris] = useState("");
  const [registeredClientId, setRegisteredClientId] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [pending, startTransition] = useTransition();

  function updateEnabled() {
    if (settings.enabled) {
      setConfirmation({ kind: "DISABLE" });
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      try {
        setSettings(await setMcpEnabledAction(true));
        setMessage({ kind: "success", text: "MCP habilitado. Cada agente ainda precisa da sua autorização." });
      } catch {
        setMessage({ kind: "error", text: "Não foi possível habilitar o MCP. Tente novamente." });
      }
    });
  }

  function confirmRevoke() {
    if (!confirmation) return;
    const action = confirmation;
    setMessage(undefined);
    startTransition(async () => {
      try {
        const nextSettings = action.kind === "DISABLE"
          ? await setMcpEnabledAction(false)
          : action.kind === "REVOKE_ALL"
            ? await revokeAllMcpGrantsAction()
            : await revokeMcpGrantAction(action.grantId);
        setSettings(nextSettings);
        setConfirmation(null);
        setMessage({ kind: "success", text: action.kind === "DISABLE" ? "MCP desabilitado e acessos revogados." : "Acesso revogado." });
      } catch {
        setConfirmation(null);
        setMessage({ kind: "error", text: "Não foi possível revogar o acesso. Tente novamente." });
      }
    });
  }

  function registerClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    startTransition(async () => {
      try {
        const result = await registerMcpClientAction({
          name: clientName.trim(),
          redirectUris: redirectUris.split(/\r?\n/).map((uri) => uri.trim()).filter(Boolean),
        });
        setSettings(result.settings);
        setRegisteredClientId(result.clientId);
        setClientName("");
        setRedirectUris("");
        setMessage({ kind: "success", text: "Cliente cadastrado. O Client ID identifica o agente; não é uma senha nem uma autorização de acesso." });
      } catch {
        setMessage({ kind: "error", text: "Não foi possível cadastrar. Confira o nome e as URLs HTTPS ou de callback em 127.0.0.1." });
      }
    });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage({ kind: "success", text: "Copiado." });
    } catch {
      setMessage({ kind: "error", text: "Não foi possível copiar. Selecione e copie o texto manualmente." });
    }
  }

  const confirmationTitle = confirmation?.kind === "DISABLE"
    ? "Desabilitar acesso por MCP?"
    : confirmation?.kind === "REVOKE_ALL"
      ? "Revogar todos os agentes?"
      : `Revogar ${confirmation?.kind === "REVOKE" ? confirmation.clientName : "agente"}?`;

  return (
    <>
      <Card data-testid="mcp-settings">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]"><Bot className="size-5" aria-hidden="true" /></span>
              <div>
                <CardTitle>Agentes de IA / MCP</CardTitle>
                <CardDescription>Autorize ChatGPT, Codex ou outros agentes a analisar os seus dados. Somente leitura.</CardDescription>
              </div>
            </div>
            <Button type="button" variant={settings.enabled ? "outline" : "default"} onClick={updateEnabled} disabled={pending || !settings.configured} aria-pressed={settings.enabled}>
              {pending ? "Aguarde…" : settings.enabled ? "Desabilitar MCP" : "Habilitar MCP"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {message && <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${message.kind === "error" ? "bg-[var(--danger)]/10 text-[var(--danger)]" : "bg-[var(--success)]/10 text-[var(--success)]"}`}>{message.text}</p>}
          {!settings.configured && <p role="status" className="rounded-xl border p-4 text-sm text-[var(--muted-foreground)]">O servidor ainda precisa configurar as chaves OAuth e a URL do MCP antes de habilitar o acesso.</p>}
          <div className="flex items-start gap-3 rounded-xl border bg-[var(--muted)]/25 p-4 text-sm">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
            <div className="space-y-2">
              <p>O agente recebe os dados financeiros permitidos por você. Esses dados são compartilhados com o provedor de IA escolhido, conforme as políticas dele.</p>
              <p className="text-[var(--muted-foreground)]">Não há alterações de saldo, operações de investimento ou sincronização de bancos por MCP. Revogar impede novas consultas, mas não apaga dados já enviados ao agente.</p>
            </div>
          </div>
          {settings.endpoint && <div className="space-y-2">
            <Label htmlFor="mcp-endpoint">URL do servidor MCP</Label>
            <div className="flex min-w-0 gap-2">
              <Input id="mcp-endpoint" value={settings.endpoint} readOnly className="min-w-0 font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" aria-label="Copiar URL do MCP" onClick={() => copy(settings.endpoint!)}><Copy className="size-4" aria-hidden="true" /></Button>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">Use Streamable HTTP e OAuth. Entre no UOVP quando o agente abrir a autorização e escolha as permissões.</p>
          </div>}

          <section className="space-y-3" aria-labelledby="mcp-grants-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="mcp-grants-title" className="font-semibold">Agentes autorizados</h3>
              {settings.grants.length > 0 && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmation({ kind: "REVOKE_ALL" })}><Trash2 className="size-4" aria-hidden="true" />Revogar todos</Button>}
            </div>
            {settings.grants.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">Nenhum agente autorizado. Habilitar o MCP não concede acesso automaticamente.</p> : <div className="divide-y rounded-xl border">
              {settings.grants.map((grant) => <div key={grant.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="mcp-grant">
                <div className="min-w-0 space-y-2">
                  <p className="break-words font-semibold">{grant.clientName}</p>
                  <ul className="flex flex-wrap gap-2" aria-label="Permissões concedidas">{grant.scopes.map((scope) => <li key={scope} className="rounded-lg bg-[var(--muted)] px-2 py-1 text-xs">{scopeLabels[scope]}</li>)}</ul>
                  <p className="text-xs text-[var(--muted-foreground)]">Autorizado em {dateTime(grant.createdAt)} · Último acesso: {dateTime(grant.lastUsedAt)}</p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setConfirmation({ kind: "REVOKE", grantId: grant.id, clientName: grant.clientName })}><Trash2 className="size-4" aria-hidden="true" />Revogar acesso</Button>
              </div>)}
            </div>}
          </section>

          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-semibold">Cliente personalizado / configuração avançada</summary>
            <div className="mt-4 space-y-4">
              <p className="text-sm text-[var(--muted-foreground)]">ChatGPT e Codex compatíveis podem identificar o cliente automaticamente. Cadastre um cliente público apenas quando o agente exigir um Client ID. Nenhum segredo é gerado.</p>
              <form onSubmit={registerClient} className="space-y-3">
                <div className="space-y-2"><Label htmlFor="mcp-client-name">Nome do cliente</Label><Input id="mcp-client-name" value={clientName} onChange={(event) => setClientName(event.target.value)} required maxLength={100} disabled={pending || !settings.enabled} /></div>
                <div className="space-y-2"><Label htmlFor="mcp-client-redirects">URLs de retorno (uma por linha)</Label><textarea id="mcp-client-redirects" value={redirectUris} onChange={(event) => setRedirectUris(event.target.value)} rows={3} maxLength={4000} required disabled={pending || !settings.enabled} className="w-full resize-y rounded-xl border bg-transparent px-3 py-2 text-sm focus-visible:outline-2 disabled:opacity-45" placeholder="http://127.0.0.1/callback" /><p className="text-xs text-[var(--muted-foreground)]">Copie o callback informado pelo cliente. HTTPS exige URL exata; callbacks nativos usam 127.0.0.1. Não use curingas.</p></div>
                <Button type="submit" disabled={pending || !settings.enabled || !clientName.trim() || !redirectUris.trim()}><Link2 className="size-4" aria-hidden="true" />Cadastrar cliente</Button>
              </form>
              {registeredClientId && <div className="space-y-2" role="status"><Label htmlFor="mcp-registered-client">Client ID cadastrado</Label><div className="flex min-w-0 gap-2"><Input id="mcp-registered-client" value={registeredClientId} readOnly className="min-w-0 font-mono text-xs" /><Button type="button" variant="outline" size="icon" aria-label="Copiar Client ID" onClick={() => copy(registeredClientId)}><Copy className="size-4" aria-hidden="true" /></Button></div></div>}
              {settings.clients.length > 0 && <ul className="space-y-3 text-sm" aria-label="Clientes cadastrados">{settings.clients.map((client) => <li key={client.id} className="space-y-1 rounded-xl bg-[var(--muted)]/25 p-3"><p className="font-semibold">{client.name}</p><p className="break-all font-mono text-xs">{client.id}</p>{client.redirectUris.map((uri) => <p key={uri} className="break-all text-xs text-[var(--muted-foreground)]">{uri}</p>)}</li>)}</ul>}
            </div>
          </details>
        </CardContent>
      </Card>
      <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title={confirmationTitle} description="O acesso será interrompido imediatamente. Isso não remove informações que o agente já recebeu. Uma nova autorização será necessária para consultar novamente." confirmLabel={confirmation?.kind === "DISABLE" ? "Desabilitar e revogar" : "Revogar acesso"} danger pending={pending} onConfirm={confirmRevoke} />
    </>
  );
}
