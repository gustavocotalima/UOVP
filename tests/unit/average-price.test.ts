import { describe, expect, it } from "vitest";
import { aggregateAveragePrices, calculateHoldingAveragePrice } from "@/features/portfolio/average-price";

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
});
