"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function MonthNavigator({
  year,
  month,
  compact = false,
}: {
  year: number;
  month: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function move(offset: number) {
    const monthIndex = year * 12 + month - 1 + offset;
    const next = new URLSearchParams(searchParams.toString());
    next.set("year", String(Math.floor(monthIndex / 12)));
    next.set("month", String((monthIndex % 12) + 1));
    router.push(`?${next.toString()}`, { scroll: false });
  }

  return (
    <div className={cn(
      "flex items-center gap-2",
      !compact && "w-full justify-between rounded-2xl border bg-[var(--card)] p-1.5 sm:w-auto",
    )}>
      <Button variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => move(-1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <div className={cn("min-w-36 text-center", !compact && "px-2")}>
        {!compact && <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Mês/Ano</p>}
        <p className="text-sm font-semibold">{MONTHS[month - 1]} {year}</p>
      </div>
      <Button variant="ghost" size="icon" aria-label="Próximo mês" onClick={() => move(1)}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

export function FinanceNotice({
  type,
  children,
}: {
  type: "success" | "error" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        type === "success" && "border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]",
        type === "error" && "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]",
        type === "info" && "bg-[var(--muted)]",
      )}
    >
      {children}
    </div>
  );
}

export async function runFinanceAction(
  action: () => Promise<unknown>,
  setPending: (value: boolean) => void,
  setNotice: (value: { type: "success" | "error"; text: string } | null) => void,
  success: string,
) {
  setPending(true);
  setNotice(null);
  try {
    await action();
    setNotice({ type: "success", text: success });
    return true;
  } catch (error) {
    setNotice({ type: "error", text: error instanceof Error ? error.message : "Não foi possível concluir a ação." });
    return false;
  } finally {
    setPending(false);
  }
}
