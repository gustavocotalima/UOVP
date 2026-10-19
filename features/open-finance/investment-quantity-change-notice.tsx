"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { PrivateValue } from "@/components/ui/private-value";
import { Button } from "@/components/ui/button";
import type { PluggyQuantityChangeDto } from "@/features/portfolio/types";
import { resolvePluggyQuantityChangeAction } from "./diagram-actions";

function quantity(value: string | null) {
  return value === null ? "Não informada" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 10 });
}

function snapshotKey(change: PluggyQuantityChangeDto) {
  return JSON.stringify([change.linkId, change.expectedUpdatedAt, change.providerQuantity]);
}

export function InvestmentQuantityChangeNotice({ changes, syncBusy = false }: {
  changes: PluggyQuantityChangeDto[];
  syncBusy?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const visible = changes.filter((change) => !resolved.has(snapshotKey(change)));
  if (!visible.length && !message) return null;

  function decide(change: PluggyQuantityChangeDto, decision: "PROVIDER" | "KEEP_MANUAL") {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await resolvePluggyQuantityChangeAction({
          linkId: change.linkId,
          expectedUpdatedAt: change.expectedUpdatedAt,
          expectedProviderQuantity: change.providerQuantity,
          decision,
        });
        if (result.status === "SAVED") {
          setResolved((current) => new Set([...current, snapshotKey(change)]));
        } else if (result.status === "BUSY") {
          setMessage("Aguarde o fim da sincronização do Open Finance e tente novamente.");
        } else if (result.status === "CONFLICT") {
          setMessage("A quantidade mudou novamente. Confira os valores atualizados antes de escolher.");
        } else {
          setMessage("Esta posição não está mais disponível para revisão. Os dados serão atualizados.");
        }
        router.refresh();
      } catch {
        setMessage("Não foi possível salvar sua escolha. Tente novamente.");
        router.refresh();
      }
    });
  }

  return (
    <section aria-label="Revisão de quantidades da instituição" className="space-y-4 rounded-2xl border border-[var(--primary)]/45 bg-[var(--primary)]/5 p-4 sm:p-5">
      <div role="status" className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">A instituição atualizou quantidades</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            A Carteira continua usando as quantidades manuais. Escolha se deseja voltar à sincronização automática ou mantê-las. Nenhuma troca será feita sem sua escolha.
          </p>
        </div>
      </div>
      {visible.map((change) => (
        <div key={snapshotKey(change)} className="space-y-3 rounded-xl border bg-[var(--card)] p-3">
          <strong className="block break-words text-sm">{change.name}{change.ticker && change.name !== change.ticker ? ` · ${change.ticker}` : ""}</strong>
          <p className="text-xs text-[var(--muted-foreground)]">{change.institution}</p>
          <dl className="grid gap-3 text-xs sm:grid-cols-3">
            <div><dt className="text-[var(--muted-foreground)]">Instituição · anterior</dt><dd className="mt-1 font-semibold"><PrivateValue>{quantity(change.previousProviderQuantity)}</PrivateValue></dd></div>
            <div><dt className="text-[var(--muted-foreground)]">Instituição · agora</dt><dd className="mt-1 font-semibold"><PrivateValue>{quantity(change.providerQuantity)}</PrivateValue></dd></div>
            <div><dt className="text-[var(--muted-foreground)]">Quantidade manual em uso</dt><dd className="mt-1 font-semibold"><PrivateValue>{quantity(change.manualQuantity)}</PrivateValue></dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-auto min-h-9 w-full whitespace-normal sm:w-auto" disabled={pending || syncBusy} onClick={() => decide(change, "PROVIDER")}>Usar quantidade da instituição</Button>
            <Button size="sm" variant="outline" className="h-auto min-h-9 w-full whitespace-normal sm:w-auto" disabled={pending || syncBusy} onClick={() => decide(change, "KEEP_MANUAL")}>Manter quantidade manual</Button>
          </div>
        </div>
      ))}
      {syncBusy && <p className="text-xs text-[var(--muted-foreground)]">Aguarde o fim da sincronização para escolher.</p>}
      {message && <p role="alert" className="text-sm text-[var(--danger)]">{message}</p>}
    </section>
  );
}
