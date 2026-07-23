import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { ProfileClient } from "@/features/finance/profile-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const now = new Date();
  const data = await getFinanceData(await requireUserId(), now.getFullYear(), now.getMonth() + 1);
  return <div className="space-y-7"><PageHeader title="Perfil" description="Aqui você pode visualizar todas as informações do seu perfil" /><ProfileClient data={data} /></div>;
}
