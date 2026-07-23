import { redirect } from "next/navigation";
import { AuthForm } from "@/components/layout/auth-form";
import { loginAction } from "@/features/auth/actions";
import { getActiveUser } from "@/lib/current-user";

export const metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registration?: string }>;
}) {
  if (await getActiveUser()) redirect("/home");
  const registrationAccepted = (await searchParams).registration === "accepted";
  return (
    <>
      <h1 className="text-3xl font-semibold">Bem-vindo</h1>
      <p className="mb-6 mt-2 text-sm text-[var(--muted-foreground)]">Entre para acessar sua carteira e seu planejamento.</p>
      {registrationAccepted && (
        <p role="status" className="mb-4 rounded-xl bg-[var(--muted)] p-3 text-sm">
          Se os dados estavam disponíveis, a conta foi criada. Use suas credenciais para entrar.
        </p>
      )}
      <AuthForm mode="login" action={loginAction} />
    </>
  );
}
