"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { formatCalendarDate, formatDateOnly } from "@/lib/calendar";
import { formatCurrency, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { categoryLabel } from "./calculations";
import { calculateDailyExpenses, type DailyExpenseEntry } from "./daily-expenses";
import type { FinanceData } from "./types";

const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const compactAmount = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumSignificantDigits: 2,
});
const dayAmount = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function formatDayAmount(cents: number) {
  const amount = cents / 100;
  if (amount < 1) return amount.toFixed(2).replace(".", ",");
  return amount < 1000 ? dayAmount.format(amount) : compactAmount.format(amount).replace(/\s/g, "");
}

export function DailyExpensesCard({ data }: { data: FinanceData }) {
  const [selection, setSelection] = useState<number | "outside" | null>(null);
  const calendar = useMemo(
    () => calculateDailyExpenses(data.transactions, data.year, data.month, data.profile.timeZone),
    [data.transactions, data.year, data.month, data.profile.timeZone],
  );
  const monthLabel = formatDateOnly(new Date(Date.UTC(data.year, data.month - 1, 1)), {
    month: "long", year: "numeric",
  });
  const selectedDay = typeof selection === "number" ? calendar.days[selection - 1] : null;
  const selectedEntries = selection === "outside" ? calendar.outsideEntries : selectedDay?.entries ?? [];
  const selectedTotal = selection === "outside" ? calendar.outsideCents : selectedDay?.totalCents ?? 0;
  const countLabel = `${selectedEntries.length} ${selectedEntries.length === 1 ? "transação" : "transações"}`;
  const title = selectedDay
    ? formatDateOnly(selectedDay.date, { day: "numeric", month: "long", year: "numeric" })
    : "Saídas com data fora do mês";

  return (
    <Card className="@container flex flex-col" data-testid="daily-expenses">
      <CardHeader>
        <CardTitle>Saídas por dia</CardTitle>
        <p className="text-sm text-[var(--muted-foreground)]">{monthLabel} · despesas líquidas por data da transação</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-2xl font-semibold tabular-nums" data-testid="daily-expenses-total">{formatMoney(calendar.totalCents / 100)}</p>
          <span className="text-xs text-[var(--muted-foreground)]">
            em {calendar.daysWithExpenses} {calendar.daysWithExpenses === 1 ? "dia com saída" : "dias com saída"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <p className="mb-2 text-right text-[10px] text-[var(--muted-foreground)]">Valores em R$ · toque em um dia para ver os detalhes</p>
        <div className="grid grid-cols-7 gap-1 @md:gap-1.5" aria-label={`Saídas de ${monthLabel}`}>
          {weekdays.map((day) => (
            <span key={day} className="pb-1 text-center text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">{day}</span>
          ))}
          {Array.from({ length: calendar.firstWeekday }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
          {calendar.days.map((day) => {
            const intensity = calendar.peakDay ? day.totalCents / calendar.peakDay.totalCents : 0;
            const dateLabel = formatDateOnly(day.date, { day: "numeric", month: "long", year: "numeric" });
            const label = `${dateLabel}: ${formatMoney(day.totalCents / 100)} em despesas líquidas, ${day.entries.length} ${day.entries.length === 1 ? "transação" : "transações"}`;
            return (
              <button
                key={day.date}
                type="button"
                data-date={day.date}
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={selection === day.day}
                title={label}
                onClick={() => setSelection(day.day)}
                style={day.totalCents > 0 ? {
                  background: `color-mix(in srgb, var(--danger) ${Math.round(12 + intensity * 40)}%, var(--card))`,
                } : undefined}
                className={cn(
                  "flex min-h-14 min-w-0 flex-col justify-between gap-2 rounded-md bg-[var(--muted)]/65 px-1 py-1.5 text-left transition-shadow hover:ring-2 hover:ring-[var(--primary)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] @md:min-h-16 @2xl:px-2",
                  selection === day.day && "ring-2 ring-[var(--primary)]",
                )}
              >
                <span className="text-[10px]">{day.day}</span>
                <span className={cn("whitespace-nowrap text-[9px] font-semibold tabular-nums @md:text-[10px] @2xl:text-xs", day.totalCents === 0 && "text-[var(--muted-foreground)]")}>
                  {day.totalCents > 0 ? <><span className="hidden @2xl:inline">R$ </span>{formatDayAmount(day.totalCents)}</> : "–"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 @md:grid-cols-3">
          <Statistic label="Média por dia" value={formatMoney(calendar.averageCents / 100)} />
          <Statistic label="Maior dia" value={calendar.peakDay
            ? `${String(calendar.peakDay.day).padStart(2, "0")}/${String(data.month).padStart(2, "0")} · ${formatMoney(calendar.peakDay.totalCents / 100)}`
            : "Sem saídas"} />
          <Statistic label="Dias sem saída" value={String(calendar.daysWithoutExpenses)} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
          A média considera todos os dias do mês. Entradas na mesma meta compensam as saídas, como no resumo do painel.
        </p>
        {calendar.outsideEntries.length > 0 && (
          <div className="mt-3 rounded-xl border bg-[var(--muted)]/30 p-3 text-xs leading-relaxed" data-testid="daily-expenses-outside">
            <p>
              {formatMoney(calendar.outsideCents / 100)} em {calendar.outsideEntries.length} {calendar.outsideEntries.length === 1 ? "lançamento com data fora deste mês" : "lançamentos com data fora deste mês"}.
              {" "}Contam no total do período, mas não na grade nem na média diária, como parcelas de cartão ou lançamentos com mês de referência ajustado.
            </p>
            <button type="button" aria-haspopup="dialog" onClick={() => setSelection("outside")} className="mt-1 min-h-11 text-left font-semibold text-[var(--primary)] underline-offset-4 hover:underline">
              Ver lançamentos fora do mês
            </button>
          </div>
        )}
      </CardContent>
      <Dialog
        open={selection !== null}
        onOpenChange={(open) => { if (!open) setSelection(null); }}
        title={title}
        description={selectedDay
          ? `${formatDateOnly(selectedDay.date, { weekday: "long" })} · ${countLabel} neste dia`
          : `${countLabel} incluídas em ${monthLabel}`}
        className="max-w-xl"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-[var(--muted-foreground)]">{countLabel} · total líquido</span>
            <strong className="whitespace-nowrap text-[var(--danger)] tabular-nums">{formatMoney(selectedTotal > 0 ? -selectedTotal / 100 : 0)}</strong>
          </div>
        }
      >
        {selectedEntries.length ? (
          <ul className="divide-y">
            {selectedEntries.map((entry) => <ExpenseRow key={entry.transaction.id} entry={entry} showDate={selection === "outside"} timeZone={data.profile.timeZone} />)}
          </ul>
        ) : <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Nenhuma saída incluída nos relatórios neste dia.</p>}
      </Dialog>
    </Card>
  );
}

function Statistic({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 break-words text-xs font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ExpenseRow({ entry: { transaction, grossCents, netCents }, showDate, timeZone }: {
  entry: DailyExpenseEntry;
  showDate: boolean;
  timeZone: string;
}) {
  const compensated = grossCents !== netCents;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-40">
        <p className="break-words text-sm font-semibold">{transaction.merchantName || transaction.description}</p>
        <p className="mt-1 break-words text-xs text-[var(--muted-foreground)]">
          {transaction.accountName}{transaction.budgetCategory && ` · ${categoryLabel(transaction.budgetCategory, transaction.kind)}`}
          {transaction.installmentNumber && transaction.installmentTotal ? ` · Parcela ${transaction.installmentNumber}/${transaction.installmentTotal}` : ""}
        </p>
        {showDate && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{Number.isNaN(new Date(transaction.date).getTime()) ? "Data indisponível" : formatCalendarDate(transaction.date, /^\d{4}-\d{2}-\d{2}$/.test(transaction.date) ? "UTC" : timeZone)}</p>}
        {transaction.tags.length > 0 && <p className="mt-1 break-words text-xs text-[var(--muted-foreground)]">{transaction.tags.map((tag) => tag.name).join(" · ")}</p>}
      </div>
      <div className="max-w-full text-right">
        <p className="whitespace-nowrap text-sm font-semibold text-[var(--danger)] tabular-nums">{formatMoney(netCents > 0 ? -netCents / 100 : 0)}</p>
        {(compensated || transaction.currencyCode !== "BRL") && (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">Original: {formatCurrency(transaction.amount, transaction.currencyCode)}</p>
        )}
        {compensated && <p className="mt-1 text-xs text-[var(--muted-foreground)]">Compensado: {formatMoney((grossCents - netCents) / 100)}</p>}
      </div>
    </li>
  );
}
