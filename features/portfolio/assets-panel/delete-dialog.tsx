"use client";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { AssetsPanelController } from "./use-assets-panel-controller";
export function DeleteDialog({ controller }: {
  controller: Pick<AssetsPanelController, "deleteTarget" | "setDeleteTarget" | "pending" | "confirmDeletion">;
}) {
  const { deleteTarget, setDeleteTarget, pending, confirmDeletion } = controller;
  return (<ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(undefined)} title={deleteTarget?.kind === "class" ? "Remover classe" : "Remover ativo"} description={deleteTarget?.kind === "class"
    ? `Todos os ativos de ${deleteTarget.label} serão removidos. Deseja seguir?`
    : `${deleteTarget?.label ?? "Este ativo"} será removido definitivamente da carteira. Deseja seguir?`} confirmLabel="Remover" danger pending={pending} onConfirm={confirmDeletion} />);
}
