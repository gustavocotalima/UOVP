import { redirect } from "next/navigation";
import { AuthForm } from "@/components/layout/auth-form";
import { registerAction } from "@/features/auth/actions";
import { getActiveUser } from "@/lib/current-user";
import { findUsableRegistrationInvite } from "@/features/auth/invitations";

export const metadata = { title: "Criar conta" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (await getActiveUser()) redirect("/home");
  const token = (await searchParams).token ?? "";
  const invite = await findUsableRegistrationInvite(token);
  if (!invite) {
    return (
      <>
        <h1 className="text-3xl font-semibold">Cadastro somente por convite</h1>
        <p className="mb-6 mt-2 text-sm text-[var(--muted-foreground)]">
          Solicite um convite ao administrador. Convites vencidos ou já utilizados não podem ser reutilizados.
        </p>
        <a className="font-semibold text-[var(--primary)] hover:underline" href="/login">Voltar para o login</a>
      </>
    );
  }
  return (
    <>
      <h1 className="text-3xl font-semibold">Crie sua conta</h1>
      <p className="mb-6 mt-2 text-sm text-[var(--muted-foreground)]">Seus dados financeiros ficam isolados dos demais usuários.</p>
      <AuthForm
        mode="register"
        action={registerAction}
        inviteToken={token}
        invitedEmail={invite.email}
      />
    </>
  );
}
