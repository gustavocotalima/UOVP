import Decimal from "decimal.js";

type DecimalValue = Decimal.Value | null | undefined;

export type AveragePriceTransaction = {
  type: string;
  quantity: DecimalValue;
  value: DecimalValue;
  amount: DecimalValue;
  netAmount: DecimalValue;
};

export type HoldingAveragePriceInput = {
  positionSource: "MANUAL" | "PLUGGY";
  quantity: Decimal.Value;
  investedValue: DecimalValue;
  amountOriginal?: DecimalValue;
  transactions?: AveragePriceTransaction[];
};

export type AveragePriceResult = {
  price: Decimal | null;
  coverage: number;
};

function positive(value: DecimalValue) {
  if (value == null) return null;
  const decimal = new Decimal(value).abs();
  return decimal.gt(0) ? decimal : null;
}

export function calculateHoldingAveragePrice(input: HoldingAveragePriceInput): AveragePriceResult {
  const currentQuantity = positive(input.quantity);
  if (!currentQuantity) return { price: null, coverage: 0 };

  const originalAmount = positive(input.amountOriginal);
  if (originalAmount) {
    return {
      price: originalAmount.div(currentQuantity),
      coverage: 1,
    };
  }

  if (input.positionSource === "PLUGGY") {
    let purchasedQuantity = new Decimal(0);
    let purchasedCost = new Decimal(0);
    for (const transaction of input.transactions ?? []) {
      if (transaction.type.toUpperCase() !== "BUY") continue;
      const quantity = positive(transaction.quantity);
      if (!quantity) continue;
      const amount = positive(transaction.netAmount)
        ?? positive(transaction.amount)
        ?? (positive(transaction.value)?.mul(quantity) ?? null);
      if (!amount) continue;
      purchasedQuantity = purchasedQuantity.add(quantity);
      purchasedCost = purchasedCost.add(amount);
    }
    if (purchasedQuantity.gt(0) && purchasedCost.gt(0)) {
      return {
        price: purchasedCost.div(purchasedQuantity),
        coverage: Decimal.min(1, purchasedQuantity.div(currentQuantity)).toNumber(),
      };
    }
    return { price: null, coverage: 0 };
  }

  const investedValue = positive(input.investedValue);
  return investedValue
    ? { price: investedValue.div(currentQuantity), coverage: 1 }
    : { price: null, coverage: 0 };
}

export function aggregateAveragePrices(
  positions: Array<AveragePriceResult & { quantity: Decimal.Value }>,
): AveragePriceResult {
  let totalQuantity = new Decimal(0);
  let pricedQuantity = new Decimal(0);
  let pricedCost = new Decimal(0);
  let coveredQuantity = new Decimal(0);

  for (const position of positions) {
    const quantity = positive(position.quantity);
    if (!quantity) continue;
    totalQuantity = totalQuantity.add(quantity);
    if (!position.price) continue;
    pricedQuantity = pricedQuantity.add(quantity);
    pricedCost = pricedCost.add(position.price.mul(quantity));
    coveredQuantity = coveredQuantity.add(quantity.mul(position.coverage));
  }

  if (pricedQuantity.eq(0) || pricedCost.eq(0)) return { price: null, coverage: 0 };
  return {
    price: pricedCost.div(pricedQuantity),
    coverage: totalQuantity.gt(0)
      ? Decimal.min(1, coveredQuantity.div(totalQuantity)).toNumber()
      : 0,
  };
}
