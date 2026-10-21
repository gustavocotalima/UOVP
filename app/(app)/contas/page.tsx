import { PageHeader } from "@/components/ui/page-header";
import { AccountsClient } from "@/features/finance/accounts-client";
import { getFinanceAccountsPageData } from "@/features/finance/page-data";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Contas" };

export default async function AccountsPage() {
  const userId = await requireUserId();
  const data = await getFinanceAccountsPageData(userId);
  return <div className="space-y-5 sm:space-y-7"><PageHeader title="Contas" description="Gerencie suas contas bancárias e cartões." /><AccountsClient data={data} /></div>;
}
