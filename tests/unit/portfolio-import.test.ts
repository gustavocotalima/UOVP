import { describe, expect, it } from "vitest";
import { parsePortfolioImportRows } from "@/features/portfolio/portfolio-import";
import { portfolioRows } from "@/features/portfolio/xlsx-export";
import type { AssetDto } from "@/features/portfolio/types";

const asset: AssetDto = {
  id: "manual-fund", investmentClass: "BRAZILIAN_STOCKS", instrumentType: "MUTUAL_FUND", ticker: "FUNDO", name: "Fundo manual",
  fixedIncomeFamilyCode: null, fixedIncomeFamilyName: null, fixedIncomeFamilyShortCode: null, indexation: null, marketRegion: null,
  logoUrl: null, currency: "BRL", quantity: "20", unitPrice: "100", nativeUnitPrice: "100", fxRateToBrl: null, fxUpdatedAt: null,
  manualValue: "2000", currentValue: "2000", nativeCurrentValue: "2000", nativeCurrency: "BRL",
  investedValue: "1000", investedValueCurrency: "BRL", averagePricePaid: "50", averagePriceCurrency: "BRL", averagePriceCoverage: 1,
  fractional: false, score: 3, priceUpdatedAt: null, updatedAt: "2026-10-21T12:00:00Z", holdings: [],
  providerControlled: false, needsScore: false, awaitingSyncContribution: null,
};

function records(assets: AssetDto[]) {
  const [headers, ...rows] = portfolioRows(assets);
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [String(header), row[index]])));
}

describe("contrato de importação/exportação da carteira", () => {
  it("exporta e reimporta o custo histórico, separado do valor atual", () => {
    const parsed = parsePortfolioImportRows(records([asset]), [], []);
    expect(parsed.marketRows[0]).toMatchObject({ investedValue: 1_000, investedValueCurrency: "BRL", manualValue: 2_000, quantity: 20 });
  });

  it("mantém custos nativos estrangeiros na mesma unidade", () => {
    const parsed = parsePortfolioImportRows(records([{ ...asset, currency: "USD", investedValue: "100", investedValueCurrency: "USD" }]), [], []);
    expect(parsed.marketRows[0]).toMatchObject({ investedValue: 100, investedValueCurrency: "USD" });
  });

  it("separa valor atual BRL, valor nativo e câmbio no roundtrip estrangeiro", () => {
    const foreign = {
      ...asset, currency: "USD", currentValue: "500", nativeCurrentValue: "100", nativeCurrency: "USD",
      fxRateToBrl: "5", fxUpdatedAt: "2026-10-01T00:00:00Z", investedValue: "80", investedValueCurrency: "USD",
    };
    const exported = records([foreign]);
    expect(exported[0]).toMatchObject({ "Valor atual": 500, "Valor atual nativo": 100, "Câmbio para BRL": "5" });
    const parsed = parsePortfolioImportRows(exported, [], []).marketRows[0];
    expect(parsed).toMatchObject({
      manualValue: 100, manualValueCurrency: "USD", currency: "USD", fxRateToBrl: 5,
      fxUpdatedAt: "2026-10-01T00:00:00Z", investedValue: 80, investedValueCurrency: "USD",
    });
  });

  it("não declara como nativo um valor estrangeiro da coluna consolidada antiga", () => {
    const parsed = parsePortfolioImportRows([
      { Ticker: "FUNDO", Nome: "Fundo manual", Instrumento: "MUTUAL_FUND", Moeda: "USD", "Valor atual": 500 },
    ], [], []).marketRows[0];
    expect(parsed.manualValue).toBe(500);
    expect(parsed.manualValueCurrency).toBeUndefined();
  });

  it.each([
    { ...asset, investedValue: null, investedValueCurrency: null },
    { ...asset, investedValue: "1000", investedValueCurrency: null },
  ])("exporta custo desconhecido ou ambíguo como par vazio e importa como omitido", (unknown) => {
    const parsed = parsePortfolioImportRows(records([unknown]), [], []);
    expect(parsed.marketRows[0]).not.toHaveProperty("investedValue");
    expect(parsed.marketRows[0]).not.toHaveProperty("investedValueCurrency");
  });

  it("não interpreta Valor antigo como custo de aquisição", () => {
    const parsed = parsePortfolioImportRows([{ Ticker: "FUNDO", Nome: "Fundo manual", Instrumento: "MUTUAL_FUND", Valor: 2_000 }], [], []);
    expect(parsed.marketRows[0].manualValue).toBe(2_000);
    expect(parsed.marketRows[0]).not.toHaveProperty("investedValue");
  });

  it("rejeita custo informado sem unidade na planilha", () => {
    expect(() => parsePortfolioImportRows([{ Ticker: "FUNDO", "Valor investido": 100 }], [], [])).toThrow("juntos");
  });
});
