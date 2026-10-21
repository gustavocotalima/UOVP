import { PageHeader } from "@/components/ui/page-header";
import { getFinanceProfilePageData } from "@/features/finance/page-data";
import { ProfileClient } from "@/features/finance/profile-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const userId = await requireUserId();
  const data = await getFinanceProfilePageData(userId);
  return <div className="space-y-5 sm:space-y-7"><PageHeader title="Perfil" description="Aqui você pode visualizar todas as informações do seu perfil" /><ProfileClient data={data} /></div>;
}
