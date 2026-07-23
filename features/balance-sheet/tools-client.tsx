"use client";

import { useState } from "react";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { BalanceSheetPanel } from "./balance-sheet-panel";
import { FirstMillionPanel } from "./first-million-panel";
import type { BalanceCategoryKey } from "./constants";

export function ToolsClient({ entries }: { entries: { id: string; category: BalanceCategoryKey; name: string; value: string }[] }) {
  const [section, setSection] = useState<"first" | "balance">("first");
  return <div className="space-y-6"><SegmentedTabs value={section} onValueChange={setSection} ariaLabel="Ferramentas" options={[{ value: "first", label: "Primeiro milhão" }, { value: "balance", label: "Ativos vs Passivos" }]} />{section === "first" ? <FirstMillionPanel /> : <BalanceSheetPanel entries={entries} />}</div>;
}
