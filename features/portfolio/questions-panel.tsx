"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Pencil, Plus, RotateCcw, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import {
  createQuestionAction,
  deleteQuestionAction,
  resetQuestionsAction,
  updateQuestionAction,
  useQuestionModelAction as applyQuestionModelAction,
} from "./actions";
import { notifyPortfolioSimulationInvalidated } from "./client-events";
import type { DiagramQuestionDto } from "./types";

type DiagramType = "CERRADO" | "REAL_ESTATE";
type QuestionForm = { id?: string; criterion: string; text: string };
type ModelConfirmation = "restore" | "model";
const diagramTypeOptions = [
  { value: "CERRADO", label: "Diagrama do cerrado", tabId: "questions-tab-cerrado", panelId: "questions-panel-cerrado" },
  { value: "REAL_ESTATE", label: "Investimentos imobiliários", tabId: "questions-tab-real-estate", panelId: "questions-panel-real-estate" },
] as const;

export function QuestionsPanel({ questions }: { questions: DiagramQuestionDto[] }) {
  const [type, setType] = useState<DiagramType>("CERRADO");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<QuestionForm>();
  const [modelConfirmation, setModelConfirmation] = useState<ModelConfirmation>();
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const visibleQuestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return questions.filter((question) => question.type === type && (!query || question.text.toLowerCase().includes(query) || question.criterion.toLowerCase().includes(query)));
  }, [questions, search, type]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    startTransition(async () => {
      try {
        if (form.id) await updateQuestionAction(form.id, { criterion: form.criterion, text: form.text });
        else await createQuestionAction({ type, criterion: form.criterion, text: form.text });
        notifyPortfolioSimulationInvalidated();
        setForm(undefined);
        setMessage(form.id ? "Pergunta atualizada." : "Pergunta adicionada.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar a pergunta.");
      }
    });
  }

  function deleteQuestion() {
    if (!form?.id) return;
    startTransition(async () => {
      try {
        await deleteQuestionAction(form.id!);
        notifyPortfolioSimulationInvalidated();
        setDeleteConfirmation(false);
        setForm(undefined);
        setMessage("Pergunta excluída.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível excluir a pergunta.");
      }
    });
  }

  function applyModel() {
    if (!modelConfirmation) return;
    startTransition(async () => {
      try {
        if (modelConfirmation === "restore") await resetQuestionsAction(type);
        else await applyQuestionModelAction(type);
        notifyPortfolioSimulationInvalidated();
        setModelConfirmation(undefined);
        setMessage("Modelo de perguntas aplicado.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Não foi possível aplicar o modelo.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Perguntas</CardTitle>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Adicione perguntas que deverão ser feitas quando você adicionar um ativo em sua carteira.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setModelConfirmation("restore")}><RotateCcw className="size-4" /> Restaurar padrões</Button>
            <Button variant="outline" onClick={() => setModelConfirmation("model")}><Sparkles className="size-4" /> Usar modelo</Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="relative">
            <span className="sr-only">Pesquisar perguntas</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-[var(--muted-foreground)]" />
            <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar" />
          </label>
          <SegmentedTabs value={type} onValueChange={setType} ariaLabel="Tipo de diagrama" options={diagramTypeOptions} />
        </div>
      </CardHeader>
      <CardContent
        id={type === "CERRADO" ? "questions-panel-cerrado" : "questions-panel-real-estate"}
        role="tabpanel"
        aria-labelledby={type === "CERRADO" ? "questions-tab-cerrado" : "questions-tab-real-estate"}
      >
        {message && <p role="status" className="mb-4 rounded-xl bg-[var(--muted)] p-3 text-sm">{message}</p>}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Perguntas</h3>
          <Button onClick={() => setForm({ criterion: "", text: "" })}><Plus className="size-4" /> Adicionar pergunta</Button>
        </div>
        <div className="overflow-x-auto rounded-xl border scrollbar-thin">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[var(--primary)] text-[var(--primary-foreground)]">
              <tr><th className="px-4 py-3">Critério</th><th className="px-4 py-3">Pergunta</th><th className="px-4 py-3 text-right">Ação</th></tr>
            </thead>
            <tbody>
              {visibleQuestions.map((question) => (
                <tr key={question.id} className="border-b last:border-0">
                  <td className="px-4 py-4 font-semibold">{question.criterion}</td>
                  <td className="px-4 py-4 text-[var(--muted-foreground)]">{question.text}</td>
                  <td className="px-4 py-4 text-right"><Button size="sm" variant="outline" onClick={() => setForm({ id: question.id, criterion: question.criterion, text: question.text })}><Pencil className="size-4" /> Editar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleQuestions.length && <div className="grid min-h-40 place-items-center text-sm text-[var(--muted-foreground)]">Nenhuma pergunta encontrada.</div>}
        </div>

        <Dialog
          open={Boolean(form)}
          onOpenChange={(open) => !open && setForm(undefined)}
          dismissible={!pending}
          title={form?.id ? "Editar pergunta" : "Adicionar pergunta"}
          className="max-w-2xl"
          footer={form && (
            <>
              {form.id && <Button type="button" variant="danger" onClick={() => setDeleteConfirmation(true)} disabled={pending}>Excluir pergunta</Button>}
              <Button type="submit" form="question-modal-form" disabled={pending || form.criterion.trim().length < 2 || form.text.trim().length < 5}>{pending ? "Salvando…" : "Salvar"}</Button>
            </>
          )}
        >
          {form && (
            <form id="question-modal-form" className="space-y-4" onSubmit={submit}>
              <div className="space-y-2"><Label htmlFor="question-criterion">Critério</Label><Input id="question-criterion" placeholder="Ex: CAGR" value={form.criterion} onChange={(event) => setForm({ ...form, criterion: event.target.value.toUpperCase() })} maxLength={80} required /></div>
              <div className="space-y-2"><Label htmlFor="question-text">Pergunta</Label><Input id="question-text" placeholder="Ex: Tem um crescimento de receitas superior a 5%?" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} maxLength={240} required /></div>
            </form>
          )}
        </Dialog>

        <ConfirmDialog
          open={Boolean(modelConfirmation)}
          onOpenChange={(open) => !open && setModelConfirmation(undefined)}
          title={modelConfirmation === "restore" ? "Restaurar perguntas" : "Modelos de diagramas"}
          description={modelConfirmation === "restore"
            ? "Todas as perguntas que você adicionou serão removidas, sendo mantido o modelo padrão do diagrama selecionado. Deseja seguir?"
            : "Você deseja utilizar o modelo de perguntas para o diagrama selecionado?"}
          pending={pending}
          onConfirm={applyModel}
        />

        <ConfirmDialog
          open={deleteConfirmation}
          onOpenChange={setDeleteConfirmation}
          title="Excluir pergunta"
          description="A pergunta e as respostas relacionadas a ela serão removidas. Deseja seguir?"
          confirmLabel="Excluir pergunta"
          danger
          pending={pending}
          onConfirm={deleteQuestion}
        />
      </CardContent>
    </Card>
  );
}
