"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetDto, AssetHoldingDto } from "./types";

export type HoldingTransactionsState = {
  transactions: AssetHoldingDto["transactions"];
  page: number;
  total: number;
  averagePricePaid: string | null;
  averagePriceCoverage: number;
  loading: boolean;
  error?: string;
};

type Page = Omit<HoldingTransactionsState, "loading"> & { error?: string };

/** The cache lives with the panel, so responsive views share requests and results. */
export function useHoldingTransactions(assets: AssetDto[], expanded: ReadonlySet<string>, snapshotRevision: string) {
  const [states, setStates] = useState<Record<string, HoldingTransactionsState>>({});
  const cache = useRef<Record<string, HoldingTransactionsState>>({});
  const requests = useRef(new Map<string, AbortController>());
  const revision = useRef(snapshotRevision);
  const generation = useRef(0);

  const load = useCallback(async (id: string, page = 1, append = false) => {
    if (requests.current.has(id)) return;
    const controller = new AbortController();
    const requestGeneration = generation.current;
    requests.current.set(id, controller);
    const previous = cache.current[id];
    const update = (value: HoldingTransactionsState) => {
      cache.current = { ...cache.current, [id]: value };
      setStates(cache.current);
    };
    update({
      transactions: append ? previous?.transactions ?? [] : [],
      page: append ? previous?.page ?? 0 : 0,
      total: previous?.total ?? 0,
      averagePricePaid: previous?.averagePricePaid ?? null,
      averagePriceCoverage: previous?.averagePriceCoverage ?? 0,
      loading: true,
    });
    try {
      const response = await fetch(`/api/portfolio/holdings/${encodeURIComponent(id)}/transactions?page=${page}&pageSize=25`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = await response.json() as Page;
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as movimentações.");
      if (controller.signal.aborted || requestGeneration !== generation.current) return;
      const rows = append ? [...(previous?.transactions ?? []), ...payload.transactions] : payload.transactions;
      update({ ...payload, transactions: [...new Map(rows.map((row) => [row.id, row])).values()], loading: false });
    } catch (error) {
      if (controller.signal.aborted || requestGeneration !== generation.current) return;
      update({ ...cache.current[id], loading: false, error: error instanceof Error ? error.message : "Não foi possível carregar as movimentações." });
    } finally {
      if (requests.current.get(id) === controller) requests.current.delete(id);
    }
  }, []);

  useEffect(() => {
    if (revision.current !== snapshotRevision) {
      revision.current = snapshotRevision;
      generation.current += 1;
      requests.current.forEach((controller) => controller.abort());
      requests.current.clear();
      cache.current = {};
      setStates({});
    }
    for (const asset of assets) {
      if (!expanded.has(asset.id)) continue;
      for (const holding of asset.holdings) {
        if (holding.transactionCount > 0 && !cache.current[holding.id]) void load(holding.id);
      }
    }
  }, [assets, expanded, snapshotRevision, load]);

  useEffect(() => () => {
    generation.current += 1;
    requests.current.forEach((controller) => controller.abort());
    requests.current.clear();
  }, []);

  return { holdingTransactions: states, loadHoldingTransactions: load };
}
