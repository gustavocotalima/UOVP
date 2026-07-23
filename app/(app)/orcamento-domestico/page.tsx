import { PageHeader } from "@/components/ui/page-header";
import { BudgetOverviewClient } from "@/features/finance/budget-overview-client";
import { getFinanceData } from "@/features/finance/data";
import { MonthNavigator } from "@/features/finance/shared";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Orçamento" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const params = await searchParams;
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Math.min(12, Math.max(1, Number(params.month) || now.getMonth() + 1));
  const data = await getFinanceData(await requireUserId(), year, month);
  return (
    <div className="space-y-7">
      <PageHeader title="Orçamento" description="Controle seu orçamento com base em suas metas e rendimentos" actions={<MonthNavigator year={year} month={month} />} />
      <BudgetOverviewClient data={data} />
    </div>
  );
}
