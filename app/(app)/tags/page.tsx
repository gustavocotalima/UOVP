import { PageHeader } from "@/components/ui/page-header";
import { getFinanceTagsPageData } from "@/features/finance/page-data";
import { TagsClient } from "@/features/finance/tags-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Tags" };

export default async function TagsPage() {
  const userId = await requireUserId();
  const data = await getFinanceTagsPageData(userId);
  return <div className="space-y-5 sm:space-y-7"><PageHeader title="Tags" description="Aqui você pode criar e visualizar suas tags. As tags podem ser anexadas às transações" /><TagsClient tags={data.tags} rules={data.classificationRules} /></div>;
}
