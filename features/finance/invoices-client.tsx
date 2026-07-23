"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ChevronDown, CreditCard, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { calculateInvoices, categoryLabel } from "./calculations";
import type { FinanceData } from "./types";

export function InvoicesClient({ data }: { data: FinanceData }) {
  const cards = data.accounts.filter((account) => account.type === "CREDIT_CARD");
  const [accountId, setAccountId] = useState(cards[0]?.id ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const account = cards.find((card) => card.id === accountId) ?? cards[0];
  const invoices = useMemo(
    () =>
      account
        ? calculateInvoices(
            account,
            data.historyTransactions.filter((transaction) => includeIgnored || !transaction.ignored),
          )
        : [],
    [account, data.historyTransactions, includeIgnored],
  );

  if (!account) {
    return <Card><CardContent className="grid min-h-72 place-items-center text-center"><div><CreditCard className="mx-auto mb-3 size-10 text-[var(--muted-foreground)]" /><p className="font-semibold">Nenhum cartão cadastrado</p><p className="mt-1 text-sm text-[var(--muted-foreground)]">Adicione ou conecte um cartão na seção Contas.</p></div></CardContent></Card>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl bg-[var(--muted)] p-4 text-sm text-[var(--muted-foreground)]"><Info className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" /><p>Faturas fechadas e uma estimativa da próxima fatura são exibidas nesta página.</p></div>
      <label className="block max-w-xl text-sm font-medium">Selecione o cartão<Select className="mt-2 w-full" value={account.id} onChange={(event) => { setAccountId(event.target.value); setExpanded(null); }}>{cards.map((card) => <option key={card.id} value={card.id}>{card.name} {card.numberLastFour ? `•••• ${card.numberLastFour}` : ""}</option>)}</Select></label>

      <Card>
        <CardHeader className="flex-row items-center gap-4">
          <span className="grid size-14 place-items-center overflow-hidden rounded-2xl border bg-white p-2">{account.institutionImageUrl ? <Image src={account.institutionImageUrl} alt="" width={56} height={56} unoptimized className="size-full object-contain" /> : <CreditCard className="size-6 text-black/55" />}</span>
          <div className="min-w-0 flex-1"><CardTitle className="truncate text-lg">{account.name}</CardTitle><p className="mt-1 text-sm text-[var(--muted-foreground)]">•••• •••• •••• {account.numberLastFour || "0000"}</p></div>
          <div className="text-right"><p className="text-xs text-[var(--muted-foreground)]">{account.brand || "CARTÃO"}</p><p className="mt-1 text-xs">Disponível: {account.availableCredit ? formatMoney(Number(account.availableCredit)) : "—"}</p></div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm font-semibold">Faturas</p>
          <div className="space-y-2">
            {invoices.map((invoice) => {
              const open = expanded === invoice.key;
              return (
                <div key={invoice.key} className="overflow-hidden rounded-xl border">
                  <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : invoice.key)} className="flex w-full items-center gap-4 p-4 text-left hover:bg-[var(--muted)]/50">
                    <div className="min-w-0 flex-1"><p className="font-semibold">{String(invoice.month).padStart(2, "0")}/{invoice.year} {invoice.open && <span className="ml-2 rounded-full bg-[var(--primary)]/14 px-2 py-1 text-[10px] text-[var(--primary)]">Fatura em aberto</span>}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{invoice.open ? "Valor estimado — pode diferir do fechamento real" : `Vencimento: ${new Intl.DateTimeFormat("pt-BR").format(new Date(invoice.dueDate))}`}</p></div>
                    <p className={cn("font-semibold", invoice.open && "text-[var(--danger)]")}>{invoice.open ? "-" : ""}{formatMoney(invoice.total)}</p>
                    <ChevronDown className={cn("size-4 transition", open && "rotate-180")} />
                  </button>
                  {open && (
                    <div className="border-t p-4">
                      <label className="mb-4 flex items-center gap-3 text-sm"><input type="checkbox" role="switch" checked={includeIgnored} onChange={(event) => setIncludeIgnored(event.target.checked)} className="size-4 accent-[var(--primary)]" /> Incluir transações ignoradas</label>
                      <div className="overflow-x-auto">
                        <div className="min-w-[760px]">
                          <div className="grid grid-cols-[90px_minmax(220px,1fr)_110px_130px_150px_80px] gap-3 border-b pb-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]"><span>Data</span><span>Descrição</span><span className="text-right">Valor</span><span>Meta</span><span>Tags</span><span>Parcela</span></div>
                          <div className="divide-y">
                            {invoice.transactions.map((transaction) => <div key={transaction.id} className={cn("grid grid-cols-[90px_minmax(220px,1fr)_110px_130px_150px_80px] gap-3 py-3 text-sm", transaction.ignored && "opacity-50")}><span className="text-xs text-[var(--muted-foreground)]">{new Intl.DateTimeFormat("pt-BR").format(new Date(transaction.date))}</span><span className="truncate">{transaction.description}</span><strong className="text-right">{formatMoney(Number(transaction.amount))}</strong><span className="text-xs">{categoryLabel(transaction.budgetCategory, transaction.kind)}</span><span className="flex flex-wrap gap-1">{transaction.tags.length ? transaction.tags.map((tag) => <span key={tag.id} className="rounded-full px-2 py-0.5 text-[10px] text-white" style={{ background: tag.color }}>{tag.name}</span>) : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</span><span className="text-xs">{transaction.installmentNumber && transaction.installmentTotal ? `${transaction.installmentNumber}/${transaction.installmentTotal}` : "—"}</span></div>)}
                          </div>
                          {!invoice.transactions.length && <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Nenhuma transação nesta fatura.</p>}
                        </div>
                      </div>
                      <p className="mt-4 text-xs text-[var(--muted-foreground)]">{invoice.transactions.length} transações nesta fatura</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
