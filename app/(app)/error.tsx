"use client";

import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="grid min-h-[60vh] place-items-center text-center"><div><p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--danger)]">Algo deu errado</p><h1 className="mt-3 text-3xl font-semibold">Não foi possível carregar esta área.</h1><p className="mt-2 text-sm text-[var(--muted-foreground)]">Tente novamente. Seus dados não foram alterados.</p><Button className="mt-6" onClick={reset}>Tentar novamente</Button></div></div>;
}
