import { describe, expect, it } from "vitest";
import {
  financeTransactionQueryKey,
  initialFinanceTransactionQuery,
  validFinanceTransactionPage,
} from "@/features/finance/transaction-query";

describe("consulta canônica de transações", () => {
  it("representa no SSR os mesmos filtros iniciais usados no navegador", () => {
    const query = initialFinanceTransactionQuery(2026, 9);
    expect(query).toEqual({
      year: 2026, month: 9, page: 1, pageSize: 25, mode: "MONTH",
      internal: "no", sortKey: "date", sortDirection: "desc",
    });
    expect(financeTransactionQueryKey(query)).toBe(financeTransactionQueryKey({
      sortDirection: "desc", sortKey: "date", mode: "MONTH", pageSize: 25,
      page: 1, month: 9, year: 2026, search: "  ", internal: "no",
    }));
  });

  it("normaliza busca e ordem das propriedades sem perder zero ou filtros", () => {
    const query = initialFinanceTransactionQuery(2026, 9);
    const key = financeTransactionQueryKey({ ...query, search: "  Mercado  ", min: 0, ignored: "no", max: undefined });
    const params = new URLSearchParams(key);
    expect(params.get("search")).toBe("Mercado");
    expect(params.get("min")).toBe("0");
    expect(params.get("ignored")).toBe("no");
    expect(params.has("max")).toBe(false);
    expect(key).not.toBe(financeTransactionQueryKey({ ...query, internal: "yes" }));
  });
});

describe("página válida após exclusões", () => {
  it("volta da página 2 para a 1 quando o total cai de 26 para 25", () => {
    expect(validFinanceTransactionPage(2, 26, 25)).toBe(2);
    expect(validFinanceTransactionPage(2, 25, 25)).toBe(1);
  });

  it("mantém uma página vazia válida quando o último registro é removido", () => {
    expect(validFinanceTransactionPage(1, 0, 25)).toBe(1);
    expect(validFinanceTransactionPage(4, 0, 25)).toBe(1);
    expect(validFinanceTransactionPage(3, 51, 25)).toBe(3);
  });
});
