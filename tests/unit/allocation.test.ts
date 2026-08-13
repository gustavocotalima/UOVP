import { describe, expect, it } from "vitest";
import {
  allocateContribution,
  questionChangeAffectsAllocation,
} from "@/features/portfolio/allocation";
import { DEFAULT_TARGETS } from "@/features/portfolio/constants";

describe("alocação de aportes", () => {
  it("não invalida notas por edição textual da pergunta", () => {
    expect(questionChangeAffectsAllocation(true, {})).toBe(false);
    expect(questionChangeAffectsAllocation(true, { active: true })).toBe(false);
    expect(questionChangeAffectsAllocation(true, { active: false })).toBe(true);
  });

  it("ignora classes acima da meta e ativos com nota zero", () => {
    const result = allocateContribution({
      contribution: 1000,
      targets: DEFAULT_TARGETS,
      assets: [
        { id: "fixed", ticker: "RF", name: "Renda fixa", investmentClass: "FIXED_INCOME", currentValue: 9000, quantity: 9000, unitPrice: 1, score: 10, fractional: true },
        { id: "stock", ticker: "ACAO3", name: "Ação", investmentClass: "BRAZILIAN_STOCKS", currentValue: 1000, quantity: 10, unitPrice: 100, score: 10, fractional: false },
        { id: "zero", ticker: "ZERO3", name: "Sem nota", investmentClass: "BRAZILIAN_STOCKS", currentValue: 0, quantity: 0, unitPrice: 10, score: 0, fractional: false },
      ],
    });
    expect(result.suggestions.some((item) => item.assetId === "fixed")).toBe(false);
    expect(result.suggestions.some((item) => item.assetId === "zero")).toBe(false);
    expect(result.suggestions.find((item) => item.assetId === "stock")?.quantity.isInteger()).toBe(true);
  });

  it("preserva precisão em ativos fracionários", () => {
    const result = allocateContribution({
      contribution: 100,
      targets: { ...DEFAULT_TARGETS, INTERNATIONAL_STOCKS: 0, BRAZILIAN_STOCKS: 0, REAL_ESTATE_FUNDS: 0, REITS: 0, CRYPTO: 100, FIXED_INCOME: 0, INTERNATIONAL_FIXED_INCOME: 0, STORE_OF_VALUE: 0 },
      assets: [{ id: "btc", ticker: "BTC", name: "Bitcoin", investmentClass: "CRYPTO", currentValue: 0, quantity: 0, unitPrice: 300000, score: 10, fractional: true }],
    });
    expect(result.suggestions[0].value.toNumber()).toBe(100);
    expect(result.suggestions[0].quantity.toNumber()).toBeCloseTo(1 / 3000, 12);
  });

  it("considera a carteira inteira nas metas, mas deixa saldo não alocado quando o escopo restringe os recebedores", () => {
    const result = allocateContribution({
      contribution: 1000,
      preserveTargetGapsWithoutEligibleAssets: true,
      targets: {
        ...DEFAULT_TARGETS,
        INTERNATIONAL_STOCKS: 50,
        BRAZILIAN_STOCKS: 50,
        REAL_ESTATE_FUNDS: 0,
        REITS: 0,
        CRYPTO: 0,
        FIXED_INCOME: 0,
        INTERNATIONAL_FIXED_INCOME: 0,
        STORE_OF_VALUE: 0,
      },
      assets: [
        { id: "usd", ticker: "KO", name: "Coca-Cola", investmentClass: "INTERNATIONAL_STOCKS", currentValue: 0, quantity: 0, unitPrice: 100, score: 10, fractional: true, eligibleToReceive: true },
        { id: "brl", ticker: "ITUB3", name: "Itaú", investmentClass: "BRAZILIAN_STOCKS", currentValue: 0, quantity: 0, unitPrice: 50, score: 10, fractional: false, eligibleToReceive: false },
      ],
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].assetId).toBe("usd");
    expect(result.suggestions[0].value.toNumber()).toBe(500);
    expect(result.unallocatedAmount.toNumber()).toBe(500);
  });

  it("redistribui todo o aporte entre os ativos BRL elegíveis quando ativos USD são excluídos", () => {
    const result = allocateContribution({
      contribution: 1500,
      preserveTargetGapsWithoutEligibleAssets: false,
      capEligibleClassesAtTarget: true,
      targets: {
        ...DEFAULT_TARGETS,
        INTERNATIONAL_STOCKS: 50,
        BRAZILIAN_STOCKS: 50,
        REAL_ESTATE_FUNDS: 0,
        REITS: 0,
        CRYPTO: 0,
        FIXED_INCOME: 0,
        INTERNATIONAL_FIXED_INCOME: 0,
        STORE_OF_VALUE: 0,
      },
      assets: [
        { id: "usd", ticker: "KO", name: "Coca-Cola", investmentClass: "INTERNATIONAL_STOCKS", currentValue: 10000, quantity: 100, unitPrice: 100, score: 10, fractional: true, eligibleToReceive: false },
        { id: "brl", ticker: "ITUB3", name: "Itaú", investmentClass: "BRAZILIAN_STOCKS", currentValue: 0, quantity: 0, unitPrice: 1, score: 10, fractional: true, eligibleToReceive: true },
      ],
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].assetId).toBe("brl");
    expect(result.suggestions[0].value.toNumber()).toBe(1500);
    expect(result.unallocatedAmount.toNumber()).toBe(0);
  });

  it("não ultrapassa a meta das classes elegíveis ao filtrar por moeda", () => {
    const result = allocateContribution({
      contribution: 1000,
      preserveTargetGapsWithoutEligibleAssets: false,
      capEligibleClassesAtTarget: true,
      targets: {
        ...DEFAULT_TARGETS,
        INTERNATIONAL_STOCKS: 15,
        BRAZILIAN_STOCKS: 85,
        REAL_ESTATE_FUNDS: 0,
        REITS: 0,
        CRYPTO: 0,
        FIXED_INCOME: 0,
        INTERNATIONAL_FIXED_INCOME: 0,
        STORE_OF_VALUE: 0,
      },
      assets: [
        { id: "usd", ticker: "KO", name: "Coca-Cola", investmentClass: "INTERNATIONAL_STOCKS", currentValue: 1000, quantity: 10, unitPrice: 1, score: 10, fractional: true, eligibleToReceive: true },
        { id: "brl", ticker: "ITUB3", name: "Itaú", investmentClass: "BRAZILIAN_STOCKS", currentValue: 8000, quantity: 80, unitPrice: 1, score: 10, fractional: true, eligibleToReceive: false },
      ],
    });

    // O máximo resolve (1.000 + x) / (9.000 + x) = 15%.
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].assetId).toBe("usd");
    expect(result.suggestions[0].value.toNumber()).toBeCloseTo(411.7647058823, 8);
    expect(result.suggestions[0].totalAfterSuggestionPercentage.toNumber()).toBeCloseTo(15, 8);
    expect(result.unallocatedAmount.toNumber()).toBeCloseTo(588.2352941177, 8);
  });

  it("investe todo o aporte USD quando a classe elegível continua abaixo da meta", () => {
    const result = allocateContribution({
      contribution: 1000,
      preserveTargetGapsWithoutEligibleAssets: false,
      capEligibleClassesAtTarget: true,
      targets: {
        ...DEFAULT_TARGETS,
        INTERNATIONAL_STOCKS: 15,
        BRAZILIAN_STOCKS: 85,
        REAL_ESTATE_FUNDS: 0,
        REITS: 0,
        CRYPTO: 0,
        FIXED_INCOME: 0,
        INTERNATIONAL_FIXED_INCOME: 0,
        STORE_OF_VALUE: 0,
      },
      assets: [
        { id: "usd", ticker: "KO", name: "Coca-Cola", investmentClass: "INTERNATIONAL_STOCKS", currentValue: 0, quantity: 0, unitPrice: 1, score: 10, fractional: true, eligibleToReceive: true },
        { id: "brl", ticker: "ITUB3", name: "Itaú", investmentClass: "BRAZILIAN_STOCKS", currentValue: 9000, quantity: 90, unitPrice: 1, score: 10, fractional: true, eligibleToReceive: false },
      ],
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].value.toNumber()).toBe(1000);
    expect(result.suggestions[0].totalAfterSuggestionPercentage.toNumber()).toBe(10);
    expect(result.unallocatedAmount.toNumber()).toBe(0);
  });

  it("distribui um aporte multiclasse respeitando notas e arredondamento", () => {
    const result = allocateContribution({
      contribution: 1000,
      targets: {
        INTERNATIONAL_STOCKS: 0,
        BRAZILIAN_STOCKS: 40,
        REAL_ESTATE_FUNDS: 30,
        REITS: 0,
        CRYPTO: 10,
        FIXED_INCOME: 20,
        INTERNATIONAL_FIXED_INCOME: 0,
        STORE_OF_VALUE: 0,
      },
      assets: [
        { id: "alpha", ticker: "ALFA3", name: "Empresa Alfa", investmentClass: "BRAZILIAN_STOCKS", currentValue: 1000, quantity: 20, unitPrice: 50, score: 8, fractional: false },
        { id: "beta", ticker: "BETA4", name: "Empresa Beta", investmentClass: "BRAZILIAN_STOCKS", currentValue: 500, quantity: 20, unitPrice: 25, score: 4, fractional: false },
        { id: "fund", ticker: "FUNDO11", name: "Fundo sintético", investmentClass: "REAL_ESTATE_FUNDS", currentValue: 1000, quantity: 10, unitPrice: 100, score: 6, fractional: false },
        { id: "coin", ticker: "COIN", name: "Cripto sintética", investmentClass: "CRYPTO", currentValue: 500, quantity: 5, unitPrice: 100, score: 5, fractional: true },
        { id: "zero", ticker: "ZERO", name: "Ativo sem nota", investmentClass: "CRYPTO", currentValue: 0, quantity: 0, unitPrice: 10, score: 0, fractional: true },
        { id: "fixed", ticker: "RF-SINTETICA", name: "Renda fixa sintética", investmentClass: "FIXED_INCOME", currentValue: 6000, quantity: 6000, unitPrice: 1, score: 10, fractional: true },
      ],
    });
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.every((item) => item.assetId !== "fixed" && item.assetId !== "zero")).toBe(true);
    expect(result.suggestions.filter((item) => item.ticker !== "COIN").every((item) => item.quantity.isInteger())).toBe(true);
    const allocated = result.suggestions.reduce((total, item) => total + item.value.toNumber(), 0);
    expect(allocated).toBeLessThanOrEqual(1000);
    expect(allocated + result.unallocatedAmount.toNumber()).toBeCloseTo(1000, 8);
  });
});
