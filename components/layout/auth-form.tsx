"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import type { AuthFormState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "register";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const registering = mode === "register";
  return (
    <form action={formAction} className="space-y-4">
      {registering && (
        <div className="space-y-2">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={100} />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input id="password" name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={8} maxLength={72} />
      </div>
      {state.error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-[var(--danger)]">{state.error}</p>}
      <Button className="w-full" size="lg" disabled={pending}>
        {pending && <LoaderCircle className="size-4 animate-spin" />}
        {registering ? "Criar conta" : "Entrar"}
      </Button>
      <p className="text-center text-sm text-[var(--muted-foreground)]">
        {registering ? "Já possui conta?" : "Ainda não possui conta?"}{" "}
        <Link href={registering ? "/login" : "/register"} className="font-semibold text-[var(--primary)] hover:underline">
          {registering ? "Entrar" : "Criar conta"}
        </Link>
      </p>
    </form>
  );
}
