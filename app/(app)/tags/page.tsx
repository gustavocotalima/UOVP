import { PageHeader } from "@/components/ui/page-header";
import { getFinanceData } from "@/features/finance/data";
import { TagsClient } from "@/features/finance/tags-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Tags" };

export default async function TagsPage() {
  const now = new Date();
  const data = await getFinanceData(await requireUserId(), now.getFullYear(), now.getMonth() + 1);
  return <div className="space-y-7"><PageHeader title="Tags" description="Aqui você pode criar e visualizar suas tags. As tags podem ser anexadas às transações" /><TagsClient tags={data.tags} /></div>;
}
