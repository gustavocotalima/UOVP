import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/current-user";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
