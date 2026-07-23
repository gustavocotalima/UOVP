"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  CircleHelp,
  CreditCard,
  Goal,
  Landmark,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  PieChart,
  Settings,
  Tags,
  UserRound,
  Sun,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import { logoutAction } from "@/features/auth/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navigation = [
  {
    label: "Menu",
    items: [
      { href: "/home", label: "Painel", icon: ChartNoAxesCombined },
      { href: "/orcamento-domestico", label: "Orçamento", icon: PieChart },
      { href: "/metas", label: "Metas", icon: Goal },
      { href: "/contas", label: "Contas", icon: Landmark },
      { href: "/faturas", label: "Faturas", icon: CreditCard },
      { href: "/transacoes", label: "Transações", icon: ListChecks },
      { href: "/tags", label: "Tags", icon: Tags },
    ],
  },
  {
    label: "Patrimônio",
    items: [
      { href: "/carteira", label: "Carteira", icon: WalletCards },
      { href: "/ferramentas", label: "Ferramentas", icon: Wrench },
      { href: "/open-finance", label: "Open Finance", icon: BadgeDollarSign },
    ],
  },
  {
    label: "Outros",
    items: [
      { href: "/perfil", label: "Perfil", icon: UserRound },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
      { href: "/faq", label: "FAQ", icon: CircleHelp },
    ],
  },
];

function Sidebar({ user, onNavigate }: { user: { name?: string | null; email?: string | null }; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);

  useEffect(() => setThemeMounted(true), []);

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-[#11120f] p-4 text-[#f4f3ed]">
      <Link href="/home" onClick={onNavigate} className="mb-8 flex items-center gap-3 rounded-xl px-2 py-2">
        <span className="grid size-10 place-items-center rounded-full border border-[#d2ad50]/60 bg-[#d2ad50]/10 text-[#d2ad50]">U</span>
        <span>
          <strong className="block text-lg tracking-[0.16em]">UOVP</strong>
          <small className="block max-w-40 text-[9px] leading-tight tracking-[0.08em] text-white/45">Uma Outra Verdade Possível</small>
        </span>
      </Link>

      <nav aria-label="Navegação principal" className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 scrollbar-thin">
        {navigation.map((group) => (
          <div key={group.label}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/home" && pathname.startsWith(`${item.href}/`));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition",
                      active ? "bg-[#d2ad50] text-[#11120f]" : "text-white/65 hover:bg-white/7 hover:text-white",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto space-y-3 border-t border-white/10 pt-4">
        <div className="px-3">
          <p className="truncate text-sm font-semibold">{user.name || "Investidor"}</p>
          <p className="truncate text-xs text-white/45">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Alternar tema"
          >
            {themeMounted && resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <form action={logoutAction} className="flex-1">
            <Button type="submit" variant="ghost" className="w-full justify-start text-white hover:bg-white/10">
              <LogOut className="size-4" /> Sair
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}

export function AppShell({ user, children }: { user: { name?: string | null; email?: string | null }; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
        <Sidebar user={user} />
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/65" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-64">
            <Sidebar user={user} onNavigate={() => setMobileOpen(false)} />
            <Button variant="ghost" size="icon" className="absolute right-2 top-2 text-white" onClick={() => setMobileOpen(false)} aria-label="Fechar menu">
              <X className="size-5" />
            </Button>
          </div>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-4 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu className="size-5" />
          </Button>
          <span className="font-semibold tracking-[0.16em]">UOVP</span>
          <span className="size-10" aria-hidden="true" />
        </header>
        <main className="mx-auto min-h-screen max-w-[1480px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
