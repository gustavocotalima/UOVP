import * as React from "react";
import { cn } from "@/lib/utils";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("h-11 rounded-xl border bg-[var(--card)] px-3 text-sm", className)} {...props}>
      {children}
    </select>
  );
}
