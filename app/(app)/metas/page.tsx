import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { GoalsClient } from "@/features/finance/goals-client";
import { requireUserId } from "@/lib/current-user";
import { currentCalendarPeriod } from "@/lib/calendar";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Metas" };

export default async function GoalsPage() {
  const userId = await requireUserId();
  const current = currentCalendarPeriod(await getUserTimeZone(userId));
  const data = await getFinanceData(userId, current.year, current.month, {
    transactionScope: "NONE",
  });
  return <div className="space-y-7"><PageHeader title="Metas" description="Defina como sua renda mensal deve ser distribuída." /><GoalsClient data={data} /></div>;
}
