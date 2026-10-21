"use client";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChart } from "@/components/charts/donut-chart";
import { formatPercent } from "@/lib/money";
import { AssetLogoProvider } from "./assets-panel/asset-logo";
import { useAssetsPanelController } from "./assets-panel/use-assets-panel-controller";
import type { AssetsPanelProps } from "./assets-panel/model";
import { DeleteDialog } from "./assets-panel/delete-dialog";
import { HoldingDialog } from "./assets-panel/holding-dialog";
import { FixedGroupDialog } from "./assets-panel/fixed-group-dialog";
import { AssetDialog } from "./assets-panel/asset-dialog";
import { ReviewDialog } from "./assets-panel/review-dialog";
import { MetadataDialog } from "./assets-panel/metadata-dialog";
import { AssetsDesktop } from "./assets-panel/assets-desktop";
import { AssetsMobile } from "./assets-panel/assets-mobile";
import { AssetsFilters } from "./assets-panel/assets-filters";
import { AssetsToolbar } from "./assets-panel/assets-toolbar";
export function AssetsPanel(props: AssetsPanelProps) {
  const controller = useAssetsPanelController(props);
  const { integrationReview, panelRef, total, chartData, openReview } = controller;
  return (<AssetLogoProvider assets={controller.filtered}><div ref={panelRef} className="space-y-6">
    {integrationReview.length > 0 && (<div className="flex flex-col gap-4 rounded-2xl border border-[var(--primary)]/45 bg-[var(--primary)]/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" />
        <div>
          <p className="font-semibold">{integrationReview.length} investimento(s) precisam de revisão</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Confirme exposição, grupo ou indexação antes de incluí-los no diagrama.</p>
        </div>
      </div>
      <Button onClick={() => openReview(integrationReview[0])}>Revisar integração</Button>
    </div>)}
    <div className="grid gap-4 @7xl:grid-cols-[minmax(0,1fr)_340px] @7xl:gap-6">
      <Card>
        <AssetsToolbar controller={controller} />
        <CardContent>
          <AssetsFilters controller={controller} />
          <AssetsMobile controller={controller} />
          <AssetsDesktop controller={controller} />
        </CardContent>
      </Card>
      <Card className="self-start @7xl:sticky @7xl:top-6">
        <CardHeader><CardTitle>Distribuição atual</CardTitle></CardHeader>
        <CardContent>
          {chartData.length ? <DonutChart data={chartData} centerLabel="Patrimônio" /> : <div className="grid h-64 place-items-center text-sm text-[var(--muted-foreground)]">Adicione ativos para visualizar.</div>}
          <div className="space-y-2">
            {chartData.map((item) => <div key={item.name} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: item.color }} />{item.name}</span><strong>{formatPercent(total ? item.value / total * 100 : 0)}</strong></div>)}
          </div>
        </CardContent>
      </Card>
    </div>

    <MetadataDialog controller={controller} />

    <ReviewDialog controller={controller} />

    <AssetDialog controller={controller} />

    <FixedGroupDialog controller={controller} />

    <HoldingDialog controller={controller} />

    <DeleteDialog controller={controller} />
  </div></AssetLogoProvider>);
}
