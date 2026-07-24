import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { TagsClient } from "@/features/finance/tags-client";
import { requireUserId } from "@/lib/current-user";
import { currentCalendarPeriod } from "@/lib/calendar";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Tags" };

export default async function TagsPage() {
  const userId = await requireUserId();
  const current = currentCalendarPeriod(await getUserTimeZone(userId));
  const data = await getFinanceData(userId, current.year, current.month, {
    transactionScope: "NONE",
  });
  return <div className="space-y-7"><PageHeader title="Tags" description="Aqui você pode criar e visualizar suas tags. As tags podem ser anexadas às transações" /><TagsClient tags={data.tags} rules={data.classificationRules} /></div>;
}
