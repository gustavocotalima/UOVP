import { calendarParts } from "@/lib/calendar";
import { reportingValue } from "./calculations";
import type { FinanceTransactionDto } from "./types";

export type DailyExpenseEntry = { transaction: FinanceTransactionDto; grossCents: number };

export type DailyExpenseDay = {
  day: number;
  date: string;
  totalCents: number;
  entries: DailyExpenseEntry[];
};

export function calculateDailyExpenses(
  transactions: FinanceTransactionDto[],
  year: number,
  month: number,
  timeZone: string,
) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days: DailyExpenseDay[] = Array.from({ length: daysInMonth }, (_, index) => ({
    day: index + 1,
    date: `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
    totalCents: 0,
    entries: [],
  }));
  const outsideEntries: DailyExpenseEntry[] = [];
  // An installment may belong to this report even when purchased in another month.
  // Show the full outflow on its transaction date; compensation belongs to summaries.
  const expenses = transactions.flatMap((transaction) => {
    if (transaction.referenceYear !== year || transaction.referenceMonth !== month) return [];
    const value = reportingValue(transaction);
    return value !== null && value < 0
      ? [{ transaction, grossCents: Math.round(Math.abs(value) * 100) }]
      : [];
  });
  for (const entry of expenses) {
    const date = new Date(entry.transaction.date);
    const parts = Number.isNaN(date.getTime())
      ? null
      : calendarParts(date, /^\d{4}-\d{2}-\d{2}$/.test(entry.transaction.date) ? "UTC" : timeZone);
    if (!parts || parts.year !== year || parts.month !== month) {
      outsideEntries.push(entry);
      continue;
    }
    const day = days[parts.day - 1];
    day.entries.push(entry);
    day.totalCents += entry.grossCents;
  }
  for (const day of days) {
    day.entries.sort((left, right) => right.grossCents - left.grossCents
      || left.transaction.id.localeCompare(right.transaction.id));
  }
  const inCalendarCents = days.reduce((total, day) => total + day.totalCents, 0);
  const outsideCents = outsideEntries.reduce((total, entry) => total + entry.grossCents, 0);
  const daysWithExpenses = days.filter((day) => day.totalCents > 0).length;
  const peakDay = days.reduce<DailyExpenseDay | null>(
    (peak, day) => day.totalCents > (peak?.totalCents ?? 0) ? day : peak,
    null,
  );
  return {
    days,
    firstWeekday,
    totalCents: inCalendarCents + outsideCents,
    inCalendarCents,
    outsideCents,
    outsideEntries,
    daysWithExpenses,
    daysWithoutExpenses: daysInMonth - daysWithExpenses,
    averageCents: Math.round(inCalendarCents / daysInMonth),
    peakDay,
  };
}
