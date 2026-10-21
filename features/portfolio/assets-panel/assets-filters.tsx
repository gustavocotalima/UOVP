"use client";
import { Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { INSTRUMENT_TYPES, INSTRUMENT_TYPE_META, INVESTMENT_CLASSES, INVESTMENT_CLASS_META } from "../constants";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function AssetsFilters({ controller }: {
  controller: Pick<AssetsPanelController, "search" | "setSearch" | "filter" | "setFilter" | "instrumentFilter" | "setInstrumentFilter" | "setDeleteTarget" | "message" | "fileInput" | "importFile">;
}) {
  const { search, setSearch, filter, setFilter, instrumentFilter, setInstrumentFilter, setDeleteTarget, message, fileInput, importFile } = controller;
  return (<><input ref={fileInput} className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} />
    <div className="mb-4 grid gap-3 @4xl:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <label className="relative flex-1">
        <span className="sr-only">Buscar ativos</span>
        <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-[var(--muted-foreground)]" />
        <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome ou ticker" />
      </label>
      <Select className="w-full" aria-label="Filtrar por classe" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
        <option value="ALL">Todas as classes</option>
        {INVESTMENT_CLASSES.map((investmentClass) => <option key={investmentClass} value={investmentClass}>{INVESTMENT_CLASS_META[investmentClass].label}</option>)}
      </Select>
      <Select className="w-full" aria-label="Filtrar por instrumento" value={instrumentFilter} onChange={(event) => setInstrumentFilter(event.target.value as typeof instrumentFilter)}>
        <option value="ALL">Todos os instrumentos</option>
        {INSTRUMENT_TYPES.map((instrumentType) => <option key={instrumentType} value={instrumentType}>{INSTRUMENT_TYPE_META[instrumentType].label}</option>)}
      </Select>
      {filter !== "ALL" && (<Button variant="danger" onClick={() => setDeleteTarget({ kind: "class", investmentClass: filter, label: INVESTMENT_CLASS_META[filter].label })}>
        <Trash2 className="size-4" /> Excluir classe
      </Button>)}
    </div>
    {message && <p role="status" className="mb-4 rounded-xl bg-[var(--muted)] p-3 text-sm">{message}</p>}</>);
}
