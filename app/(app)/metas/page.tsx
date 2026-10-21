import { PageHeader } from "@/components/ui/page-header";
import { getFinanceGoalsPageData } from "@/features/finance/page-data";
import { GoalsClient } from "@/features/finance/goals-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Metas" };

export default async function GoalsPage() {
  const userId = await requireUserId();
  const data = await getFinanceGoalsPageData(userId);
  return <div className="space-y-5 sm:space-y-7"><PageHeader title="Metas" description="Defina como sua renda mensal deve ser distribuída." /><GoalsClient data={data} /></div>;
}
