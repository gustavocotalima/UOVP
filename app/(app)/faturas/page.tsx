import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { InvoicesClient } from "@/features/finance/invoices-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Faturas" };

export default async function InvoicesPage() {
  const now = new Date();
  const data = await getFinanceData(await requireUserId(), now.getFullYear(), now.getMonth() + 1);
  return <div className="space-y-7"><PageHeader title="Faturas" description="Acompanhe as faturas de todos os seus cartões de crédito" /><InvoicesClient data={data} /></div>;
}
