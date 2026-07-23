import { PageHeader } from "@/components/ui/page-header";
import { AccountsClient } from "@/features/finance/accounts-client";
import { getFinanceData } from "@/features/finance/data";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Contas" };

export default async function AccountsPage() {
  const now = new Date();
  const data = await getFinanceData(await requireUserId(), now.getFullYear(), now.getMonth() + 1);
  return <div className="space-y-7"><PageHeader title="Contas" description="Gerencie suas contas bancárias e cartões." /><AccountsClient data={data} /></div>;
}
