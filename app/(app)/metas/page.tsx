import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { GoalsClient } from "@/features/finance/goals-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Metas" };

export default async function GoalsPage() {
  const now = new Date();
  const data = await getFinanceData(await requireUserId(), now.getFullYear(), now.getMonth() + 1);
  return <div className="space-y-7"><PageHeader title="Metas" description="Defina como sua renda mensal deve ser distribuída." /><GoalsClient data={data} /></div>;
}
