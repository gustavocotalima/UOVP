import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDataRefreshGate } from "@/lib/client-data-refresh";
import { createSyncStatusPoller, type PluggySyncStatus } from "@/features/open-finance/sync-status-poller";

const idle: PluggySyncStatus = { active: false, automatic: false };
const active: PluggySyncStatus = { active: true, automatic: true };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("polling adaptativo do status Pluggy", () => {
  const pollers: Array<ReturnType<typeof createSyncStatusPoller>> = [];

  function setup() {
    let visible = true;
    const fetchStatus = vi.fn<(signal: AbortSignal) => Promise<PluggySyncStatus>>().mockResolvedValue(idle);
    const onStatus = vi.fn();
    const onComplete = vi.fn();
    const poller = createSyncStatusPoller({
      fetchStatus,
      onStatus,
      onComplete,
      isVisible: () => visible,
    });
    pollers.push(poller);
    return { poller, fetchStatus, onStatus, onComplete, setVisible: (value: boolean) => { visible = value; } };
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    for (const poller of pollers.splice(0)) poller.stop();
    vi.useRealTimers();
  });

  it("consulta a cada 30s ocioso, 2s ativo e confirma a conclusão uma única vez", async () => {
    const { poller, fetchStatus, onComplete } = setup();
    fetchStatus.mockResolvedValueOnce(idle).mockResolvedValueOnce(active).mockResolvedValueOnce(idle);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchStatus).toHaveBeenCalledTimes(4);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("consulta imediatamente no início local e mantém 2s mesmo antes de observar o lease", async () => {
    const { poller, fetchStatus } = setup();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const endSync = poller.beginLocalOperation();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    endSync();
    endSync();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStatus).toHaveBeenCalledTimes(4);
  });

  it("espera a resposta antes de agendar e agrupa pedidos imediatos sem sobreposição", async () => {
    const { poller, fetchStatus } = setup();
    const slow = deferred<PluggySyncStatus>();
    fetchStatus.mockReturnValueOnce(slow.promise);
    poller.start();
    await vi.advanceTimersByTimeAsync(120_000);
    const endSync = poller.beginLocalOperation();
    poller.visibilityChanged();
    poller.visibilityChanged();
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    slow.resolve(idle);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    endSync();
  });

  it("pausa e aborta ao ocultar, ignorando a resposta antiga ao voltar", async () => {
    const { poller, fetchStatus, onStatus, onComplete, setVisible } = setup();
    const slow = deferred<PluggySyncStatus>();
    fetchStatus.mockReturnValueOnce(slow.promise);
    poller.start();
    const signal = fetchStatus.mock.calls[0][0];
    setVisible(false);
    poller.visibilityChanged();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    setVisible(true);
    poller.visibilityChanged();
    // Even a transport that delays abort settlement cannot overlap another request.
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    slow.resolve(active);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(idle);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("aplica backoff exponencial até 60s e volta à cadência normal após sucesso", async () => {
    const { poller, fetchStatus, onComplete } = setup();
    fetchStatus.mockRejectedValue(new Error("indisponível")).mockResolvedValueOnce(active);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    for (const delay of [2_000, 4_000, 8_000, 16_000, 32_000, 60_000]) {
      const previous = fetchStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetchStatus).toHaveBeenCalledTimes(previous);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchStatus).toHaveBeenCalledTimes(previous + 1);
    }
    fetchStatus.mockResolvedValue(idle);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const recoveredCalls = fetchStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchStatus).toHaveBeenCalledTimes(recoveredCalls);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStatus).toHaveBeenCalledTimes(recoveredCalls + 1);
  });

  it("não publica respostas nem mantém timers depois de desmontar", async () => {
    const { poller, fetchStatus, onStatus } = setup();
    const slow = deferred<PluggySyncStatus>();
    fetchStatus.mockReturnValueOnce(slow.promise);
    poller.start();
    poller.stop();
    expect(fetchStatus.mock.calls[0][0].aborted).toBe(true);
    slow.resolve(active);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onStatus).not.toHaveBeenCalled();
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("não consulta enquanto inicia oculto e consulta imediatamente ao ficar visível", async () => {
    const { poller, fetchStatus, setVisible } = setup();
    setVisible(false);
    poller.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchStatus).not.toHaveBeenCalled();
    setVisible(true);
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    setVisible(false);
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("ack aborta o check antigo sem apagar uma operação ainda observada como ativa", async () => {
    const { poller, fetchStatus, onComplete } = setup();
    const slow = deferred<PluggySyncStatus>();
    fetchStatus.mockResolvedValueOnce(active).mockReturnValueOnce(slow.promise);
    poller.start();
    await vi.advanceTimersByTimeAsync(2_000);
    poller.acknowledgeRefresh();
    expect(fetchStatus.mock.calls[1][0].aborted).toBe(true);
    slow.resolve(active);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(onComplete).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("combina a conclusão observada com refresh manual e de mercado, sem perder mercado", async () => {
    const gate = createDataRefreshGate();
    const finishManual = gate.beginDeferral();
    const finishBootstrap = gate.beginDeferral();
    const manualRefresh = vi.fn();
    const marketRefresh = vi.fn();
    const observedRefresh = vi.fn();
    const fetchStatus = vi.fn().mockResolvedValue(idle).mockResolvedValueOnce(active);
    const poller = createSyncStatusPoller({
      fetchStatus,
      isVisible: () => true,
      onStatus: vi.fn(),
      onComplete: () => gate.request(observedRefresh, { pluggyCompleted: true }),
    });
    pollers.push(poller);
    const unsubscribe = gate.subscribe(({ pluggyCompleted }) => {
      if (pluggyCompleted) poller.acknowledgeRefresh();
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(2_000);
    gate.request(manualRefresh, { pluggyCompleted: true });
    finishManual();
    expect(observedRefresh).not.toHaveBeenCalled();
    expect(manualRefresh).not.toHaveBeenCalled();
    gate.request(marketRefresh, { pluggyCompleted: false });
    finishBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(marketRefresh).toHaveBeenCalledTimes(1);
    expect(observedRefresh).not.toHaveBeenCalled();
    expect(manualRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(marketRefresh).toHaveBeenCalledTimes(1);
    expect(observedRefresh).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("refresh exclusivo do mercado não apaga a operação Pluggy externa observada", async () => {
    const gate = createDataRefreshGate();
    const marketRefresh = vi.fn();
    const completedRefresh = vi.fn();
    const fetchStatus = vi.fn().mockResolvedValue(idle).mockResolvedValueOnce(active);
    const poller = createSyncStatusPoller({
      fetchStatus,
      isVisible: () => true,
      onStatus: vi.fn(),
      onComplete: () => gate.request(completedRefresh, { pluggyCompleted: true }),
    });
    pollers.push(poller);
    const unsubscribe = gate.subscribe(({ pluggyCompleted }) => {
      if (pluggyCompleted) poller.acknowledgeRefresh();
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    gate.request(marketRefresh, { pluggyCompleted: false });
    expect(marketRefresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(completedRefresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(completedRefresh).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("preserva uma nova operação C quando o refresh de A ficou adiado por outra integração", async () => {
    const gate = createDataRefreshGate();
    const finishBootstrap = gate.beginDeferral();
    const refresh = vi.fn();
    const completed = vi.fn(() => gate.request(refresh, { pluggyCompleted: true }));
    const fetchStatus = vi.fn().mockResolvedValue(idle)
      .mockResolvedValueOnce(active) // A starts.
      .mockResolvedValueOnce(idle) // A finishes while another integration holds the refresh.
      .mockResolvedValueOnce(active) // C starts in another tab before the deferred refresh.
      .mockResolvedValueOnce(idle); // C finishes after that refresh was requested.
    const onStatus = vi.fn();
    const poller = createSyncStatusPoller({
      fetchStatus,
      isVisible: () => true,
      onStatus,
      onComplete: completed,
    });
    pollers.push(poller);
    const unsubscribe = gate.subscribe(({ pluggyCompleted }) => {
      if (pluggyCompleted) poller.acknowledgeRefresh();
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onStatus).toHaveBeenLastCalledWith(active);
    // A late bootstrap response must not acknowledge C as if it had completed A.
    gate.request(refresh, { pluggyCompleted: true });
    finishBootstrap();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith(active);
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(completed).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
