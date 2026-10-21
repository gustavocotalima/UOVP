"use client";
import { InvestmentMetadataEditor } from "@/features/open-finance/investment-metadata-editor";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function MetadataDialog({ controller }: {
  controller: Pick<AssetsPanelController, "catalog" | "metadataEditor" | "setMetadataEditor">;
}) {
  const { catalog, metadataEditor, setMetadataEditor } = controller;
  return (<InvestmentMetadataEditor key={metadataEditor ? `${metadataEditor.linkId}:${metadataEditor.expectedUpdatedAt}` : "closed"} metadata={metadataEditor} catalog={catalog} open={metadataEditor !== null} onOpenChange={(open) => !open && setMetadataEditor(null)} />);
}
