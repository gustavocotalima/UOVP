import { PageHeader } from "@/components/ui/page-header";
import { getOpenFinanceData } from "@/features/open-finance/data";
import { OpenFinanceClient } from "@/features/open-finance/open-finance-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Open Finance" };

export default async function OpenFinancePage() {
  const userId = await requireUserId();
  const data = await getOpenFinanceData(userId);
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Integrações"
        title="Open Finance"
        description="Centralize contas, cartões, transações e investimentos conectados pela Pluggy."
      />
      <OpenFinanceClient data={data} />
    </div>
  );
}
