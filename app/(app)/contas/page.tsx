import { PageHeader } from "@/components/ui/page-header";
import { AccountsClient } from "@/features/finance/accounts-client";
import { getFinanceData } from "@/features/finance/data";
import { requireUserId } from "@/lib/current-user";
import { currentCalendarPeriod } from "@/lib/calendar";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Contas" };

export default async function AccountsPage() {
  const userId = await requireUserId();
  const current = currentCalendarPeriod(await getUserTimeZone(userId));
  const data = await getFinanceData(userId, current.year, current.month, {
    transactionScope: "NONE",
  });
  return <div className="space-y-5 sm:space-y-7"><PageHeader title="Contas" description="Gerencie suas contas bancárias e cartões." /><AccountsClient data={data} /></div>;
}
