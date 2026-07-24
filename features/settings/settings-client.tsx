"use client";

import { useState, useTransition, type FormEvent } from "react";
import { CalendarClock, CheckCircle2, Coins, Copy, ExternalLink, Globe2, KeyRound, Link2, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { removeBrapiApiKeyAction, saveBrapiApiKeyAction } from "@/features/portfolio/actions";
import type { BrapiCredentialStatus } from "@/features/portfolio/brapi-credentials";
import {
  removePluggyCredentialsAction,
  savePluggyCredentialsAction,
  savePluggyWebhookSecretAction,
} from "@/features/open-finance/pluggy-credential-actions";
import type { PluggyCredentialStatus } from "@/features/open-finance/pluggy-credentials";
import {
  createRegistrationInviteAction,
  revokeRegistrationInviteAction,
} from "@/features/auth/invite-actions";
import { saveTimeZoneAction } from "./actions";

type RegistrationInviteDto = {
  id: string;
  email: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

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
  pluggyWebhookUrl,
  initialInvites,
  initialTimeZone,
}: {
  initialCredential: BrapiCredentialStatus;
  initialPluggyCredential: PluggyCredentialStatus;
  pluggyWebhookUrl: string | null;
  initialInvites: RegistrationInviteDto[] | null;
  initialTimeZone: string;
}) {
  const [credential, setCredential] = useState(initialCredential);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pluggyCredential, setPluggyCredential] = useState(initialPluggyCredential);
  const [pluggyClientId, setPluggyClientId] = useState("");
  const [pluggyClientSecret, setPluggyClientSecret] = useState("");
  const [pluggyWebhookSecret, setPluggyWebhookSecret] = useState("");
  const [pluggyMessage, setPluggyMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [pluggyWebhookMessage, setPluggyWebhookMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [confirmPluggyRemove, setConfirmPluggyRemove] = useState(false);
  const [brapiPending, startBrapiTransition] = useTransition();
  const [pluggyPending, startPluggyTransition] = useTransition();
  const [webhookPending, startWebhookTransition] = useTransition();
  const [invites, setInvites] = useState(initialInvites);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteMessage, setInviteMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [invitePending, startInviteTransition] = useTransition();
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [timeZonePending, startTimeZoneTransition] = useTransition();
  const [timeZoneMessage, setTimeZoneMessage] = useState<string>();

  function saveTimeZone(value: string) {
    setTimeZone(value);
    setTimeZoneMessage(undefined);
    startTimeZoneTransition(async () => {
      try {
        const result = await saveTimeZoneAction(value);
        setTimeZone(result.timeZone);
        setTimeZoneMessage("Fuso horário atualizado.");
      } catch (error) {
        setTimeZone(initialTimeZone);
        setTimeZoneMessage(error instanceof Error ? error.message : "Não foi possível atualizar.");
      }
    });
  }

  function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteMessage(undefined);
    startInviteTransition(async () => {
      try {
        const result = await createRegistrationInviteAction(inviteEmail);
        const link = `${window.location.origin}/register?token=${encodeURIComponent(result.token)}`;
        setInviteLink(link);
        setInviteEmail("");
        setInvites((current) => current ? [{
          id: result.id,
          email: result.email,
          expiresAt: result.expiresAt,
          usedAt: null,
          revokedAt: null,
          createdAt: new Date().toISOString(),
        }, ...current.filter((invite) => invite.email !== result.email || invite.usedAt)] : current);
        setInviteMessage({ kind: "success", text: "Convite criado. Copie o link agora; o token não será exibido novamente." });
      } catch (error) {
        setInviteMessage({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível criar o convite." });
      }
    });
  }

  function revokeInvite(inviteId: string) {
    setInviteMessage(undefined);
    startInviteTransition(async () => {
      try {
        await revokeRegistrationInviteAction(inviteId);
        setInvites((current) => current?.map((invite) =>
          invite.id === inviteId ? { ...invite, revokedAt: new Date().toISOString() } : invite,
        ) ?? null);
        setInviteMessage({ kind: "success", text: "Convite revogado." });
      } catch (error) {
        setInviteMessage({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível revogar o convite." });
      }
    });
  }

  function saveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    startBrapiTransition(async () => {
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
    startBrapiTransition(async () => {
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
    startPluggyTransition(async () => {
      try {
        const status = await savePluggyCredentialsAction({
          clientId: pluggyClientId,
          clientSecret: pluggyClientSecret,
        });
        setPluggyCredential((current) => ({
          ...current,
          configured: true,
          clientIdLastFour: status.clientIdLastFour,
          clientSecretLastFour: status.clientSecretLastFour,
          updatedAt: status.updatedAt,
        }));
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

  function savePluggyWebhookSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPluggyWebhookMessage(undefined);
    startWebhookTransition(async () => {
      try {
        const status = await savePluggyWebhookSecretAction(pluggyWebhookSecret);
        setPluggyCredential((current) => ({
          ...current,
          webhookConfigured: true,
          webhookSecretLastFour: status.webhookSecretLastFour,
          webhookUpdatedAt: status.webhookUpdatedAt,
        }));
        setPluggyWebhookSecret("");
        setPluggyWebhookMessage({
          kind: "success",
          text: "Segredo individual do webhook salvo.",
        });
      } catch (error) {
        setPluggyWebhookMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "Não foi possível salvar o segredo do webhook.",
        });
      }
    });
  }

  function removePluggyCredential() {
    setPluggyMessage(undefined);
    startPluggyTransition(async () => {
      try {
        await removePluggyCredentialsAction();
        setPluggyCredential({
          configured: false,
          clientIdLastFour: null,
          clientSecretLastFour: null,
          webhookConfigured: false,
          webhookSecretLastFour: null,
          webhookUpdatedAt: null,
          updatedAt: null,
        });
        setPluggyClientId("");
        setPluggyClientSecret("");
        setPluggyWebhookSecret("");
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
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
              <CalendarClock className="size-5" />
            </span>
            <div>
              <CardTitle>Calendário financeiro</CardTitle>
              <CardDescription>Datas, viradas de mês e faturas respeitam o fuso da sua conta.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="max-w-md space-y-2">
          <Label htmlFor="settings-time-zone">Fuso horário</Label>
          <Select
            id="settings-time-zone"
            value={timeZone}
            disabled={timeZonePending}
            onChange={(event) => saveTimeZone(event.target.value)}
          >
            <option value="America/Sao_Paulo">Brasília (São Paulo)</option>
            <option value="America/Manaus">Amazonas (Manaus)</option>
            <option value="America/Cuiaba">Mato Grosso (Cuiabá)</option>
            <option value="America/Rio_Branco">Acre (Rio Branco)</option>
            <option value="America/Noronha">Fernando de Noronha</option>
          </Select>
          {timeZoneMessage && <p role="status" className="text-xs text-[var(--muted-foreground)]">{timeZoneMessage}</p>}
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
                <KeyRound className="size-5" />
              </span>
              <div>
                <CardTitle>Provedores de cotações</CardTitle>
                <CardDescription>A B3 usa sua chave individual da brapi; ativos internacionais usam o Yahoo Finance e criptomoedas usam a Binance.</CardDescription>
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
                    <Button type="button" variant="danger" onClick={() => setConfirmRemove(true)} disabled={brapiPending}>
                      Remover
                    </Button>
                  )}
                  <Button type="submit" disabled={brapiPending || apiKey.trim().length < 8}>
                    {brapiPending ? "Validando…" : credential.configured ? "Validar e substituir" : "Validar e conectar"}
                  </Button>
                </div>
              </div>
            </form>
            <div className="mt-6 flex items-start gap-3 rounded-xl border bg-[var(--muted)]/25 p-4">
              <Globe2 className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">Yahoo Finance</p>
                  <span className="rounded-full bg-[var(--primary)]/12 px-2 py-1 text-[10px] font-semibold uppercase text-[var(--primary)]">
                    Internacional
                  </span>
                  <span className="rounded-full bg-[var(--success)]/12 px-2 py-1 text-[10px] font-semibold uppercase text-[var(--success)]">
                    Sem chave
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                  Ativado automaticamente e sem chave. Usado para ações, REITs, ETFs e câmbio para BRL.
                  É uma integração não oficial destinada ao uso pessoal.
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-xl border bg-[var(--muted)]/25 p-4">
              <Coins className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">Binance</p>
                  <span className="rounded-full bg-[var(--primary)]/12 px-2 py-1 text-[10px] font-semibold uppercase text-[var(--primary)]">
                    Criptomoedas
                  </span>
                  <span className="rounded-full bg-[var(--success)]/12 px-2 py-1 text-[10px] font-semibold uppercase text-[var(--success)]">
                    Sem chave
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                  Ativada automaticamente com dados públicos do mercado Spot. Usa pares em BRL quando disponíveis
                  e, nos demais casos, converte o par em USDT pela cotação USDT/BRL da própria Binance.
                </p>
              </div>
            </div>
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
                      disabled={pluggyPending || webhookPending}
                    >
                      Remover
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      pluggyPending ||
                      pluggyClientId.trim().length < 8 ||
                      pluggyClientSecret.trim().length < 8
                    }
                  >
                    {pluggyPending
                      ? "Validando…"
                      : pluggyCredential.configured
                        ? "Validar e substituir"
                        : "Validar e conectar"}
                  </Button>
                </div>
              </div>
            </form>

            <div className="mt-6 border-t pt-6">
              <div className="mb-4">
                <h3 className="font-semibold">Webhook individual</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                  Configure esta URL na sua aplicação Pluggy e envie o mesmo segredo no header{" "}
                  <code>x-pluggy-webhook-secret</code>.
                </p>
              </div>

              {pluggyWebhookMessage && (
                <p
                  role={pluggyWebhookMessage.kind === "error" ? "alert" : "status"}
                  className={`mb-4 rounded-xl p-3 text-sm ${
                    pluggyWebhookMessage.kind === "error"
                      ? "bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]"
                      : "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]"
                  }`}
                >
                  {pluggyWebhookMessage.text}
                </p>
              )}

              {pluggyCredential.webhookConfigured && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border bg-[var(--muted)]/35 p-4">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--success)]" />
                  <div>
                    <p className="text-sm font-semibold">Webhook configurado para este usuário</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      Segredo ••••{pluggyCredential.webhookSecretLastFour}
                      {pluggyCredential.webhookUpdatedAt
                        ? ` · Atualizado em ${updatedAtLabel(pluggyCredential.webhookUpdatedAt)}`
                        : ""}
                    </p>
                  </div>
                </div>
              )}

              <form onSubmit={savePluggyWebhookSecret} className="space-y-4">
                {pluggyWebhookUrl ? (
                  <div className="space-y-2">
                    <Label htmlFor="settings-pluggy-webhook-url">URL do webhook</Label>
                    <Input
                      id="settings-pluggy-webhook-url"
                      value={pluggyWebhookUrl}
                      readOnly
                      aria-describedby="settings-pluggy-webhook-url-help"
                    />
                    <p id="settings-pluggy-webhook-url-help" className="text-xs text-[var(--muted-foreground)]">
                      Copie a URL completa para a configuração do webhook no painel da Pluggy.
                    </p>
                  </div>
                ) : (
                  <p
                    role="alert"
                    className="rounded-xl border border-[var(--danger)]/45 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]"
                  >
                    A URL pública do webhook não está configurada. Defina uma AUTH_URL absoluta e válida no ambiente da aplicação.
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="settings-pluggy-webhook-secret">
                    {pluggyCredential.webhookConfigured ? "Novo segredo do webhook" : "Segredo do webhook"}
                  </Label>
                  <Input
                    id="settings-pluggy-webhook-secret"
                    type="password"
                    value={pluggyWebhookSecret}
                    onChange={(event) => setPluggyWebhookSecret(event.target.value)}
                    placeholder="Use ao menos 32 caracteres aleatórios"
                    autoComplete="new-password"
                    minLength={32}
                    maxLength={1000}
                    required
                    aria-describedby="settings-pluggy-webhook-secret-help"
                  />
                  <p id="settings-pluggy-webhook-secret-help" className="text-xs text-[var(--muted-foreground)]">
                    O valor é criptografado e nunca é devolvido ao navegador após o salvamento.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={
                      webhookPending
                      || !pluggyWebhookUrl
                      || pluggyWebhookSecret.trim().length < 32
                    }
                  >
                    {webhookPending
                      ? "Salvando…"
                      : pluggyCredential.webhookConfigured
                        ? "Substituir segredo"
                        : "Salvar segredo"}
                  </Button>
                </div>
              </form>
            </div>
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

      {invites && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
                <UserPlus className="size-5" />
              </span>
              <div>
                <CardTitle>Convites de acesso</CardTitle>
                <CardDescription>Novas contas só podem ser criadas com um convite individual válido por sete dias.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {inviteMessage && (
              <p
                role={inviteMessage.kind === "error" ? "alert" : "status"}
                className={inviteMessage.kind === "error"
                  ? "rounded-xl bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]"
                  : "rounded-xl bg-[var(--success)]/10 p-3 text-sm text-[var(--success)]"}
              >
                {inviteMessage.text}
              </p>
            )}
            <form onSubmit={createInvite} className="flex flex-col gap-3 sm:flex-row">
              <div className="min-w-0 flex-1">
                <Label className="sr-only" htmlFor="invite-email">E-mail do convidado</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="amigo@exemplo.com"
                  maxLength={254}
                  required
                />
              </div>
              <Button disabled={invitePending || !inviteEmail.trim()}><UserPlus className="size-4" />Criar convite</Button>
            </form>
            {inviteLink && (
              <div className="flex flex-col gap-3 rounded-xl border bg-[var(--muted)]/30 p-4 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate text-xs">{inviteLink}</code>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(inviteLink)}
                >
                  <Copy className="size-4" />Copiar link
                </Button>
              </div>
            )}
            <div className="divide-y rounded-xl border">
              {invites.length ? invites.map((invite) => {
                const status = invite.usedAt
                  ? "Utilizado"
                  : invite.revokedAt
                    ? "Revogado"
                    : new Date(invite.expiresAt) <= new Date()
                      ? "Expirado"
                      : "Ativo";
                return (
                  <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-semibold">{invite.email}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {status} · expira em {updatedAtLabel(invite.expiresAt)}
                      </p>
                    </div>
                    {status === "Ativo" && (
                      <Button type="button" size="sm" variant="ghost" disabled={invitePending} onClick={() => revokeInvite(invite.id)}>
                        <Trash2 className="size-4" />Revogar
                      </Button>
                    )}
                  </div>
                );
              }) : <p className="p-4 text-sm text-[var(--muted-foreground)]">Nenhum convite criado.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remover chave da brapi?"
        description="As cotações existentes serão mantidas, mas novas consultas autenticadas e atualizações da B3 ficarão indisponíveis até que outra chave seja conectada."
        confirmLabel="Remover chave"
        danger
        pending={brapiPending}
        onConfirm={removeCredential}
      />
      <ConfirmDialog
        open={confirmPluggyRemove}
        onOpenChange={setConfirmPluggyRemove}
        title="Remover credenciais da Pluggy?"
        description="Os dados já sincronizados serão mantidos, mas novas conexões e sincronizações ficarão indisponíveis para este usuário até que outras credenciais sejam configuradas."
        confirmLabel="Remover credenciais"
        danger
        pending={pluggyPending}
        onConfirm={removePluggyCredential}
      />
    </>
  );
}
