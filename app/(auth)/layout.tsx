export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="surface-grid grid min-h-screen place-items-center p-4">
      <section className="w-full max-w-md rounded-3xl border bg-[var(--card)] p-6 shadow-2xl sm:p-8">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-full border border-[var(--primary)]/50 bg-[var(--primary)]/10 text-xl font-bold text-[var(--primary)]">A</span>
          <div>
            <p className="text-lg font-semibold tracking-[0.18em]">AURUM</p>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted-foreground)]">Finanças</p>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}
