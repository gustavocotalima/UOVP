export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="surface-grid grid min-h-screen place-items-center p-4">
      <section className="w-full max-w-md rounded-3xl border bg-[var(--card)] p-6 shadow-2xl sm:p-8">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-full border border-[var(--primary)]/50 bg-[var(--primary)]/10 text-xl font-bold text-[var(--primary)]">U</span>
          <div>
            <p className="text-lg font-semibold tracking-[0.18em]">UOVP</p>
            <p className="text-xs tracking-[0.08em] text-[var(--muted-foreground)]">Uma Outra Verdade Possível</p>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}
