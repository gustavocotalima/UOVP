import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { selectLatestPluggyMarketQuote } from "@/features/open-finance/market-quote";

function quote(price: number, date: string | null, pricingSource = "BRAPI") {
  return {
    pricingSource,
    unitPrice: new Prisma.Decimal(price),
    priceUpdatedAt: date ? new Date(date) : null,
  };
}

describe("preservação de cotações na reconciliação Pluggy", () => {
  it("não substitui a cotação atual por uma holding manual antiga", () => {
    const current = quote(20, "2026-10-02T12:00:00Z");
    const oldManual = quote(10, "2026-09-01T12:00:00Z");
    expect(selectLatestPluggyMarketQuote([current, oldManual])).toBe(current);
  });

  it("reutiliza uma cotação manual mais recente", () => {
    const current = quote(10, "2026-09-01T12:00:00Z");
    const newerManual = quote(20, "2026-10-02T12:00:00Z", "YAHOO");
    expect(selectLatestPluggyMarketQuote([current, newerManual])).toBe(newerManual);
  });

  it("não trata a data do snapshot Pluggy como uma cotação de mercado", () => {
    const provider = quote(10, "2026-10-02T12:00:00Z", "PLUGGY");
    expect(selectLatestPluggyMarketQuote([provider])).toBeNull();
  });

  it("mantém o candidato atual quando as datas são iguais", () => {
    const current = quote(20, "2026-10-02T12:00:00Z");
    const manual = quote(10, "2026-10-02T12:00:00Z");
    expect(selectLatestPluggyMarketQuote([current, manual])).toBe(current);
  });

  it("ignora preços nulos, negativos ou não finitos", () => {
    const valid = quote(20, "2026-10-01T12:00:00Z");
    expect(selectLatestPluggyMarketQuote([
      null,
      undefined,
      quote(0, "2026-10-02T12:00:00Z"),
      quote(-1, "2026-10-02T12:00:00Z"),
      quote(Infinity, "2026-10-02T12:00:00Z"),
      valid,
    ])).toBe(valid);
  });

  it("prioriza datas válidas e preserva a ausência de data para a verificação de frescor", () => {
    const unknown = quote(10, null);
    const invalid = quote(11, "inválido");
    const dated = quote(20, "2026-10-01T12:00:00Z");
    expect(selectLatestPluggyMarketQuote([unknown, invalid, dated])).toBe(dated);
    expect(selectLatestPluggyMarketQuote([unknown])?.priceUpdatedAt).toBeNull();
  });
});
