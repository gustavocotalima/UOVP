"use client";

import { useState, useTransition, type FormEvent } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Link2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { removeBrapiApiKeyAction, saveBrapiApiKeyAction } from "@/features/portfolio/actions";
import type { BrapiCredentialStatus } from "@/features/portfolio/brapi-credentials";
import {
  removePluggyCredentialsAction,
  savePluggyCredentialsAction,
} from "@/features/open-finance/pluggy-credential-actions";
import type { PluggyCredentialStatus } from "@/features/open-finance/pluggy-credentials";

function updatedAtLabel(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SettingsClient({
  initialCredential,
  initialPluggyCredential,
}: {
  initialCredential: BrapiCredentialStatus;
  initialPluggyCredential: PluggyCredentialStatus;
}) {
  const [credential, setCredential] = useState(initialCredential);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pluggyCredential, setPluggyCredential] = useState(initialPluggyCredential);
  const [pluggyClientId, setPluggyClientId] = useState("");
  const [pluggyClientSecret, setPluggyClientSecret] = useState("");
  const [pluggyMessage, setPluggyMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [confirmPluggyRemove, setConfirmPluggyRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  function saveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    startTransition(async () => {
      try {
        const status = await saveBrapiApiKeyAction(apiKey);
        setCredential({ configured: true, lastFour: status.lastFour, updatedAt: status.updatedAt });
        setApiKey("");
        setMessage({ kind: "success", text: "Chave da brapi validada e salva." });
      } catch (error) {
        setMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "Não foi possível validar a chave da brapi.",
        });
      }
    });
  }

  function removeCredential() {
    setMessage(undefined);
    startTransition(async () => {
      try {
        await removeBrapiApiKeyAction();
        setCredential({ configured: false, lastFour: null, updatedAt: null });
        setApiKey("");
        setConfirmRemove(false);
        setMessage({ kind: "success", text: "Chave da brapi removida." });
      } catch (error) {
        setConfirmRemove(false);
        setMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "Não foi possível remover a chave da brapi.",
        });
      }
    });
  }

  function savePluggyCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPluggyMessage(undefined);
    startTransition(async () => {
      try {
        const status = await savePluggyCredentialsAction({
          clientId: pluggyClientId,
          clientSecret: pluggyClientSecret,
        });
        setPluggyCredential({
          configured: true,
          clientIdLastFour: status.clientIdLastFour,
          clientSecretLastFour: status.clientSecretLastFour,
          updatedAt: status.updatedAt,
        });
        setPluggyClientId("");
        setPluggyClientSecret("");
        setPluggyMessage({ kind: "success", text: "Credenciais da Pluggy validadas e salvas." });
      } catch (error) {
        setPluggyMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "Não foi possível validar as credenciais da Pluggy.",
        });
      }
    });
  }

  function removePluggyCredential() {
    setPluggyMessage(undefined);
    startTransition(async () => {
      try {
        await removePluggyCredentialsAction();
        setPluggyCredential({
          configured: false,
          clientIdLastFour: null,
          clientSecretLastFour: null,
          updatedAt: null,
        });
        setPluggyClientId("");
        setPluggyClientSecret("");
        setConfirmPluggyRemove(false);
        setPluggyMessage({ kind: "success", text: "Credenciais da Pluggy removidas." });
      } catch (error) {
        setConfirmPluggyRemove(false);
        setPluggyMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "Não foi possível remover as credenciais da Pluggy.",
        });
      }
    });
  }

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
                <KeyRound className="size-5" />
              </span>
              <div>
                <CardTitle>Provedor de cotações</CardTitle>
                <CardDescription>Conecte sua chave individual para consultar preços e dados dos ativos da B3.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveCredential} className="space-y-5">
              {message && (
                <p
                  role={message.kind === "error" ? "alert" : "status"}
                  className={`rounded-xl p-3 text-sm ${
                    message.kind === "error"
                      ? "bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]"
                      : "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]"
                  }`}
                >
                  {message.text}
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="quote-provider">Provedor</Label>
                <div id="quote-provider" className="flex min-h-11 items-center justify-between rounded-xl border px-4">
                  <span className="font-semibold">brapi</span>
                  <span className="rounded-full bg-[var(--primary)]/12 px-2 py-1 text-[10px] font-semibold uppercase text-[var(--primary)]">
                    B3
                  </span>
                </div>
              </div>

              {credential.configured && credential.lastFour && (
                <div className="flex items-start gap-3 rounded-xl border bg-[var(--muted)]/35 p-4">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--success)]" />
                  <div>
                    <p className="text-sm font-semibold">brapi conectada</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      Chave terminando em <strong>••••{credential.lastFour}</strong>
                      {credential.updatedAt ? ` · Atualizada em ${updatedAtLabel(credential.updatedAt)}` : ""}
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="settings-brapi-api-key">
                  {credential.configured ? "Substituir chave da API" : "Chave da API"}
                </Label>
                <Input
                  id="settings-brapi-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={credential.configured ? "Cole uma nova chave" : "Cole sua chave da brapi"}
                  autoComplete="off"
                  maxLength={2000}
                  required
                />
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <a
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline"
                  href="https://brapi.dev/dashboard"
                  target="_blank"
                  rel="noreferrer"
                >
                  Obter chave na brapi <ExternalLink className="size-4" />
                </a>
                <div className="flex gap-3">
                  {credential.configured && (
                    <Button type="button" variant="danger" onClick={() => setConfirmRemove(true)} disabled={pending}>
                      Remover
                    </Button>
                  )}
                  <Button type="submit" disabled={pending || apiKey.trim().length < 8}>
                    {pending ? "Validando…" : credential.configured ? "Validar e substituir" : "Validar e conectar"}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-[var(--primary)]" />
              <CardTitle>Privacidade da chave</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-[var(--muted-foreground)]">
            <p>A chave é validada pelo backend antes de ser salva.</p>
            <p>Ela fica criptografada por usuário e nunca é devolvida ao navegador. A interface exibe somente os quatro últimos caracteres.</p>
            <p>O catálogo público usado no autocomplete não consome a sua chave.</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
                <Link2 className="size-5" />
              </span>
              <div>
                <CardTitle>Open Finance com Pluggy</CardTitle>
                <CardDescription>
                  Cada usuário conecta as credenciais da própria aplicação Pluggy.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={savePluggyCredential} className="space-y-5">
              {pluggyMessage && (
                <p
                  role={pluggyMessage.kind === "error" ? "alert" : "status"}
                  className={`rounded-xl p-3 text-sm ${
                    pluggyMessage.kind === "error"
                      ? "bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]"
                      : "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]"
                  }`}
                >
                  {pluggyMessage.text}
                </p>
              )}

              {pluggyCredential.configured && (
                <div className="flex items-start gap-3 rounded-xl border bg-[var(--muted)]/35 p-4">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--success)]" />
                  <div>
                    <p className="text-sm font-semibold">Pluggy conectada à sua conta</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      Client ID ••••{pluggyCredential.clientIdLastFour} · Client Secret ••••
                      {pluggyCredential.clientSecretLastFour}
                      {pluggyCredential.updatedAt
                        ? ` · Atualizada em ${updatedAtLabel(pluggyCredential.updatedAt)}`
                        : ""}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="settings-pluggy-client-id">
                    {pluggyCredential.configured ? "Novo Client ID" : "Client ID"}
                  </Label>
                  <Input
                    id="settings-pluggy-client-id"
                    type="password"
                    value={pluggyClientId}
                    onChange={(event) => setPluggyClientId(event.target.value)}
                    placeholder="Cole o Client ID"
                    autoComplete="new-password"
                    maxLength={500}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="settings-pluggy-client-secret">
                    {pluggyCredential.configured ? "Novo Client Secret" : "Client Secret"}
                  </Label>
                  <Input
                    id="settings-pluggy-client-secret"
                    type="password"
                    value={pluggyClientSecret}
                    onChange={(event) => setPluggyClientSecret(event.target.value)}
                    placeholder="Cole o Client Secret"
                    autoComplete="new-password"
                    maxLength={1000}
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <a
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline"
                  href="https://dashboard.pluggy.ai/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir painel da Pluggy <ExternalLink className="size-4" />
                </a>
                <div className="flex gap-3">
                  {pluggyCredential.configured && (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => setConfirmPluggyRemove(true)}
                      disabled={pending}
                    >
                      Remover
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      pending ||
                      pluggyClientId.trim().length < 8 ||
                      pluggyClientSecret.trim().length < 8
                    }
                  >
                    {pending
                      ? "Validando…"
                      : pluggyCredential.configured
                        ? "Validar e substituir"
                        : "Validar e conectar"}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-[var(--primary)]" />
              <CardTitle>Credenciais individuais</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-[var(--muted-foreground)]">
            <p>O Client ID e o Client Secret são validados no backend e criptografados separadamente para o seu usuário.</p>
            <p>As credenciais completas nunca retornam ao navegador. Cada usuário acessa somente os itens criados por sua própria aplicação Pluggy.</p>
            <p>Ao substituir as credenciais, as conexões existentes precisam pertencer à nova aplicação para continuarem sincronizando.</p>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remover chave da brapi?"
        description="As cotações existentes serão mantidas, mas novas consultas autenticadas e atualizações da B3 ficarão indisponíveis até que outra chave seja conectada."
        confirmLabel="Remover chave"
        danger
        pending={pending}
        onConfirm={removeCredential}
      />
      <ConfirmDialog
        open={confirmPluggyRemove}
        onOpenChange={setConfirmPluggyRemove}
        title="Remover credenciais da Pluggy?"
        description="Os dados já sincronizados serão mantidos, mas novas conexões e sincronizações ficarão indisponíveis para este usuário até que outras credenciais sejam configuradas."
        confirmLabel="Remover credenciais"
        danger
        pending={pending}
        onConfirm={removePluggyCredential}
      />
    </>
  );
}
