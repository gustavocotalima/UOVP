import { calendarParts } from "@/lib/calendar";
import { calculateNetExpenses } from "./calculations";
import type { FinanceTransactionDto } from "./types";

export type DailyExpenseEntry = ReturnType<typeof calculateNetExpenses>[number];

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
  // Compensate within the financial month before grouping by transaction date.
  // An installment may belong to this report even when purchased in another month.
  const expenses = calculateNetExpenses(transactions.filter(
    (transaction) => transaction.referenceYear === year && transaction.referenceMonth === month,
  ));
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
    day.totalCents += entry.netCents;
  }
  for (const day of days) {
    day.entries.sort((left, right) => right.netCents - left.netCents
      || right.grossCents - left.grossCents
      || left.transaction.id.localeCompare(right.transaction.id));
  }
  const inCalendarCents = days.reduce((total, day) => total + day.totalCents, 0);
  const outsideCents = outsideEntries.reduce((total, entry) => total + entry.netCents, 0);
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
