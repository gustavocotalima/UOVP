import { PageHeader } from "@/components/ui/page-header";
import { getPluggyCredentialStatus } from "@/features/open-finance/pluggy-credentials";
import { getBrapiCredentialStatus } from "@/features/portfolio/brapi-credentials";
import { SettingsClient } from "@/features/settings/settings-client";
import { requireUser } from "@/lib/current-user";
import { isAppAdminEmail } from "@/features/auth/invitations";
import { listRegistrationInvites } from "@/features/auth/invite-actions";
import { getUserTimeZone } from "@/lib/user-timezone";

export const metadata = { title: "Configurações" };

function pluggyWebhookUrl(): string | null {
  const authUrl = process.env.AUTH_URL;
  if (!authUrl) return null;
  try {
    const url = new URL(authUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return new URL("/api/pluggy/webhook", url.origin).toString();
  } catch {
    return null;
  }
}

export default async function SettingsPage() {
  const user = await requireUser();
  const userId = user.id;
  const [credential, pluggyCredential, invites, timeZone] = await Promise.all([
    getBrapiCredentialStatus(userId),
    getPluggyCredentialStatus(userId),
    isAppAdminEmail(user.email) ? listRegistrationInvites() : Promise.resolve(null),
    getUserTimeZone(userId),
  ]);
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Conta"
        title="Configurações"
        description="Gerencie integrações e preferências vinculadas somente à sua conta."
      />
      <SettingsClient
        initialCredential={credential}
        initialPluggyCredential={pluggyCredential}
        pluggyWebhookUrl={pluggyWebhookUrl()}
        initialTimeZone={timeZone}
        initialInvites={invites?.map((invite) => ({
          ...invite,
          expiresAt: invite.expiresAt.toISOString(),
          usedAt: invite.usedAt?.toISOString() ?? null,
          revokedAt: invite.revokedAt?.toISOString() ?? null,
          createdAt: invite.createdAt.toISOString(),
        })) ?? null}
      />
    </div>
  );
}
