"use client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FIXED_INCOME_INDEXATIONS, FIXED_INCOME_INDEXATION_META, type FixedIncomeIndexationKey } from "../constants";
import type { FixedIncomeGroupForm } from "./model";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function FixedGroupDialog({ controller }: {
  controller: Pick<AssetsPanelController, "assets" | "fixedIncomeFamilies" | "form" | "fixedGroupForm" | "setFixedGroupForm" | "setDeleteTarget" | "pending" | "submitFixedGroup">;
}) {
  const { assets, fixedIncomeFamilies, form, fixedGroupForm, setFixedGroupForm, setDeleteTarget, pending, submitFixedGroup } = controller;
  return (<Dialog privateEditor open={fixedGroupForm !== null} mobileMode="full" onOpenChange={(open) => !open && setFixedGroupForm(null)} dismissible={!pending} title={fixedGroupForm?.id ? "Editar grupo de renda fixa" : "Adicionar grupo de renda fixa"} className="max-w-2xl" footer={fixedGroupForm && (<>
    {fixedGroupForm.id && <Button type="button" variant="danger" onClick={() => {
      const asset = assets.find((candidate) => candidate.id === fixedGroupForm.id);
      if (asset)
        setDeleteTarget({ kind: "asset", id: asset.id, label: asset.name });
    }}>Remover grupo</Button>}
    <Button type="submit" form="fixed-income-group-form" disabled={pending || !fixedGroupForm.familyCode}>{pending ? "Salvando…" : "Salvar grupo"}</Button>
  </>)}>
    {fixedGroupForm && (<form id="fixed-income-group-form" onSubmit={submitFixedGroup} className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="fixed-family">Família</Label>
        <Select id="fixed-family" className="w-full" value={fixedGroupForm.familyCode} disabled={Boolean(fixedGroupForm.id)} onChange={(event) => setFixedGroupForm({ ...fixedGroupForm, familyCode: event.target.value })} required>
          <option value="">Selecione uma família</option>
          {fixedIncomeFamilies.map((family) => <option key={family.code} value={family.code}>{family.name}</option>)}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="fixed-indexation">Indexação</Label>
        <Select id="fixed-indexation" className="w-full" value={fixedGroupForm.indexation} disabled={Boolean(fixedGroupForm.id)} onChange={(event) => setFixedGroupForm({ ...fixedGroupForm, indexation: event.target.value as FixedIncomeIndexationKey })}>
          {FIXED_INCOME_INDEXATIONS.map((indexation) => <option key={indexation} value={indexation}>{FIXED_INCOME_INDEXATION_META[indexation].label}</option>)}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="fixed-exposure">Classe para metas</Label>
        <Select id="fixed-exposure" className="w-full" value={fixedGroupForm.investmentClass} onChange={(event) => setFixedGroupForm({ ...fixedGroupForm, investmentClass: event.target.value as FixedIncomeGroupForm["investmentClass"] })}>
          <option value="FIXED_INCOME">Renda fixa</option>
          <option value="INTERNATIONAL_FIXED_INCOME">Renda fixa internacional</option>
        </Select>
      </div>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="fixed-score">Nota do grupo</Label><Input id="fixed-score" type="number" min="-30" max="30" value={fixedGroupForm.score} onChange={(event) => setFixedGroupForm({ ...fixedGroupForm, score: Number(event.target.value) })} required /></div>
      <p className="text-sm text-[var(--muted-foreground)] sm:col-span-2">O grupo pode ser salvo vazio. As aplicações reais são adicionadas ao expandir a linha na carteira.</p>
    </form>)}
  </Dialog>);
}
