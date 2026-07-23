import { redirect } from "next/navigation";
import { AuthForm } from "@/components/layout/auth-form";
import { registerAction } from "@/features/auth/actions";
import { getActiveUser } from "@/lib/current-user";

export const metadata = { title: "Criar conta" };

export default async function RegisterPage() {
  if (await getActiveUser()) redirect("/home");
  return (
    <>
      <h1 className="text-3xl font-semibold">Crie sua conta</h1>
      <p className="mb-6 mt-2 text-sm text-[var(--muted-foreground)]">Seus dados financeiros ficam isolados dos demais usuários.</p>
      <AuthForm mode="register" action={registerAction} />
    </>
  );
}
