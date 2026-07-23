import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <main className="grid min-h-screen place-items-center p-6 text-center"><div><p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--primary)]">404</p><h1 className="mt-3 text-4xl font-semibold">Página não encontrada</h1><Button className="mt-6" asChild><Link href="/home">Voltar para Home</Link></Button></div></main>;
}
