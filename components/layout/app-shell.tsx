"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  CreditCard,
  Goal,
  Landmark,
  ListChecks,
  LogOut,
  MoreHorizontal,
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
import { InstallProvider } from "@/components/pwa/install-provider";
import { AutomaticRefreshCoordinator } from "@/components/layout/automatic-refresh-coordinator";

const navigation = [
  {
    label: "Orçamento Doméstico",
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
];

const mobilePrimaryNavigation = [
  { href: "/home", label: "Painel", icon: ChartNoAxesCombined },
  { href: "/transacoes", label: "Transações", icon: ListChecks },
  { href: "/carteira", label: "Carteira", icon: WalletCards },
  { href: "/open-finance", label: "Open Finance", icon: BadgeDollarSign },
] as const;

const mobileMoreNavigation = navigation.flatMap((group) => group.items).filter(
  (item) => !mobilePrimaryNavigation.some((primary) => primary.href === item.href),
);

const subscribeToHydration = () => () => undefined;

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full border border-[#d2ad50]/60 bg-[#d2ad50]/10",
        compact ? "size-8" : "size-10",
      )}
      aria-hidden="true"
    >
      <Image
        src="/UOVP_logo.svg"
        alt=""
        width={64}
        height={64}
        className="size-full scale-[1.35] object-contain"
      />
    </span>
  );
}

function Sidebar({ user, onNavigate }: { user: { name?: string | null; email?: string | null }; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const themeMounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);

  return (
    <aside className="flex h-full w-56 flex-col border-r bg-[#11120f] p-4 text-[#f4f3ed] min-[2048px]:w-64">
      <Link href="/home" onClick={onNavigate} className="mb-8 flex items-center gap-3 rounded-xl px-2 py-2">
        <BrandMark />
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
        <div className="flex items-center gap-2">
          <form action={logoutAction} className="mr-auto">
            <Button type="submit" variant="ghost" className="justify-start text-white hover:bg-white/10">
              <LogOut className="size-4" /> Sair
            </Button>
          </form>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-white hover:bg-white/10",
              pathname === "/configuracoes" && "bg-white/10",
            )}
            asChild
          >
            <Link
              href="/configuracoes"
              onClick={onNavigate}
              aria-label="Configurações"
              aria-current={pathname === "/configuracoes" ? "page" : undefined}
            >
              <Settings className="size-4" />
            </Link>
          </Button>
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
        </div>
        <Link
          href="/perfil"
          onClick={onNavigate}
          aria-current={pathname === "/perfil" ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2 transition",
            pathname === "/perfil"
              ? "bg-white/10 text-white"
              : "hover:bg-white/7",
          )}
        >
          <UserRound className="size-5 shrink-0 text-white/65" aria-hidden="true" />
          <span className="min-w-0">
            <strong className="block truncate text-sm">{user.name || "Investidor"}</strong>
            <small className="block truncate text-xs text-white/45">{user.email}</small>
          </span>
        </Link>
      </div>
    </aside>
  );
}

