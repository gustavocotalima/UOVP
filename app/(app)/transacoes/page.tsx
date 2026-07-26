import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { MonthNavigator } from "@/features/finance/shared";
import { TransactionsClient } from "@/features/finance/transactions-client";
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
  const data = await getFinanceData(userId, year, month, { transactionScope: "PAGINATED" });
  return <div className="space-y-5 sm:space-y-7"><PageHeader title="Transações" description="Aqui você pode visualizar todas suas transações" actions={<MonthNavigator year={year} month={month} compact />} /><TransactionsClient key={`${year}-${month}`} data={data} /></div>;
}
