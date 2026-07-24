import { PageHeader } from "@/components/ui/page-header";
import { BudgetOverviewClient } from "@/features/finance/budget-overview-client";
import { getFinanceData } from "@/features/finance/data";
import { MonthNavigator } from "@/features/finance/shared";
import { requireUserId } from "@/lib/current-user";
import { currentCalendarPeriod } from "@/lib/calendar";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Orçamento" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const params = await searchParams;
  const userId = await requireUserId();
  const current = currentCalendarPeriod(await getUserTimeZone(userId));
  const year = Number(params.year) || current.year;
  const month = Math.min(12, Math.max(1, Number(params.month) || current.month));
  const data = await getFinanceData(userId, year, month);
  return (
    <div className="space-y-7">
      <PageHeader title="Orçamento" description="Controle seu orçamento com base em suas metas e rendimentos" actions={<MonthNavigator year={year} month={month} />} />
      <BudgetOverviewClient data={data} />
    </div>
  );
}
