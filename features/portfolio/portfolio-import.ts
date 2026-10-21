import { FIXED_INCOME_INDEXATIONS, RATE_CONVENTIONS, type FixedIncomeIndexationKey, type InstrumentTypeKey, type InvestmentClassKey, type RateConventionKey } from "./constants";
import type { MarketAssetImportInput, FixedIncomeImportInput } from "./actions";
import type { PortfolioDto } from "./types";

export function parsePortfolioImportRows(
  rows: Record<string, unknown>[],
  fixedIncomeFamilies: PortfolioDto["fixedIncomeFamilies"],
  catalog: PortfolioDto["catalog"],
): { marketRows: MarketAssetImportInput[]; fixedIncomeRows: FixedIncomeImportInput[] } {
  const read = (row: Record<string, unknown>, ...keys: string[]) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null && value !== "");
  const readInvestmentCost = (row: Record<string, unknown>) => {
    const amount = read(row, "valorInvestido", "Valor investido", "Custo", "Custo investido", "investedValue");
    const currency = read(row, "moedaInvestimento", "Moeda investimento", "Moeda do custo", "investedValueCurrency");
    if (amount === undefined && currency === undefined) return {};
    if (amount === undefined || currency === undefined) {
      throw new Error("Informe o valor investido e a moeda do investimento juntos, ou deixe ambos vazios.");
    }
    return { investedValue: Number(amount), investedValueCurrency: String(currency).trim().toUpperCase() };
  };
  const classAliases: Record<string, InvestmentClassKey> = {
    "ACOES NACIONAIS": "BRAZILIAN_STOCKS",
    "ACOES INTERNACIONAIS": "INTERNATIONAL_STOCKS",
    "FUNDOS IMOBILIARIOS": "REAL_ESTATE_FUNDS",
    REITS: "REITS",
    CRIPTOMOEDAS: "CRYPTO",
    "RENDA FIXA": "FIXED_INCOME",
    "RENDA FIXA INTERNACIONAL": "INTERNATIONAL_FIXED_INCOME",
    "RESERVA DE VALOR": "STORE_OF_VALUE",
  };
  const normalizeText = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  const normalizeClass = (value: unknown): InvestmentClassKey => {
    const normalized = normalizeText(value || "BRAZILIAN_STOCKS");
    return classAliases[normalized] ?? normalized as InvestmentClassKey;
  };
  const normalizeMarketRegion = (value: unknown): "BRAZIL" | "INTERNATIONAL" | null => {
    const normalized = normalizeText(value);
    if (["BRASIL", "BRAZIL", "BR", "NACIONAL"].includes(normalized))
      return "BRAZIL";
    if (["INTERNACIONAL", "INTERNATIONAL", "EXTERIOR"].includes(normalized))
      return "INTERNATIONAL";
    return null;
  };
  const normalizeIndexation = (value: unknown): FixedIncomeIndexationKey | null => {
    const normalized = normalizeText(value).replace(/[ -]/g, "_");
    const aliases: Record<string, FixedIncomeIndexationKey> = {
      PRE: "PRE_FIXED",
      PREFIXADO: "PRE_FIXED",
      PRE_FIXADO: "PRE_FIXED",
      POS: "POST_FIXED",
      POSFIXADO: "POST_FIXED",
      POS_FIXADO: "POST_FIXED",
      INFLACAO: "INFLATION",
      IPCA: "INFLATION",
      OUTRO: "OTHER",
      HIBRIDO: "OTHER",
      OUTRO_HIBRIDO: "OTHER",
    };
    return FIXED_INCOME_INDEXATIONS.includes(normalized as FixedIncomeIndexationKey) ? normalized as FixedIncomeIndexationKey : aliases[normalized] ?? null;
  };
  const parsed = rows.map((row) => ({
    row,
    investmentClass: normalizeClass(read(row, "classe", "Classe", "investmentClass")),
    instrumentType: read(row, "instrumento", "Instrumento", "instrumentType") ? normalizeText(read(row, "instrumento", "Instrumento", "instrumentType")) as InstrumentTypeKey : undefined,
  }));
  const fixedRows = parsed.filter(({ investmentClass, instrumentType }) => (investmentClass === "FIXED_INCOME" || investmentClass === "INTERNATIONAL_FIXED_INCOME") && instrumentType !== "ETF");
  const marketRows = parsed.filter(({ row }) => !fixedRows.some((fixed) => fixed.row === row));
  const normalizedFixed = fixedRows.map(({ row, investmentClass }) => {
    const familyInput = String(read(row, "familia", "Família", "familyCode") ?? "").trim();
    const family = fixedIncomeFamilies.find((item) => item.code === familyInput || normalizeText(item.name) === normalizeText(familyInput));
    const indexation = normalizeIndexation(read(row, "indexacao", "Indexação", "indexation"));
    const catalogInput = read(row, "catalogoId", "Catálogo ID", "catalogItemId", "tipoCatalogo", "Tipo do catálogo");
    const catalogItem = catalog.find((item) => item.id === Number(catalogInput) || normalizeText(item.name) === normalizeText(catalogInput));
    const issuer = String(read(row, "emissor", "Emissor", "issuer") ?? "").trim();
    const productName = String(read(row, "produto", "Produto", "productName", "nome", "Nome") ?? "").trim();
    const currentRaw = read(row, "valorAtual", "Valor atual", "currentValue", "valor", "Valor");
    if (!family || !indexation || issuer.length < 2 || productName.length < 2 || currentRaw === undefined) {
      throw new Error("Linhas de renda fixa exigem família, indexação, emissor, produto e valor atual. Agregados antigos não são aceitos.");
    }
    const customTypeName = String(read(row, "tipoPersonalizado", "Tipo personalizado", "customTypeName") ?? "").trim();
    if (!catalogItem && customTypeName.length < 2)
      throw new Error(`Informe um item do catálogo ou tipo personalizado para ${productName}.`);
    const convention = normalizeText(read(row, "formatoTaxa", "Formato da taxa", "rateConvention"));
    return {
      familyCode: family.code,
      indexation,
      investmentClass: investmentClass === "INTERNATIONAL_FIXED_INCOME" ? "INTERNATIONAL_FIXED_INCOME" as const : "FIXED_INCOME" as const,
      score: Number(read(row, "nota", "Nota", "score") ?? 0),
      holding: {
        id: String(read(row, "idAplicacao", "ID da aplicação", "holdingId", "id") ?? "").trim() || undefined,
        catalogItemId: catalogItem?.id ?? null,
        customTypeName: catalogItem ? null : customTypeName,
        issuer,
        productName,
        ...readInvestmentCost(row),
        currentValue: Number(currentRaw),
        rateConvention: RATE_CONVENTIONS.includes(convention as RateConventionKey) ? convention as RateConventionKey : null,
        benchmark: String(read(row, "indexador", "Indexador", "benchmark") ?? "") || null,
        rateValue: read(row, "taxa", "Taxa", "rateValue") == null ? null : Number(read(row, "taxa", "Taxa", "rateValue")),
        purchaseDate: String(read(row, "dataCompra", "Data da compra", "purchaseDate") ?? "") || null,
        maturityDate: String(read(row, "vencimento", "Vencimento", "maturityDate") ?? "") || null,
      },
    };
  });
  const normalizedMarket = marketRows.map(({ row, investmentClass, instrumentType }) => {
    const familyInput = String(read(row, "familia", "Família", "familyCode") ?? "").trim();
    const family = fixedIncomeFamilies.find((item) => item.code === familyInput || normalizeText(item.name) === normalizeText(familyInput));
    const currency = String(read(row, "moeda", "Moeda", "currency") ?? "BRL").trim().toUpperCase();
    const nativeCurrent = read(row, "valorAtualNativo", "Valor atual nativo", "nativeCurrentValue");
    const legacyCurrent = read(row, "valor", "Valor", "Valor atual", "manualValue");
    const importedFx = read(row, "cambioParaBrl", "Câmbio para BRL", "fxRateToBrl");
    const importedFxDate = read(row, "dataCambio", "Data do câmbio", "fxUpdatedAt");
    return {
      holdingId: String(read(row, "idAplicacao", "ID da aplicação", "holdingId") ?? "").trim() || undefined,
      ticker: String(read(row, "ticker", "Ticker", "ativo", "Ativo") ?? ""),
      name: String(read(row, "nome", "Nome", "name", "ticker", "Ativo") ?? ""),
      investmentClass,
      instrumentType,
      fixedIncomeFamilyCode: family?.code ?? null,
      indexation: normalizeIndexation(read(row, "indexacao", "Indexação", "indexation")),
      marketRegion: normalizeMarketRegion(read(row, "mercado", "Mercado", "marketRegion")),
      quantity: Number(read(row, "quantidade", "Quantidade", "quantity") ?? 0),
      unitPrice: Number(read(row, "preco", "Preço", "unitPrice") ?? 0),
      manualValue: nativeCurrent !== undefined ? Number(nativeCurrent) : legacyCurrent === undefined ? null : Number(legacyCurrent),
      // The legacy "Valor atual" export is consolidated BRL. It cannot be
      // reinterpreted as a foreign native amount without an explicit column.
      manualValueCurrency: nativeCurrent !== undefined || currency === "BRL" ? currency : undefined,
      ...(importedFx === undefined ? {} : { fxRateToBrl: Number(importedFx) }),
      ...(importedFxDate === undefined ? {} : { fxUpdatedAt: String(importedFxDate) }),
      ...readInvestmentCost(row),
      currency,
      fractional: [true, 1, "1", "true", "sim"].includes(read(row, "fracionado", "Fracionado", "fractional") as never),
      score: Number(read(row, "nota", "Nota", "score") ?? 0),
      yahooReitConfirmed: [true, 1, "1", "true", "sim", "yes"].includes(String(read(row, "confirmarReitYahoo", "Confirmar REIT Yahoo", "yahooReitConfirmed") ?? "")
        .trim()
        .toLowerCase() as never),
    };
  });
  return { marketRows: normalizedMarket, fixedIncomeRows: normalizedFixed };
}
