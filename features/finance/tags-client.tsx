"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFinanceTagAction, deleteFinanceTagAction, updateFinanceTagAction } from "./actions";
import { FinanceNotice, runFinanceAction } from "./shared";
import type { FinanceTagDto } from "./types";

export function TagsClient({ tags }: { tags: FinanceTagDto[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<FinanceTagDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [deleting, setDeleting] = useState<FinanceTagDto | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setColor("#3b82f6");
    setFormOpen(true);
  }

  function openEdit(tag: FinanceTagDto) {
    setEditing(tag);
    setName(tag.name);
    setColor(tag.color);
    setFormOpen(true);
  }

  async function save() {
    const ok = await runFinanceAction(
      () => editing ? updateFinanceTagAction({ id: editing.id, name, color }) : createFinanceTagAction({ name, color }),
      setPending,
      setNotice,
      editing ? "Tag atualizada." : "Tag criada.",
    );
    if (ok) {
      setFormOpen(false);
      router.refresh();
    }
  }

  async function remove() {
    if (!deleting) return;
    const ok = await runFinanceAction(() => deleteFinanceTagAction(deleting.id), setPending, setNotice, "Tag excluída.");
    if (ok) {
      setDeleting(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-5">
      {notice && <FinanceNotice type={notice.type}>{notice.text}</FinanceNotice>}
      <div className="flex items-center justify-between"><p className="text-sm text-[var(--muted-foreground)]">{tags.length} tags encontradas</p><Button onClick={openCreate}><Plus className="size-4" /> Criar Tag</Button></div>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-[var(--muted)]/40 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]"><tr><th className="w-14 p-4"></th><th className="p-4">Tag</th><th className="p-4 text-right">Ações</th></tr></thead>
            <tbody className="divide-y">
              {tags.map((tag) => <tr key={tag.id}><td className="p-4"><span className="block size-5 rounded-md" style={{ background: tag.color }} /></td><td className="p-4 font-medium">{tag.name}</td><td className="p-4"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label="Editar tag" onClick={() => openEdit(tag)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" aria-label="Excluir tag" onClick={() => setDeleting(tag)}><Trash2 className="size-4" /></Button></div></td></tr>)}
            </tbody>
          </table>
          {!tags.length && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">Nenhuma tag criada.</p>}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen} title={editing ? "Editar Tag" : "Criar Tag"} footer={<Button onClick={save} disabled={pending || !name.trim()}>{pending ? "Salvando…" : "Salvar"}</Button>}>
        <div className="space-y-5">
          <Label>Nome<Input className="mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Digite o nome da tag" /></Label>
          <div><Label>Cor da Tag</Label><div className="mt-2 flex items-center gap-3"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="size-11 cursor-pointer rounded-lg border bg-transparent p-1" /><Input value={color} onChange={(event) => setColor(event.target.value)} pattern="^#[0-9a-fA-F]{6}$" /></div></div>
          <div className="rounded-xl border p-3"><span className="rounded-full px-3 py-1.5 text-sm font-medium text-white" style={{ background: color }}>{name || "Nome"}</span></div>
        </div>
      </Dialog>
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title="Excluir tag?" description="A tag será removida de todas as transações. As transações não serão excluídas." confirmLabel="Excluir" danger pending={pending} onConfirm={remove} />
    </div>
  );
}
