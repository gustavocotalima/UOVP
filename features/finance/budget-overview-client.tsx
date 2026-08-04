"use client";

import { useMemo, useState } from "react";
import { Pencil, ReceiptText, TrendingDown, TrendingUp, WalletCards } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatCurrency, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/utils";
import { calculateBudgetCategories, calculatePeriod } from "./calculations";
import { TransactionEditorDialog } from "./transaction-dialogs";
import type { FinanceData, FinanceTransactionDto } from "./types";

export function BudgetOverviewClient({ data }: { data: FinanceData }) {
  const period = useMemo(() => calculatePeriod(data.transactions), [data.transactions]);
  const categories = useMemo(
    () => calculateBudgetCategories(data.transactions, data.goals, period.budgetBaseIncome),
    [data.transactions, data.goals, period.budgetBaseIncome],
  );
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<
    (typeof categories)[number]["category"] | null
  >(null);
  const selectedCategory =
    categories.find((category) => category.category === selectedCategoryKey) ?? null;
  const [editing, setEditing] = useState<FinanceTransactionDto | null>(null);

  return (
    <div className="space-y-6">
      {period.missingFxCount > 0 && (
        <div className="rounded-xl border border-[var(--primary)]/35 bg-[var(--primary)]/8 p-4 text-sm">
          {period.missingFxCount} transação(ões) aguardam conversão para BRL e não entram nos totais.
        </div>
      )}
      <section className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-4 @5xl:gap-4">
        <SummaryCard icon={TrendingUp} label="Entradas brutas" value={period.grossIncome} detail="Todas as entradas reportáveis do mês" />
        <SummaryCard icon={TrendingUp} label="Renda considerada nas metas" value={period.budgetBaseIncome} detail="Entradas sem meta atribuída" />
        <SummaryCard icon={TrendingDown} label="Despesas líquidas" value={period.spent} detail={`${formatPercent(period.budgetBaseIncome > 0 ? period.spent / period.budgetBaseIncome * 100 : 0)} da renda-base utilizada`} danger />
        <SummaryCard icon={WalletCards} label="Saldo Restante" value={period.balance} detail="Valor livre para uso" danger={period.balance < 0} />
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Metas financeiras</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Distribuição da sua renda mensal por categoria</p>
        </div>
        <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
          {categories.map((item) => (
            <Card key={item.category} className="overflow-hidden" data-budget-category={item.category}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold">{item.label}</p>
                    <span className={cn("mt-1 inline-block rounded-full px-2 py-1 text-[11px] font-semibold", item.exceeded ? "bg-[var(--danger)]/12 text-[var(--danger)]" : "bg-[var(--muted)]")}>
                      {item.exceeded ? "Excedido" : formatPercent(item.usage)}
                    </span>
                  </div>
                  <span className="grid size-10 place-items-center rounded-xl" style={{ background: `${item.color}22`, color: item.color }}><ReceiptText className="size-5" /></span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Realizado líquido</p>
                    <p className="mt-1 font-semibold">{formatMoney(item.spent)}</p>
                    {item.appliedIncomeOffsets > 0 && (
                      <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                        {formatMoney(item.expenses)} em saídas − {formatMoney(item.appliedIncomeOffsets)} em entradas compensadas
                      </p>
                    )}
                  </div>
                  <div><p className="text-xs text-[var(--muted-foreground)]">Previsto</p><p className="mt-1 font-semibold">{formatMoney(item.target)}</p></div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--muted)]"><div className="h-full rounded-full" style={{ width: `${Math.min(100, item.usage)}%`, background: item.exceeded ? "var(--danger)" : item.color }} /></div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className={cn("text-xs font-semibold", item.exceeded ? "text-[var(--danger)]" : "text-[var(--success)]")}>{item.exceeded ? "R$ 0,00 restante" : `${formatMoney(item.remaining)} restante`}</span>
                  <button type="button" className="text-xs font-semibold text-[var(--primary)] hover:underline" onClick={() => setSelectedCategoryKey(item.category)}>{item.transactions.length} transações</button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Dialog
        open={Boolean(selectedCategory)}
        onOpenChange={(open) => !open && setSelectedCategoryKey(null)}
        title={selectedCategory?.label ?? ""}
        description="Transações associadas a esta meta"
      >
        {selectedCategory && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <MiniSummary label="Previsto" value={selectedCategory.target} />
              <MiniSummary label="Realizado líquido" value={selectedCategory.spent} />
              <MiniSummary label="Restante" value={selectedCategory.remaining} />
            </div>
            <div className="divide-y">
              {selectedCategory.transactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{transaction.description}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{new Intl.DateTimeFormat("pt-BR", { timeZone: data.profile.timeZone }).format(new Date(transaction.date))}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-sm font-semibold", Number(transaction.amount) > 0 && "text-[var(--success)]")}>{formatCurrency(transaction.amount, transaction.currencyCode)}</p>
                    {transaction.currencyCode !== "BRL" && transaction.reportingAmountBrl !== null && (
                      <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{formatCurrency(transaction.reportingAmountBrl, "BRL")}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Editar transação" onClick={() => setEditing(transaction)}><Pencil className="size-4" /></Button>
                </div>
              ))}
              {!selectedCategory.transactions.length && <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">Nenhuma transação nesta meta.</p>}
            </div>
          </div>
        )}
      </Dialog>

      <TransactionEditorDialog transaction={editing} accounts={data.accounts} tags={data.tags} timeZone={data.profile.timeZone} open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)} />
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail, danger = false }: { icon: typeof TrendingUp; label: string; value: number; detail: string; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]"><Icon className="size-5" /></span>
        <div><p className="text-sm text-[var(--muted-foreground)]">{label}</p><p className={cn("mt-1 text-2xl font-semibold", danger && "text-[var(--danger)]")}>{formatMoney(value)}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{detail}</p></div>
      </CardContent>
    </Card>
  );
}

function MiniSummary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-[var(--muted)] p-3"><p className="text-[11px] text-[var(--muted-foreground)]">{label}</p><p className="mt-1 text-sm font-semibold">{formatMoney(value)}</p></div>;
}
