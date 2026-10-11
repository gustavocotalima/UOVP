import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { McpConsentClient } from "@/features/mcp/consent-client";
import { getMcpAuthorizationRequest } from "@/features/mcp/oauth";
import { getMcpSettings } from "@/features/mcp/settings";
import { getActiveUser } from "@/lib/current-user";

export const metadata = { title: "Autorizar agente de IA" };

export default async function McpAuthorizePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const entries = Object.entries(params);
  if (entries.some(([, value]) => Array.isArray(value))) return <InvalidRequest />;
  const request = Object.fromEntries(entries.filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const callbackUrl = `/mcp/authorize?${new URLSearchParams(request).toString()}`;
  const user = await getActiveUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  const settings = await getMcpSettings(user.id);
  if (!settings.configured || !settings.enabled) return <InvalidRequest />;

  let authorization;
  try {
    authorization = await getMcpAuthorizationRequest(request);
  } catch {
    return <InvalidRequest />;
  }
  return <McpConsentClient clientName={authorization.clientName} redirectUri={authorization.redirectUri} requestedScopes={authorization.scopes} request={request} />;
}

function InvalidRequest() {
  return <div className="space-y-4">
    <h1 className="text-2xl font-semibold">Não foi possível autorizar</h1>
    <p role="alert" className="text-sm text-[var(--muted-foreground)]">A solicitação do agente é inválida ou o MCP não está disponível. Inicie novamente a conexão pelo cliente de IA.</p>
    <Button asChild variant="outline"><Link href="/configuracoes">Ir para Configurações</Link></Button>
  </div>;
}
