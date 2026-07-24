import { PageHeader } from "@/components/ui/page-header";
import { FinanceDashboardClient } from "@/features/finance/dashboard-client";
import { getFinanceData } from "@/features/finance/data";
import { MonthNavigator } from "@/features/finance/shared";
import { requireUserId } from "@/lib/current-user";
import { currentCalendarPeriod, greetingForTimeZone } from "@/lib/calendar";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Painel" };

function period(search: { year?: string; month?: string }, current: { year: number; month: number }) {
  return {
    year: Number(search.year) || current.year,
    month: Math.min(12, Math.max(1, Number(search.month) || current.month)),
  };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const userId = await requireUserId();
  const timeZone = await getUserTimeZone(userId);
  const selected = period(await searchParams, currentCalendarPeriod(timeZone));
  const data = await getFinanceData(userId, selected.year, selected.month, {
    transactionScope: "MONTH",
    includeHistory: true,
  });
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Painel"
        title={`${greetingForTimeZone(timeZone)}, ${data.user.name || "Investidor"}!`}
        description="Acompanhe sua vida financeira de forma simples e organizada."
        actions={<MonthNavigator year={selected.year} month={selected.month} />}
      />
      <FinanceDashboardClient data={data} />
    </div>
  );
}
