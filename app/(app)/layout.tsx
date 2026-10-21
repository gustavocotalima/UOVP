import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/current-user";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Avoid a shared loading.tsx boundary here: Next 16.2 can leave a completed
  // server-action refresh suspended, keeping saved data and pending controls stale.
  // Navigation retains the current screen until the destination is ready.
  return <AppShell user={user}>{children}</AppShell>;
}
