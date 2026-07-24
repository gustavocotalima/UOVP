import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { InvoicesClient } from "@/features/finance/invoices-client";
import { requireUserId } from "@/lib/current-user";
import { currentCalendarPeriod } from "@/lib/calendar";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Faturas" };

export default async function InvoicesPage() {
  const userId = await requireUserId();
  const current = currentCalendarPeriod(await getUserTimeZone(userId));
  const data = await getFinanceData(userId, current.year, current.month, {
    transactionScope: "INVOICE_HISTORY",
  });
  return <div className="space-y-7"><PageHeader title="Faturas" description="Acompanhe as faturas de todos os seus cartões de crédito" /><InvoicesClient data={data} /></div>;
}
