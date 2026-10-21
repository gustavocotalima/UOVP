import { PageHeader } from "@/components/ui/page-header";
import { getFinanceInvoicesPageData } from "@/features/finance/page-data";
import { InvoicesClient } from "@/features/finance/invoices-client";
import { requireUserId } from "@/lib/current-user";
import { currentCalendarPeriod } from "@/lib/calendar";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Faturas" };

export default async function InvoicesPage() {
  const userId = await requireUserId();
  const timeZone = await getUserTimeZone(userId);
  const current = currentCalendarPeriod(timeZone);
  const data = await getFinanceInvoicesPageData(userId, current.year, current.month, timeZone);
  return <div className="space-y-5 sm:space-y-7"><PageHeader title="Faturas" description="Acompanhe as faturas de todos os seus cartões de crédito" /><InvoicesClient data={data} /></div>;
}