function MobileMoreMenu({
  user,
  pathname,
  resolvedTheme,
  themeMounted,
  setTheme,
  onNavigate,
}: {
  user: { name?: string | null; email?: string | null };
  pathname: string;
  resolvedTheme?: string;
  themeMounted: boolean;
  setTheme: (theme: string) => void;
  onNavigate: () => void;
}) {
  return (
    <div className="flex max-h-[min(84dvh,46rem)] flex-col overflow-hidden rounded-t-3xl border border-b-0 bg-[#11120f] text-[#f4f3ed] shadow-2xl">
      <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-white/20" aria-hidden="true" />
      <div className="flex items-center justify-between px-5 pb-4 pt-3">
        <div>
          <p className="text-lg font-semibold">Mais opções</p>
          <p className="text-xs text-white/45">Orçamento, patrimônio e preferências</p>
        </div>
        <Button data-mobile-menu-close variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={onNavigate} aria-label="Fechar menu">
          <X className="size-5" />
        </Button>
      </div>

      <nav aria-label="Mais opções de navegação" className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto px-4 pb-4 scrollbar-thin">
        {mobileMoreNavigation.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 items-center gap-3 rounded-2xl border border-white/8 px-4 text-sm font-medium",
                active ? "bg-[#d2ad50] text-[#11120f]" : "bg-white/4 text-white/75 hover:bg-white/8 hover:text-white",
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
        <Link
          href="/perfil"
          onClick={onNavigate}
          aria-current={pathname === "/perfil" ? "page" : undefined}
          className="mb-3 flex min-h-14 items-center gap-3 rounded-2xl bg-white/5 px-4"
        >
          <UserRound className="size-5 shrink-0 text-white/65" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm">{user.name || "Investidor"}</strong>
            <small className="block truncate text-xs text-white/45">{user.email}</small>
          </span>
        </Link>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="ghost" className="min-h-12 text-white hover:bg-white/10" asChild>
            <Link href="/configuracoes" onClick={onNavigate}><Settings className="size-4" /> Ajustes</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 text-white hover:bg-white/10"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {themeMounted && resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            Tema
          </Button>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" className="min-h-12 w-full text-white hover:bg-white/10">
              <LogOut className="size-4" /> Sair
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: { name?: string | null; email?: string | null }; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const themeMounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const background = backgroundRef.current;
    const originalBackgroundInert = background?.inert ?? false;
    const originalOverflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      drawerRef.current?.querySelector<HTMLElement>("[data-mobile-menu-close]")?.focus();
    });
    const desktopMedia = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      if (!focusable.length) {
        event.preventDefault();
        drawerRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    desktopMedia.addEventListener("change", closeOnDesktop);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      desktopMedia.removeEventListener("change", closeOnDesktop);
      if (background) background.inert = originalBackgroundInert;
      document.body.style.overflow = originalOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mobileOpen]);

  return (
    <InstallProvider>
      <div className="min-h-screen">
        <div ref={backgroundRef}>
          <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
            <Sidebar user={user} />
          </div>
          <div className="lg:pl-56 min-[2048px]:pl-64">
          <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-4 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
            <Link href="/home" className="flex min-h-11 items-center gap-2" aria-label="Ir para o painel">
              <BrandMark compact />
              <span className="font-semibold tracking-[0.14em]">UOVP</span>
            </Link>
            <Link href="/perfil" className="grid size-11 place-items-center rounded-xl" aria-label="Abrir perfil">
              <UserRound className="size-5" />
            </Link>
          </header>
          <main
            className={cn(
              "@container mx-auto min-h-screen px-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pt-6 lg:p-6 min-[1600px]:p-8 min-[2048px]:p-8",
              pathname.startsWith("/carteira")
                ? "max-w-[1680px]"
                : "max-w-[1480px]",
            )}
          >
            {children}
          </main>
        </div>
        <nav
          aria-label="Navegação móvel"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-[color-mix(in_srgb,var(--card)_94%,transparent)] px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl lg:hidden"
        >
          {mobilePrimaryNavigation.map((item) => {
            const active = pathname === item.href || (item.href !== "/home" && pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[4.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold",
                  active ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]",
                )}
              >
                <Icon className={cn("size-5", active && "stroke-[2.5]")} aria-hidden="true" />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir mais opções"
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            className={cn(
              "flex min-h-[4.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold",
              mobileMoreNavigation.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
                ? "text-[var(--primary)]"
                : "text-[var(--muted-foreground)]",
            )}
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
            <span>Mais</span>
          </button>
          </nav>
        </div>
      {mobileOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end bg-black/65 backdrop-blur-[2px] lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Mais opções"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setMobileOpen(false);
            }}
          >
            <div id="mobile-navigation" ref={drawerRef} tabIndex={-1} className="w-full">
              <MobileMoreMenu
                user={user}
                pathname={pathname}
                resolvedTheme={resolvedTheme}
                themeMounted={themeMounted}
                setTheme={setTheme}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </div>
        )}
        <AutomaticRefreshCoordinator />
      </div>
    </InstallProvider>
  );
}
