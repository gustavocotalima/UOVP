"use client";
import { PrivateValue } from "@/components/ui/private-value";
import { Button } from "@/components/ui/button";
import { LoaderCircle } from "lucide-react";
import type { AssetHoldingDto } from "../types";
import type { HoldingTransactionsState } from "../use-holding-transactions";
import { operationTypeLabel, reviewMoney, reviewDecimal, reviewOperationDate } from "./presentation";
function operationMoney(value: string | null, currency: string | null | undefined) {
  if (value === null) return "—";
  return <PrivateValue>{currency ? reviewMoney(value, currency) : `${reviewDecimal(value)} · moeda não informada`}</PrivateValue>;
}
type HoldingHistoryProps = {
  holding: AssetHoldingDto;
  movementState?: HoldingTransactionsState;
  loadHoldingTransactions: (id: string, page?: number, append?: boolean) => Promise<void>;
  holdingColumnCount?: number;
};
export function HoldingHistoryMobile({ holding, movementState, loadHoldingTransactions }: HoldingHistoryProps) {
  if (!(holding.transactionCount > 0 || movementState?.loading || movementState?.error))
    return null;
  const displayedTransactions = movementState?.transactions ?? holding.transactions;
  return (<div className="mt-3 border-t pt-3">
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Operações informadas ({holding.transactionCount})</p>
    <div className="space-y-2">
      {displayedTransactions.map((transaction) => {
        const operationAmount = transaction.netAmount ?? transaction.amount;
        return (<div key={transaction.id} className="rounded-lg bg-[var(--muted)]/35 p-3 text-xs">
          <div className="flex items-start justify-between gap-3"><span><strong>{operationTypeLabel(transaction.type)}</strong><span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">{reviewOperationDate(transaction.tradeDate ?? transaction.date)}</span></span><strong>{operationMoney(operationAmount, transaction.currencyCode)}</strong></div>
          <div className="mt-2 flex justify-between gap-3 text-[10px] text-[var(--muted-foreground)]"><span><PrivateValue>{transaction.quantity === null ? "Quantidade —" : `${Number(transaction.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 8 })} un.`}</PrivateValue></span><span>{transaction.value === null ? "Preço —" : operationMoney(transaction.value, transaction.currencyCode)}</span></div>
        </div>);
      })}
      {movementState?.loading && <div className="flex items-center justify-center gap-2 py-3 text-xs text-[var(--muted-foreground)]"><LoaderCircle className="size-4 animate-spin" /> Carregando…</div>}
      {movementState?.error && <div className="flex items-center justify-between gap-2 text-xs text-[var(--danger)]"><span>{movementState.error}</span><Button size="sm" variant="outline" onClick={() => void loadHoldingTransactions(holding.id)}>Tentar novamente</Button></div>}
      {movementState && !movementState.loading && !movementState.error && movementState.transactions.length < movementState.total && <Button className="w-full" size="sm" variant="outline" onClick={() => void loadHoldingTransactions(holding.id, movementState.page + 1, true)}>Carregar mais</Button>}
    </div>
  </div>);
}
export function HoldingHistoryDesktop({ holding, movementState, loadHoldingTransactions, holdingColumnCount = 1 }: HoldingHistoryProps) {
  if (!(holding.transactionCount > 0 || movementState?.loading || movementState?.error))
    return null;
  const displayedTransactions = movementState?.transactions ?? holding.transactions;
  return (<tr className="border-b last:border-0 bg-[var(--muted)]/15">
    <td colSpan={holdingColumnCount} className="px-4 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Operações informadas ({holding.transactionCount})</p>
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[110px_minmax(110px,1fr)_110px_130px_130px] gap-3 border-b bg-[var(--muted)]/25 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <span>Data</span><span>Operação</span><span>Quantidade</span><span>Preço unitário</span><span className="text-right">Valor</span>
        </div>
        {displayedTransactions.map((transaction) => {
          const operationAmount = transaction.netAmount ?? transaction.amount;
          return (<div key={transaction.id} className="grid grid-cols-[110px_minmax(110px,1fr)_110px_130px_130px] gap-3 border-b px-3 py-2 last:border-0">
            <span className="whitespace-nowrap">{reviewOperationDate(transaction.tradeDate ?? transaction.date)}</span>
            <span><strong>{operationTypeLabel(transaction.type)}</strong>{transaction.description && <span className="mt-0.5 block truncate text-[10px] text-[var(--muted-foreground)]" title={transaction.description}>{transaction.description}</span>}</span>
            <span className="whitespace-nowrap">{transaction.quantity === null ? "—" : <PrivateValue>{Number(transaction.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</PrivateValue>}</span>
            <span className="whitespace-nowrap">{operationMoney(transaction.value, transaction.currencyCode)}</span>
            <span className="whitespace-nowrap text-right font-semibold">{operationMoney(operationAmount, transaction.currencyCode)}</span>
          </div>);
        })}
        {movementState?.loading && (<div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-[var(--muted-foreground)]">
          <LoaderCircle className="size-4 animate-spin" />
          Carregando movimentações…
        </div>)}
        {movementState?.error && (<div className="flex items-center justify-between gap-3 px-3 py-3 text-xs text-[var(--danger)]">
          <span>{movementState.error}</span>
          <Button size="sm" variant="outline" onClick={() => void loadHoldingTransactions(holding.id)}>
            Tentar novamente
          </Button>
        </div>)}
        {movementState && !movementState.loading && !movementState.error && movementState.transactions.length < movementState.total && (<div className="flex justify-center px-3 py-3">
          <Button size="sm" variant="outline" onClick={() => void loadHoldingTransactions(holding.id, movementState.page + 1, true)}>
            Carregar mais
          </Button>
        </div>)}
      </div>
    </td>
  </tr>);
}
