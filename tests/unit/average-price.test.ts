import { describe, expect, it } from "vitest";
import { aggregateAveragePrices, calculateHoldingAveragePrice, summarizePurchaseTransactions } from "@/features/portfolio/average-price";

describe("preço médio", () => {
  it("calcula a média ponderada das compras Pluggy", () => {
    const result = calculateHoldingAveragePrice({
      positionSource: "PLUGGY",
      quantity: 90,
      investedValue: null,
      transactions: [
        { type: "BUY", quantity: 40, value: 27.32, amount: 1092.8, netAmount: null },
        { type: "BUY", quantity: 50, value: 23.78, amount: 1189, netAmount: null },
      ],
    });

    expect(result.price?.toDecimalPlaces(4).toNumber()).toBe(25.3533);
    expect(result.coverage).toBe(1);
  });

  it("indica quando o histórico cobre apenas parte da posição", () => {
    const result = calculateHoldingAveragePrice({
      positionSource: "PLUGGY",
      quantity: 125,
      investedValue: null,
      transactions: [
        { type: "BUY", quantity: 100, value: 24.98, amount: 2498, netAmount: null },
      ],
    });

    expect(result.price?.toNumber()).toBe(24.98);
    expect(result.coverage).toBe(0.8);
  });

  it("calcula o preço médio quando as compras superam a quantidade atual", () => {
    const result = calculateHoldingAveragePrice({
      positionSource: "PLUGGY",
      quantity: 12,
      investedValue: null,
      transactions: [
        { type: "BUY", quantity: 2, value: 122.56, amount: 245.12, netAmount: null },
        { type: "BUY", quantity: 2, value: 123.46, amount: 246.92, netAmount: null },
        { type: "BUY", quantity: 10, value: 128.52, amount: 1285.2, netAmount: null },
      ],
    });

    expect(result.price?.toDecimalPlaces(4).toNumber()).toBe(126.9457);
    expect(result.coverage).toBe(1);
  });

  it("usa o valor investido para posições manuais", () => {
    const result = calculateHoldingAveragePrice({
      positionSource: "MANUAL",
      quantity: 10,
      investedValue: 1000,
    });

    expect(result.price?.toNumber()).toBe(100);
    expect(result.coverage).toBe(1);
  });

  it("agrega posições da mesma empresa por quantidade", () => {
    const result = aggregateAveragePrices([
      { quantity: 10, price: calculateHoldingAveragePrice({ positionSource: "MANUAL", quantity: 10, investedValue: 1000 }).price, coverage: 1 },
      { quantity: 30, price: calculateHoldingAveragePrice({ positionSource: "MANUAL", quantity: 30, investedValue: 3600 }).price, coverage: 1 },
    ]);

    expect(result.price?.toNumber()).toBe(115);
    expect(result.coverage).toBe(1);
  });

  it("usa os totais brutos sem percorrer movimentos e respeita a quantidade efetiva", () => {
    const transactions = new Proxy([], { get() { throw new Error("O histórico não deveria ser lido."); } });
    const result = calculateHoldingAveragePrice({
      positionSource: "PLUGGY", quantity: 125, investedValue: null, transactions,
      purchaseSummary: { version: 1, quantity: 100, cost: 2498 },
    });
    expect(result.price?.toString()).toBe("24.98");
    expect(result.coverage).toBe(0.8);
  });

  it("mantém os atalhos de quantidade zero e valor original antes do resumo ou histórico", () => {
    const purchaseSummary = { version: 1, get quantity(): number { throw new Error("Resumo lido."); }, cost: 1 };
    expect(calculateHoldingAveragePrice({
      positionSource: "PLUGGY", quantity: 0, investedValue: null, amountOriginal: 100,
      purchaseSummary,
    })).toEqual({ price: null, coverage: 0 });
    const result = calculateHoldingAveragePrice({
      positionSource: "PLUGGY", quantity: 10, investedValue: null, amountOriginal: 850,
      purchaseSummary,
    });
    expect(result.price?.toString()).toBe("85");
    expect(result.coverage).toBe(1);
  });

  it("não apresenta preços de uma versão desconhecida do resumo", () => {
    expect(calculateHoldingAveragePrice({
      positionSource: "PLUGGY", quantity: 10, investedValue: null,
      purchaseSummary: { version: 2, quantity: 10, cost: 500 },
    })).toEqual({ price: null, coverage: 0 });
  });

  it("ignora valores não finitos e preserva a precedência e o sinal absoluto das compras", () => {
    const summary = summarizePurchaseTransactions([
      { type: "buy", quantity: -2, value: 90, amount: -50, netAmount: -48 },
      { type: "BUY", quantity: 3, value: -10, amount: 0, netAmount: "NaN" },
      { type: "BUY", quantity: 1, value: 99, amount: 8, netAmount: "Infinity" },
      { type: "BUY", quantity: "NaN", value: 100, amount: 100, netAmount: null },
      { type: "BUY", quantity: 10, value: "Infinity", amount: null, netAmount: null },
      { type: "SELL", quantity: 999, value: 100, amount: 99900, netAmount: null },
    ]);
    expect(summary.quantity?.toString()).toBe("6");
    expect(summary.cost?.toString()).toBe("86");
    expect(summary.version).toBe(1);
  });

  it("acumula totais brutos com a precisão do banco antes de calcular o preço", () => {
    const purchase = {
      type: "BUY", quantity: "1000000000.0000000001", value: "1234567890.123456789",
      amount: null, netAmount: null,
    };
    const summary = summarizePurchaseTransactions([purchase, purchase]);
    expect(summary.quantity?.toString()).toBe("2000000000.0000000002");
    expect(summary.cost?.toString()).toBe("2469135780246913578.2469135780246913578");
  });
});
