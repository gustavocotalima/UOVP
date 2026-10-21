import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AssetDto, AssetHoldingDto } from "@/features/portfolio/types";
import { AssetsDesktop } from "@/features/portfolio/assets-panel/assets-desktop";
import { AssetsMobile } from "@/features/portfolio/assets-panel/assets-mobile";
import { HoldingHistoryDesktop, HoldingHistoryMobile } from "@/features/portfolio/assets-panel/holding-history";

vi.mock("@/features/portfolio/assets-panel/asset-logo", () => ({ AssetLogo: () => null }));

const holding: AssetHoldingDto = {
  id: "holding", catalogItemId: null, typeName: "CDB", customTypeName: "CDB", issuer: "Banco", institution: null,
  productName: "CDB civil", pricingSource: "MANUAL", positionSource: "MANUAL", ticker: null, providerSymbol: null,
  brapiAssetType: null, brapiSubType: null, marketExchange: null, marketQuoteType: null, marketSector: null, marketIndustry: null,
  currency: "BRL", quantity: "0", unitPrice: "0", unitPriceBrl: "0", fxRateToBrl: null, fxUpdatedAt: null,
  investedValue: null, investedValueCurrency: null, averagePricePaid: null, averagePriceCurrency: null, averagePriceCoverage: 0,
  currentValue: "100", nativeCurrentValue: "100", fractional: true, rateConvention: null, benchmark: null, rateValue: null,
  purchaseDate: "2026-01-01T00:00:00.000Z", maturityDate: "2027-03-01T00:00:00.000Z",
  logoUrl: null, priceUpdatedAt: null, providerCurrentValue: null, providerInvestmentSource: null, providerStatus: null,
  providerAvailable: true, transactionCount: 0, connectedMetadata: null, transactions: [], updatedAt: "2026-03-01T00:30:00Z",
};
const asset: AssetDto = {
  id: "asset", investmentClass: "FIXED_INCOME", instrumentType: "FIXED_INCOME", ticker: "CDB", name: "Depósito civil",
  fixedIncomeFamilyCode: null, fixedIncomeFamilyName: null, fixedIncomeFamilyShortCode: null, indexation: null, marketRegion: null,
  logoUrl: null, currency: "BRL", quantity: "100", unitPrice: "1", nativeUnitPrice: null, fxRateToBrl: null, fxUpdatedAt: null,
  manualValue: "100", currentValue: "100", nativeCurrentValue: "100", nativeCurrency: "BRL", averagePricePaid: null, averagePriceCoverage: 0,
  fractional: true, score: 5, priceUpdatedAt: "2026-03-01T00:30:00Z", updatedAt: "2026-03-01T00:30:00Z", holdings: [holding],
  providerControlled: false, needsScore: false, awaitingSyncContribution: null,
};

function controller(timeZone: string): ComponentProps<typeof AssetsDesktop>["controller"] {
  return {
    timeZone, valuesHidden: false, filtered: [asset], total: 100, expandedAssets: new Set([asset.id]),
    searchExpandedAssets: new Set(), pendingPriceByAsset: {}, holdingTransactions: {}, pending: false,
    setMetadataEditor: vi.fn(), setDeleteTarget: vi.fn(), setPendingPriceByAsset: vi.fn(), edit: vi.fn(), startHolding: vi.fn(),
    toggleExpanded: vi.fn(), editAccountInvestment: vi.fn(), excludeAccountHolding: vi.fn(), savePendingContributionPrice: vi.fn(),
    loadHoldingTransactions: async () => {},
  };
}

describe("datas civis nas duas apresentações da carteira", () => {
  it.each(["America/Sao_Paulo", "Pacific/Honolulu", "Asia/Tokyo", "Pacific/Kiritimati"])(
    "mantém compra/vencimento e converte somente atualização em %s", (timeZone) => {
      const desktop = renderToStaticMarkup(createElement(AssetsDesktop, { controller: controller(timeZone) }));
      const mobile = renderToStaticMarkup(createElement(AssetsMobile, { controller: controller(timeZone) }));
      for (const html of [desktop, mobile]) {
        expect(html).toContain("01/01/2026");
        expect(html).toContain("01/03/2027");
        expect(html).not.toContain("31/12/2025");
        expect(html).not.toContain("28/02/2027");
      }
      const expectedUpdate = ["America/Sao_Paulo", "Pacific/Honolulu"].includes(timeZone) ? "28/02/2026" : "01/03/2026";
      expect(mobile).toContain(`>${expectedUpdate}</dd>`);
      expect(desktop).toContain(`>${expectedUpdate}</span>`);
    },
  );
});

describe("moeda das movimentações de investimento", () => {
  it("exibe uma operação USD em holding cotada em BRL sem trocar sua unidade", () => {
    const props = {
      holding: {
        ...holding, currency: "BRL", transactionCount: 1, transactions: [{
          id: "buy", currencyCode: "USD", description: "Compra USD", type: "BUY", movementType: null,
          quantity: "2", value: "50", amount: "100", netAmount: null, agreedRate: null,
          date: "2026-01-01T00:00:00Z", tradeDate: null,
        }],
      },
      loadHoldingTransactions: async () => {},
    };
    for (const html of [
      renderToStaticMarkup(createElement(HoldingHistoryDesktop, props)),
      renderToStaticMarkup(createElement(HoldingHistoryMobile, props)),
    ]) {
      expect(html).toContain("US$");
      expect(html).toContain("100,00");
      expect(html).toContain("50,00");
      expect(html).not.toContain("R$");
      expect(html).toContain("01/01/2026");
    }
  });
});
