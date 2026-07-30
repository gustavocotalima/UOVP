import { describe, expect, it } from "vitest";
import { sortContributionSuggestions } from "@/features/portfolio/contribution-order";

describe("ordenação das sugestões de aporte", () => {
  it("agrupa pela classe da carteira e ordena tickers dentro da classe", () => {
    const suggestions = sortContributionSuggestions([
      { investmentClass: "REAL_ESTATE_FUNDS" as const, ticker: "HGLG11" },
      { investmentClass: "BRAZILIAN_STOCKS" as const, ticker: "EMBJ3" },
      { investmentClass: "REAL_ESTATE_FUNDS" as const, ticker: "BRCR11" },
      { investmentClass: "BRAZILIAN_STOCKS" as const, ticker: "BBAS3" },
    ]);

    expect(suggestions.map((suggestion) => suggestion.ticker)).toEqual([
      "BBAS3",
      "EMBJ3",
      "BRCR11",
      "HGLG11",
    ]);
  });

  it("não altera o array recebido", () => {
    const suggestions = [
      { investmentClass: "CRYPTO" as const, ticker: "ETH" },
      { investmentClass: "CRYPTO" as const, ticker: "BTC" },
    ];

    sortContributionSuggestions(suggestions);

    expect(suggestions.map((suggestion) => suggestion.ticker)).toEqual(["ETH", "BTC"]);
  });

  it("posiciona reserva de valor abaixo de renda fixa", () => {
    const suggestions = sortContributionSuggestions([
      { investmentClass: "INTERNATIONAL_FIXED_INCOME" as const, ticker: "BND" },
      { investmentClass: "STORE_OF_VALUE" as const, ticker: "GOLD11" },
      { investmentClass: "FIXED_INCOME" as const, ticker: "CDB-PRE" },
    ]);

    expect(suggestions.map((suggestion) => suggestion.ticker)).toEqual([
      "CDB-PRE",
      "GOLD11",
      "BND",
    ]);
  });
});
