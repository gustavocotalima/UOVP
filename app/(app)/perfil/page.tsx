import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { ProfileClient } from "@/features/finance/profile-client";
import { requireUserId } from "@/lib/current-user";
import { currentCalendarPeriod } from "@/lib/calendar";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const userId = await requireUserId();
  const current = currentCalendarPeriod(await getUserTimeZone(userId));
  const data = await getFinanceData(userId, current.year, current.month, {
    transactionScope: "NONE",
  });
  return <div className="space-y-7"><PageHeader title="Perfil" description="Aqui você pode visualizar todas as informações do seu perfil" /><ProfileClient data={data} /></div>;
}
