import { describe, expect, it } from "vitest";
import {
  getTransactionPageView,
  transactionLastPage,
  type TransactionPageQuery,
  type TransactionPageResult,
} from "@/features/open-finance/transaction-page-state";

const query: TransactionPageQuery = { page: 1, snapshotRevision: "snapshot-a", attempt: 1 };
const ready: TransactionPageResult<string> = {
  query, status: "ready", transactions: ["lançamento da página 1"], total: 26, error: null,
};

describe("apresentação paginada de transações Open Finance", () => {
  it("exibe somente linhas da página solicitada, mantendo o total conhecido durante a carga", () => {
    expect(getTransactionPageView(ready, query)).toEqual({
      total: 26, transactions: ready.transactions, loading: false, error: null,
    });
    expect(getTransactionPageView(ready, { ...query, page: 2 })).toEqual({
      total: 26, transactions: [], loading: true, error: null,
    });
  });

  it("erro na página 2 não apresenta linhas da página 1 nem um resultado vazio bem-sucedido", () => {
    const pageTwo = { ...query, page: 2 };
    const failed: TransactionPageResult<string> = {
      query: pageTwo, status: "error", total: 26, transactions: [], error: "Falha temporária",
    };
    expect(getTransactionPageView(failed, pageTwo)).toEqual({
      total: 26, transactions: [], loading: false, error: "Falha temporária",
    });
    expect(getTransactionPageView(failed, { ...pageTwo, attempt: 2 })).toEqual({
      total: 26, transactions: [], loading: true, error: null,
    });
  });

  it("oculta respostas e erros de outro snapshot, inclusive na mesma página", () => {
    const refreshed = { ...query, snapshotRevision: "snapshot-b" };
    for (const result of [ready, { ...ready, status: "error" as const, error: "Erro antigo" }]) {
      expect(getTransactionPageView(result, refreshed)).toEqual({
        total: null, transactions: [], loading: true, error: null,
      });
    }
  });

  it("não reutiliza uma resposta de antes da navegação de ida e volta para a aba", () => {
    expect(getTransactionPageView(ready, { ...query, attempt: 3 })).toEqual({
      total: 26, transactions: [], loading: true, error: null,
    });
  });

  it("mantém estado de carga durante a correção para a última página após remoções", () => {
    const corrected: TransactionPageResult<string> = {
      query: { ...query, page: 2 }, status: "correcting", total: 25, transactions: [], error: null,
    };
    expect(getTransactionPageView(corrected, corrected.query).loading).toBe(true);
    expect(getTransactionPageView(corrected, query)).toEqual({
      total: 25, transactions: [], loading: true, error: null,
    });
    expect(transactionLastPage(25, 25)).toBe(1);
    expect(transactionLastPage(26, 25)).toBe(2);
    expect(transactionLastPage(0, 25)).toBe(1);
  });

  it("não trata a primeira consulta pendente como ausência de transações", () => {
    expect(getTransactionPageView(null, query)).toEqual({
      total: null, transactions: [], loading: true, error: null,
    });
  });
});
