import { describe, expect, it, vi } from "vitest";
import { createDataRefreshGate } from "@/lib/client-data-refresh";

describe("coordenação dos refreshes das integrações", () => {
  it("não solicita refresh quando todas as operações terminam sem alterações", () => {
    const gate = createDataRefreshGate();
    const listener = vi.fn();
    gate.subscribe(listener);
    const release = gate.beginDeferral();
    release();
    release();
    expect(listener).not.toHaveBeenCalled();
  });

  it("faz um refresh ao liberar a última operação, preservando a conclusão Pluggy", () => {
    const gate = createDataRefreshGate();
    const manual = vi.fn();
    const bootstrap = vi.fn();
    const listener = vi.fn();
    gate.subscribe(listener);
    const finishManual = gate.beginDeferral();
    const finishBootstrap = gate.beginDeferral();
    gate.request(manual, { pluggyCompleted: true });
    gate.request(bootstrap, { pluggyCompleted: false });
    finishManual();
    finishManual();
    expect(manual).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    finishBootstrap();
    expect(manual).not.toHaveBeenCalled();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ pluggyCompleted: true });
    finishBootstrap();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it("notifica somente depois do refresh efetivamente solicitado", () => {
    const gate = createDataRefreshGate();
    const order: string[] = [];
    gate.subscribe(() => { order.push("notification"); });
    const release = gate.beginDeferral();
    gate.request(() => { order.push("refresh"); }, { pluggyCompleted: true });
    expect(order).toEqual([]);
    release();
    expect(order).toEqual(["refresh", "notification"]);
  });

  it("refresh de mercado ou Binance não confirma uma conclusão Pluggy externa", () => {
    const gate = createDataRefreshGate();
    const listener = vi.fn();
    const refresh = vi.fn();
    const unsubscribe = gate.subscribe(listener);
    gate.request(refresh);
    expect(listener).toHaveBeenLastCalledWith({ pluggyCompleted: false });
    gate.request(refresh, { pluggyCompleted: true });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ pluggyCompleted: true });
    unsubscribe();
    gate.request(refresh);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
