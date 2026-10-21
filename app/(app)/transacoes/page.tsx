import { randomUUID } from "node:crypto";
import { PageHeader } from "@/components/ui/page-header";
import { getFinanceTransactionsPage } from "@/features/finance/data";
import { getFinanceTransactionsPageData } from "@/features/finance/page-data";
import { MonthNavigator } from "@/features/finance/shared";
import { TransactionsClient } from "@/features/finance/transactions-client";
import { financeTransactionQueryKey, initialFinanceTransactionQuery } from "@/features/finance/transaction-query";
import { requireUserId } from "@/lib/current-user";
import { currentCalendarPeriod } from "@/lib/calendar";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Transações" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const params = await searchParams;
  const userId = await requireUserId();
  const current = currentCalendarPeriod(await getUserTimeZone(userId));
  const year = Number(params.year) || current.year;
  const month = Math.min(12, Math.max(1, Number(params.month) || current.month));
  const initialQuery = initialFinanceTransactionQuery(year, month);
  const [data, initialPage] = await Promise.all([
    getFinanceTransactionsPageData(userId, year, month),
    getFinanceTransactionsPage(userId, initialQuery),
  ]);
  return <div className="space-y-5 sm:space-y-7"><PageHeader title="Transações" description="Aqui você pode visualizar todas suas transações" actions={<MonthNavigator year={year} month={month} />} /><TransactionsClient key={`${year}-${month}`} data={data} initialPage={initialPage} initialQueryKey={financeTransactionQueryKey(initialQuery)} snapshotRevision={randomUUID()} /></div>;
}
