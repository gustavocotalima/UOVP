import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex min-w-0 flex-col gap-4 border-b pb-4 sm:pb-6 @3xl:flex-row @3xl:items-end @3xl:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--primary)]">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl @5xl:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>}
      </div>
      {actions && <div className="min-w-0 shrink-0">{actions}</div>}
    </header>
  );
}
