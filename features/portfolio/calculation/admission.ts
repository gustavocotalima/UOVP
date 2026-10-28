export class AllocationLimitError extends Error {
  readonly status = 429;
  constructor(public readonly code: "ALLOCATION_BUSY" | "ALLOCATION_RATE_LIMIT", public readonly retryAfterMs: number) {
    super(code === "ALLOCATION_BUSY"
      ? "Já existe um cálculo de aporte em andamento para sua conta. Aguarde sua conclusão."
      : "Limite de seis cálculos de aporte por minuto atingido. Aguarde antes de calcular novamente.");
    this.name = "AllocationLimitError";
  }
}

// Next entry bundles/HMR can reuse the global admission instance while loading
// a different copy of this module. Do not rely on constructor identity here.
export function isAllocationLimitError(error: unknown): error is AllocationLimitError {
  return error instanceof Error && error.name === "AllocationLimitError"
    && "status" in error && error.status === 429 && "code" in error
    && (error.code === "ALLOCATION_BUSY" || error.code === "ALLOCATION_RATE_LIMIT");
}

/** Admission belongs to the authenticated account, not an HTTP connection or
 * OAuth client. One outstanding calculation per account also means one FIFO
 * worker-queue entry per account, so a single account cannot fill the pool.
 * Operational in-memory bookkeeping keeps MCP financial queries read-only.
 */
export class AllocationAdmission {
  private readonly active = new Set<string>();
  private readonly starts = new Map<string, number[]>();
  private lastCleanup = 0;
  constructor(private readonly now = () => Date.now()) {}

  async run<T>(userId: string, action: () => Promise<T>): Promise<T> {
    if (!userId) throw new Error("O cálculo precisa de uma conta autenticada.");
    const now = this.now(), cutoff = now - 60_000;
    if (now - this.lastCleanup >= 60_000) {
      for (const [id, times] of this.starts) if (!this.active.has(id) && times.every((t) => t <= cutoff)) this.starts.delete(id);
      this.lastCleanup = now;
    }
    if (this.active.has(userId)) throw new AllocationLimitError("ALLOCATION_BUSY", 1000);
    const recent = (this.starts.get(userId) ?? []).filter((t) => t > cutoff);
    if (recent.length >= 6) throw new AllocationLimitError("ALLOCATION_RATE_LIMIT", Math.max(1, recent[0] + 60_000 - now));
    recent.push(now); this.starts.set(userId, recent); this.active.add(userId);
    try { return await action(); } finally { this.active.delete(userId); }
  }
}
