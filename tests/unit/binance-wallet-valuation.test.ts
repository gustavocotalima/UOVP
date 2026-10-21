import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { binanceHoldingValuationChanged } from "@/features/portfolio/binance-wallet-valuation";

const previous = {
  quantity: new Prisma.Decimal(2), unitPrice: new Prisma.Decimal(100), fxRateToBrl: new Prisma.Decimal(5),
  currentValue: null, providerCurrentValue: null, currency: "USDT", pricingSource: "BINANCE", marketQuoteType: "SPOT", includedInTotals: true,
};

describe("alterações patrimoniais do snapshot Binance", () => {
  it("não trata a formatação de decimais como mudança", () => {
    expect(binanceHoldingValuationChanged(previous, { ...previous, unitPrice: new Prisma.Decimal("100.000") })).toBe(false);
  });

  it.each([
    { quantity: new Prisma.Decimal(3) },
    { unitPrice: new Prisma.Decimal(110) },
    { fxRateToBrl: new Prisma.Decimal(6) },
    { currency: "BRL" },
    { pricingSource: "MANUAL" },
    { marketQuoteType: "BTC_VALUATION" },
    { includedInTotals: false },
    { currentValue: new Prisma.Decimal(900) },
  ])("detecta os campos usados para avaliar a posição: %j", (change) => {
    expect(binanceHoldingValuationChanged(previous, { ...previous, ...change })).toBe(true);
  });

  it("não invalida o patrimônio por preços de posições excluídas", () => {
    expect(binanceHoldingValuationChanged({ ...previous, includedInTotals: false }, { ...previous, includedInTotals: false, unitPrice: new Prisma.Decimal(110) })).toBe(false);
  });
});
