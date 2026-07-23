import { PageHeader } from "@/components/ui/page-header";
import { FinanceDashboardClient } from "@/features/finance/dashboard-client";
import { getFinanceData } from "@/features/finance/data";
import { MonthNavigator } from "@/features/finance/shared";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Painel" };

function period(search: { year?: string; month?: string }) {
  const now = new Date();
  return {
    year: Number(search.year) || now.getFullYear(),
    month: Math.min(12, Math.max(1, Number(search.month) || now.getMonth() + 1)),
  };
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Boa madrugada";
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const selected = period(await searchParams);
  const data = await getFinanceData(await requireUserId(), selected.year, selected.month);
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Painel"
        title={`${greeting()}, ${data.user.name || "Investidor"}!`}
        description="Acompanhe sua vida financeira de forma simples e organizada."
        actions={<MonthNavigator year={selected.year} month={selected.month} />}
      />
      <FinanceDashboardClient data={data} />
    </div>
  );
}
