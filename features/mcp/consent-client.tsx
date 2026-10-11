"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authorizeMcpClientAction } from "./actions";
import type { McpScope } from "./types";

const scopeDetails: Record<McpScope, { title: string; description: string }> = {
  "finance:read": { title: "Resumos, orçamento e metas", description: "Resultados financeiros, metas, histórico, tags e saídas por dia." },
  "accounts:read": { title: "Contas, cartões e faturas", description: "Saldos, limites, faturas e informações de câmbio." },
  "transactions:read": { title: "Transações individuais", description: "Valores, descrições, datas, contas e classificações dos lançamentos." },
  "portfolio:read": { title: "Carteira e simulações", description: "Posições, operações disponíveis, notas, alocação e simulações sem salvar." },
  "balance-sheet:read": { title: "Bens e dívidas", description: "Seu levantamento separado de ativos e passivos." },
};

export function McpConsentClient({ clientName, redirectUri, requestedScopes, request }: {
  clientName: string;
  redirectUri: string;
  requestedScopes: McpScope[];
  request: Record<string, string>;
}) {
  const [selectedScopes, setSelectedScopes] = useState(requestedScopes);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function authorize(approved: boolean) {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await authorizeMcpClientAction({ request, approvedScopes: approved ? selectedScopes : [], approved });
        window.location.assign(result.redirectUrl);
      } catch {
        setError("Não foi possível concluir a autorização. Inicie novamente a conexão pelo agente.");
      }
    });
  }

  return (
    <div className="space-y-5" data-testid="mcp-consent">
      <div>
        <h1 className="text-2xl font-semibold">Autorizar agente de IA</h1>
        <p className="mt-2 break-words text-sm text-[var(--muted-foreground)]"><strong className="text-[var(--foreground)]">{clientName}</strong> quer consultar os dados da sua conta UOVP.</p>
      </div>
      <div className="flex items-start gap-3 rounded-xl border bg-[var(--muted)]/25 p-3 text-sm"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" aria-hidden="true" /><p>Somente leitura. O agente não pode editar transações, alterar saldos, executar aportes ou sincronizar bancos.</p></div>
      <fieldset disabled={pending} className="space-y-3">
        <legend className="mb-3 text-sm font-semibold">Escolha as informações permitidas</legend>
        {requestedScopes.map((scope) => <label key={scope} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
          <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={(event) => setSelectedScopes((current) => event.target.checked ? [...current, scope] : current.filter((selected) => selected !== scope))} className="mt-1 size-4 shrink-0 accent-[var(--primary)]" value={scope} />
          <span><span className="block text-sm font-semibold">{scopeDetails[scope].title}</span><span className="mt-1 block text-xs text-[var(--muted-foreground)]">{scopeDetails[scope].description}</span></span>
        </label>)}
      </fieldset>
      <p className="text-xs leading-5 text-[var(--muted-foreground)]">Os dados consultados serão compartilhados com o provedor de IA escolhido. Você pode revogar o acesso em Configurações, mas isso não apaga informações já enviadas. Não autorize clientes que você não reconhece.</p>
      <details className="text-xs text-[var(--muted-foreground)]"><summary className="cursor-pointer">Endereço de retorno do cliente</summary><p className="mt-2 break-all font-mono">{redirectUri}</p></details>
      {error && <p role="alert" className="rounded-xl bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="outline" disabled={pending} onClick={() => authorize(false)} className="sm:flex-1">Não permitir</Button>
        <Button type="button" disabled={pending || selectedScopes.length === 0} onClick={() => authorize(true)} className="sm:flex-1">{pending ? "Aguarde…" : "Autorizar leitura"}</Button>
      </div>
    </div>
  );
}
