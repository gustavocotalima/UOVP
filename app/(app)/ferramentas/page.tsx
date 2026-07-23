import { PageHeader } from "@/components/ui/page-header";
import { ToolsClient } from "@/features/balance-sheet/tools-client";
import { getBalanceSheetData } from "@/features/balance-sheet/data";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Ferramentas" };

export default async function ToolsPage() {
  const entries = await getBalanceSheetData(await requireUserId());
  return <div className="space-y-7"><PageHeader eyebrow="Simuladores" title="Ferramentas" description="Projete seu patrimônio e acompanhe a relação entre ativos e passivos." /><ToolsClient entries={entries} /></div>;
}
