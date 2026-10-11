import { redirect } from "next/navigation";
import { AuthForm } from "@/components/layout/auth-form";
import { loginAction } from "@/features/auth/actions";
import { getActiveUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { safeLoginCallback } from "@/lib/auth-callback";

export const metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registration?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeLoginCallback(params.callbackUrl);
  if (await getActiveUser()) redirect(callbackUrl);
  const registrationAvailable = !await prisma.user.findFirst({ select: { id: true } });
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
      <AuthForm
        mode="login"
        action={loginAction}
        callbackUrl={callbackUrl}
        registrationAvailable={registrationAvailable}
      />
    </>
  );
}
