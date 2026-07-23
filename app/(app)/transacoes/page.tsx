import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { MonthNavigator } from "@/features/finance/shared";
import { TransactionsClient } from "@/features/finance/transactions-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Transações" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const params = await searchParams;
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Math.min(12, Math.max(1, Number(params.month) || now.getMonth() + 1));
  const data = await getFinanceData(await requireUserId(), year, month);
  return <div className="space-y-7"><PageHeader title="Transações" description="Aqui você pode visualizar todas suas transações" actions={<MonthNavigator year={year} month={month} compact />} /><TransactionsClient key={`${year}-${month}`} data={data} /></div>;
}
