import { describe, expect, it } from "vitest";
import {
  financialModelingPrepLogoUrl,
  isGenericBrapiLogoUrl,
  usableBrapiLogoUrl,
} from "@/features/portfolio/market-logo";

describe("logos de mercado", () => {
  it("constrói o fallback da FMP diretamente a partir do ticker", () => {
    expect(financialModelingPrepLogoUrl(" ko ")).toBe(
      "https://financialmodelingprep.com/image-stock/KO.png",
    );
    expect(financialModelingPrepLogoUrl("PETR4.SA")).toBe(
      "https://financialmodelingprep.com/image-stock/PETR4.SA.png",
    );
  });

  it("rejeita tickers vazios ou com caracteres que alterariam o caminho", () => {
    expect(financialModelingPrepLogoUrl(null)).toBeNull();
    expect(financialModelingPrepLogoUrl("../KO")).toBeNull();
    expect(financialModelingPrepLogoUrl("KO?token=x")).toBeNull();
  });

  it("continua removendo apenas o placeholder genérico da brapi", () => {
    const placeholder = "https://icons.brapi.dev/icons/brapi.svg";
    const companyLogo = "https://icons.brapi.dev/icons/KO.svg";
    expect(isGenericBrapiLogoUrl(placeholder)).toBe(true);
    expect(usableBrapiLogoUrl(placeholder)).toBeNull();
    expect(usableBrapiLogoUrl(companyLogo)).toBe(companyLogo);
  });
});
