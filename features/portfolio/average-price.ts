import Decimal from "decimal.js";

type DecimalValue = Decimal.Value | null | undefined;

const PURCHASE_SUMMARY_VERSION = 1;
// Accumulate raw database-scale totals without rounding each BUY at the default
// 20 significant digits. Final prices still use the existing Decimal precision.
const PurchaseDecimal = Decimal.clone({ precision: 65 });

type PurchaseSummary = {
  version: number;
  quantity: DecimalValue;
  cost: DecimalValue;
};

export type AveragePriceTransaction = {
  type: string;
  quantity: DecimalValue;
  value: DecimalValue;
  amount: DecimalValue;
  netAmount: DecimalValue;
};

type HoldingAveragePriceInput = {
  positionSource: "MANUAL" | "PLUGGY" | "BINANCE" | "ACCOUNT_BALANCE";
  quantity: Decimal.Value;
  investedValue: DecimalValue;
  investedValueCurrency?: string | null;
  providerCurrency?: string | null;
  amountOriginal?: DecimalValue;
  purchaseSummary?: PurchaseSummary;
  transactions?: AveragePriceTransaction[];
};

type AveragePriceResult = {
  price: Decimal | null;
  coverage: number;
  currency: string | null;
};

function knownCurrency(value: string | null | undefined) {
  const currency = value?.trim().toUpperCase();
  return currency && /^[A-Z0-9]{3,8}$/.test(currency) ? currency : null;
}

function positive(value: DecimalValue) {
  if (value == null) return null;
  const decimal = new Decimal(value).abs();
  return decimal.isFinite() && decimal.gt(0) ? decimal : null;
}

function costFromUnitPrice(value: DecimalValue, quantity: Decimal) {
  const unitPrice = positive(value);
  return unitPrice ? new PurchaseDecimal(unitPrice).mul(quantity) : null;
}

/** Same raw BUY contribution as uovp_purchase_summary_entry in PostgreSQL. */
export function summarizePurchaseTransactions(transactions: AveragePriceTransaction[]): PurchaseSummary {
  let quantity = new PurchaseDecimal(0);
  let cost = new PurchaseDecimal(0);
  for (const transaction of transactions) {
    if (transaction.type.toUpperCase() !== "BUY") continue;
    const purchasedQuantity = positive(transaction.quantity);
    if (!purchasedQuantity) continue;
    const amount = positive(transaction.netAmount)
      ?? positive(transaction.amount)
      ?? costFromUnitPrice(transaction.value, purchasedQuantity);
    if (!amount) continue;
    quantity = quantity.add(purchasedQuantity);
    cost = cost.add(amount);
  }
  return { version: PURCHASE_SUMMARY_VERSION, quantity, cost };
}

export function calculateHoldingAveragePrice(input: HoldingAveragePriceInput): AveragePriceResult {
  const currentQuantity = positive(input.quantity);
  if (!currentQuantity) return { price: null, coverage: 0, currency: null };

  const originalAmount = positive(input.amountOriginal);
  if (originalAmount) {
    const currency = knownCurrency(input.providerCurrency);
    if (!currency) return { price: null, coverage: 0, currency: null };
    return {
      price: originalAmount.div(currentQuantity),
      coverage: 1,
      currency,
    };
  }

  if (input.positionSource !== "MANUAL") {
    const summary = input.purchaseSummary ?? summarizePurchaseTransactions(input.transactions ?? []);
    const currency = knownCurrency(input.providerCurrency);
    if (summary.version !== PURCHASE_SUMMARY_VERSION || !currency) return { price: null, coverage: 0, currency: null };
    const purchasedQuantity = positive(summary.quantity);
    const purchasedCost = positive(summary.cost);
    if (purchasedQuantity && purchasedCost) {
      return {
        price: purchasedCost.div(purchasedQuantity),
        coverage: Decimal.min(1, purchasedQuantity.div(currentQuantity)).toNumber(),
        currency,
      };
    }
    return { price: null, coverage: 0, currency: null };
  }

  const investedValue = positive(input.investedValue);
  const currency = knownCurrency(input.investedValueCurrency);
  return investedValue && currency
    ? { price: investedValue.div(currentQuantity), coverage: 1, currency }
    : { price: null, coverage: 0, currency: null };
}

export function aggregateAveragePrices(
  positions: Array<AveragePriceResult & { quantity: Decimal.Value }>,
): AveragePriceResult {
  let totalQuantity = new Decimal(0);
  let pricedQuantity = new Decimal(0);
  let pricedCost = new Decimal(0);
  let coveredQuantity = new Decimal(0);
  let currency: string | null = null;

  for (const position of positions) {
    const quantity = positive(position.quantity);
    if (!quantity) continue;
    totalQuantity = totalQuantity.add(quantity);
    if (!position.price) continue;
    const positionCurrency = knownCurrency(position.currency);
    if (!positionCurrency || (currency && currency !== positionCurrency)) {
      return { price: null, coverage: 0, currency: null };
    }
    currency = positionCurrency;
    pricedQuantity = pricedQuantity.add(quantity);
    pricedCost = pricedCost.add(position.price.mul(quantity));
    coveredQuantity = coveredQuantity.add(quantity.mul(position.coverage));
  }

  if (pricedQuantity.eq(0) || pricedCost.eq(0)) return { price: null, coverage: 0, currency: null };
  return {
    price: pricedCost.div(pricedQuantity),
    coverage: totalQuantity.gt(0)
      ? Decimal.min(1, coveredQuantity.div(totalQuantity)).toNumber()
      : 0,
    currency,
  };
}

/** A consolidated cost is only meaningful when every component has the same known unit. */
export function aggregateInvestedValues(
  positions: Array<{ value: DecimalValue; currency?: string | null }>,
): { value: Decimal | null; currency: string | null } {
  let total = new Decimal(0);
  let currency: string | null = null;
  if (!positions.length) return { value: null, currency: null };
  for (const position of positions) {
    const positionCurrency = knownCurrency(position.currency);
    if (position.value == null || !positionCurrency || (currency && currency !== positionCurrency)) {
      return { value: null, currency: null };
    }
    const value = new Decimal(position.value);
    if (!value.isFinite() || value.lt(0)) return { value: null, currency: null };
    total = total.add(value);
    currency = positionCurrency;
  }
  return { value: total, currency };
}
