"use client";
import { PrivateValue } from "@/components/ui/private-value";
import { Download, Plus, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { exportPortfolioXlsx } from "../xlsx-export";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function AssetsToolbar({ controller }: {
  controller: Pick<AssetsPanelController, "assets" | "pending" | "refreshingPrices" | "fileInput" | "mobileActions" | "total" | "hasRefreshableQuotes" | "startAdding" | "refreshMarketPrices">;
}) {
  const { assets, pending, refreshingPrices, fileInput, mobileActions, total, hasRefreshableQuotes, startAdding, refreshMarketPrices } = controller;
  return (<CardHeader className="gap-4 @5xl:flex-row @5xl:items-center @5xl:justify-between">
    <div>
      <CardTitle>Seus ativos</CardTitle>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{assets.length} ativos · <PrivateValue>{formatMoney(total)}</PrivateValue>{assets.some((asset) => asset.holdings.some((holding) => holding.accountBalanceSource?.valuationUnavailable)) ? " (subtotal conhecido; há saldos sem câmbio)" : ""}</p>
    </div>
    <div className="hidden flex-wrap gap-2 @5xl:flex">
      <Button variant="outline" onClick={refreshMarketPrices} disabled={pending || !hasRefreshableQuotes} aria-busy={refreshingPrices} title="Atualiza ativos da B3 pela brapi, ativos internacionais pelo Yahoo Finance e criptomoedas pela Binance.">
        <RefreshCw className={refreshingPrices ? "size-4 motion-safe:animate-spin" : "size-4"} /> Atualizar cotações
      </Button>
      <Button variant="outline" onClick={() => exportPortfolioXlsx(assets)} disabled={!assets.length}><Download className="size-4" /> Exportar XLSX</Button>
      <Button variant="outline" onClick={() => fileInput.current?.click()}><Upload className="size-4" /> Importar XLSX</Button>
      <Button onClick={startAdding}><Plus className="size-4" /> Adicionar ativo</Button>
    </div>
    <div className="flex gap-2 @5xl:hidden">
      <Button className="min-w-0 flex-1" onClick={startAdding}><Plus className="size-4" /> Adicionar ativo</Button>
      <details ref={mobileActions} className="group relative">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center rounded-xl border px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          Mais
        </summary>
        <div className="absolute right-0 z-30 mt-2 grid w-56 gap-1 rounded-2xl border bg-[var(--card)] p-2 shadow-2xl">
          <button type="button" className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-[var(--muted)]" onClick={() => {
            mobileActions.current?.removeAttribute("open");
            void refreshMarketPrices();
          }} disabled={pending || !hasRefreshableQuotes} aria-busy={refreshingPrices}><RefreshCw className={refreshingPrices ? "size-4 motion-safe:animate-spin" : "size-4"} /> Atualizar cotações</button>
          <button type="button" className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-[var(--muted)]" onClick={() => {
            mobileActions.current?.removeAttribute("open");
            exportPortfolioXlsx(assets);
          }} disabled={!assets.length}><Download className="size-4" /> Exportar XLSX</button>
          <button type="button" className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-[var(--muted)]" onClick={() => {
            mobileActions.current?.removeAttribute("open");
            fileInput.current?.click();
          }}><Upload className="size-4" /> Importar XLSX</button>
        </div>
      </details>
    </div>
  </CardHeader>);
}
