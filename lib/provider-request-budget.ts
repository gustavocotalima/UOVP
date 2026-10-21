/** Bounds the complete operation, including response bodies, and cancels its I/O. */
export async function withProviderRequestDeadline<T>(
  options: { signal?: AbortSignal; timeoutMs: number; timeoutError: Error },
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError("O prazo da requisição precisa ser positivo e finito.");
  }
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal?.reason ?? new DOMException("Operação cancelada.", "AbortError"));
  options.signal?.addEventListener("abort", relayAbort, { once: true });
  if (options.signal?.aborted) relayAbort();
  const timer = setTimeout(() => controller.abort(options.timeoutError), options.timeoutMs);
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  try {
    const pending = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    });
    return await Promise.race([pending, aborted]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relayAbort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}
