"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownLeft, ArrowUpRight, EyeOff, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChart } from "@/components/charts/donut-chart";
import { formatCurrency, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  calculateBudgetCategories,
  calculateAccountTotals,
  calculatePeriod,
  calculateTagTotals,
  categoryLabel,
} from "./calculations";
import type { FinanceData } from "./types";

export function FinanceDashboardClient({ data }: { data: FinanceData }) {
  const [range, setRange] = useState<3 | 6 | 12>(6);
  const period = useMemo(() => calculatePeriod(data.transactions), [data.transactions]);
  const history = useMemo(
    () => data.history.slice(-range).map((item) => ({
      key: `${item.year}-${String(item.month).padStart(2, "0")}`,
      month: new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
        .format(new Date(Date.UTC(item.year, item.month - 1, 1)))
        .replace(".", ""),
      income: item.netIncome,
      spent: item.spent,
      balance: item.balance,
    })),
    [data.history, range],
  );
  const tags = useMemo(() => calculateTagTotals(data.transactions, data.tags), [data.transactions, data.tags]);
  const categories = useMemo(
    () => calculateBudgetCategories(data.transactions, data.goals, period.budgetBaseIncome),
    [data.transactions, data.goals, period.budgetBaseIncome],
  );
  const accountTotals = useMemo(() => calculateAccountTotals(data.accounts), [data.accounts]);

  return (
    <div className="space-y-6">
      {(period.missingFxCount > 0 || accountTotals.missingFxCount > 0) && (
        <div className="rounded-xl border border-[var(--primary)]/35 bg-[var(--primary)]/8 p-4 text-sm">
          Há valores em moeda estrangeira aguardando conversão. Eles não foram incluídos nos totais em BRL.
        </div>
      )}
      <section className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-4 @5xl:gap-4">
        <Summary label="Saldo em conta" value={accountTotals.bankBalance} />
        <Summary label="Entradas líquidas" value={period.budgetBaseIncome} tone="success" />
        <Summary label="Despesas líquidas" value={period.spent} tone="danger" />
        <Summary label="Resultado do período" value={period.balance} tone={period.balance < 0 ? "danger" : "default"} />
      </section>

      <section className="grid gap-4 @6xl:grid-cols-[1.55fr_1fr] @6xl:gap-6">
        <Card>
          <CardHeader className="gap-4 @2xl:flex-row @2xl:items-start @2xl:justify-between">
            <div>
              <CardTitle>Histórico financeiro</CardTitle>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Entradas e despesas líquidas dos últimos meses</p>
            </div>
            <div className="flex rounded-xl bg-[var(--muted)] p-1">
              {([3, 6, 12] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={range === value}
                  className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", range === value && "bg-[var(--card)] shadow-sm")}
                  onClick={() => setRange(value)}
                >
                  {value === 12 ? "1A" : `${value}M`}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64 @3xl:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="finance-income" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#76bc8e" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#76bc8e" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="finance-spent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d2ad50" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#d2ad50" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--muted-foreground)" axisLine={false} tickLine={false} />
                  <YAxis stroke="var(--muted-foreground)" axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                  <Tooltip formatter={(value) => formatMoney(Number(value))} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                  <Area type="monotone" dataKey="income" name="Entradas líquidas" stroke="#76bc8e" fill="url(#finance-income)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="spent" name="Despesas líquidas" stroke="#d2ad50" fill="url(#finance-spent)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transações por Tags</CardTitle>
            <p className="text-sm text-[var(--muted-foreground)]">Distribuição das despesas líquidas do mês</p>
          </CardHeader>
          <CardContent>
            {tags.length ? (
              <>
                <DonutChart data={tags.map((tag) => ({ name: tag.name, color: tag.color, value: tag.value }))} centerLabel="Despesas líquidas" />
                <div className="space-y-2">
                  {tags.slice(0, 6).map((tag) => (
                    <div key={tag.id} className="flex items-center justify-between text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: tag.color }} />
                        <span className="truncate">{tag.name}</span>
                      </span>
                      <strong>{formatMoney(tag.value)}</strong>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="grid h-72 place-items-center text-center text-sm text-[var(--muted-foreground)]">
                <div><Tags className="mx-auto mb-3 size-8 opacity-45" /><p>Nenhuma despesa categorizada por tag.</p></div>
              </div>
            )}
            <Button asChild variant="ghost" className="mt-4 w-full">
              <Link href={`/transacoes?year=${data.year}&month=${data.month}`}>Categorize todas as transações</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 @6xl:grid-cols-[1fr_1.25fr] @6xl:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Metas Financeiras</CardTitle>
            <p className="text-sm text-[var(--muted-foreground)]">Uso do orçamento planejado</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {categories.map((item) => (
              <div key={item.category}>
                <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium">{item.label}</span>
                  <span className={cn("font-semibold", item.usage > 100 && "text-[var(--danger)]")}>{formatPercent(item.usage)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, item.usage)}%`, background: item.color }} />
                </div>
                <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                  Líquido: {formatMoney(item.spent)} de {formatMoney(item.target)}
                  {item.appliedIncomeOffsets > 0 && ` · ${formatMoney(item.appliedIncomeOffsets)} em entradas compensadas`}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
            <div>
              <CardTitle>Transações recentes</CardTitle>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Últimas movimentações sincronizadas</p>
            </div>
            <Button asChild variant="ghost" size="sm"><Link href="/transacoes">Ver todas</Link></Button>
          </CardHeader>
          <CardContent className="divide-y">
            {data.recentTransactions.map((transaction) => {
              const incoming = transaction.kind === "INCOME";
              return (
                <div key={transaction.id} className="flex items-center gap-3 py-3 first:pt-0">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", incoming ? "bg-[var(--success)]/12 text-[var(--success)]" : "bg-[var(--danger)]/10 text-[var(--danger)]")}>
                    {transaction.ignored ? <EyeOff className="size-4" /> : incoming ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{transaction.merchantName || transaction.description}</p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">{transaction.accountName} · {categoryLabel(transaction.budgetCategory, transaction.kind)}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-sm font-semibold tabular-nums", incoming && "text-[var(--success)]")}>{formatCurrency(transaction.amount, transaction.currencyCode)}</p>
                    {transaction.currencyCode !== "BRL" && transaction.reportingAmountBrl !== null && (
                      <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{formatCurrency(transaction.reportingAmountBrl, "BRL")}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {!data.recentTransactions.length && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">Nenhuma transação encontrada.</p>}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Summary({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "danger" }) {
  return (
    <Card>
      <CardContent className="p-5 text-center @2xl:text-left">
        <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
        <p className={cn("mt-2 text-2xl font-semibold tabular-nums", tone === "success" && "text-[var(--success)]", tone === "danger" && "text-[var(--danger)]")}>{formatMoney(value)}</p>
      </CardContent>
    </Card>
  );
}
