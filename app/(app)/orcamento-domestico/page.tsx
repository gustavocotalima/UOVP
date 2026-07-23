import { PageHeader } from "@/components/ui/page-header";
import { BudgetClient } from "@/features/budget/budget-client";
import { getBudgetData } from "@/features/budget/data";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Orçamento Doméstico" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const params = await searchParams;
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Math.min(12, Math.max(1, Number(params.month) || now.getMonth() + 1));
  const data = await getBudgetData(await requireUserId(), year, month);
  return <div className="space-y-7"><PageHeader eyebrow="Planejamento mensal" title="Orçamento Doméstico" description="Acompanhe sua renda, distribua metas e mantenha os gastos recorrentes sob controle." /><BudgetClient data={data} /></div>;
}
