import { PageHeader } from "@/components/ui/page-header";
import { getPluggyCredentialStatus } from "@/features/open-finance/pluggy-credentials";
import { getBrapiCredentialStatus } from "@/features/portfolio/brapi-credentials";
import { SettingsClient } from "@/features/settings/settings-client";
import { requireUserId } from "@/lib/current-user";

export const metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const userId = await requireUserId();
  const [credential, pluggyCredential] = await Promise.all([
    getBrapiCredentialStatus(userId),
    getPluggyCredentialStatus(userId),
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
      />
    </div>
  );
}
