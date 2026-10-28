import Decimal from "decimal.js";
import { finish, Money, sum, type AllocationInput, type AllocationResult } from "./types";

/** Currency scopes are a UOVP extension, not an observed Cerrado rule. Trim
 * purchases only: excluded holdings retain their value and nothing is sold.
 * Every cap uses actual investment, so unspent cash cannot inflate a target.
 */
export function capScopedTargets(input: AllocationInput, result: AllocationResult): AllocationResult {
  const total = sum(input.assets.map((a) => a.currentValue));
  const values = new Map(result.suggestions.map((s) => [s.assetId, { quantity: s.quantity, value: s.value }]));
  const groups = Object.entries(input.targets).map(([cls, target]) => {
    const assets = input.assets.filter((a) => a.investmentClass === cls);
    // Rounding other positions down to ten quantity/value decimals reduces
    // this class's target denominator. Bound only that settlement difference;
    // this never adds purchases or permits spending above the budget.
    const outsideLoss = sum(input.assets.filter((a) => a.investmentClass !== cls && values.has(a.id))
      .map((a) => new Money(a.fractional ? a.unitPrice : 0).mul("0.0000000001").plus("0.0000000001")));
    const share = new Money(target).div(100);
    return { assets, target: share, current: sum(assets.map((a) => a.currentValue)), settlementTolerance: share.mul(outsideLoss) };
  });
  const added = (group: typeof groups[number]) => sum(group.assets.map((a) => values.get(a.id)?.value ?? 0));
  const invested = () => sum([...values.values()].map((v) => v.value));
  const exceeds = (group: typeof groups[number], spent: Decimal) => {
    const buy = added(group);
    return buy.gt(0) && group.current.plus(buy).gt(total.plus(spent).mul(group.target).plus(group.settlementTolerance));
  };
  // Reducing one class also lowers the denominator of other classes. Recheck
  // after each pass; never round a quantity up to repair the distribution.
  for (let pass = 0; pass < 32; pass++) {
    let changed = false;
    for (const group of groups) {
      const spent = invested();
      if (!exceeds(group, spent)) continue;
      const buy = added(group);
      const cap = Money.max(0, total.plus(spent.minus(buy)).mul(group.target)
        .minus(group.current).div(new Money(1).minus(group.target)));
      const ratio = Money.min(1, cap.div(buy));
      for (const a of group.assets) {
        const old = values.get(a.id);
        if (!old) continue;
        const quantity = a.fractional ? old.quantity.mul(ratio).toDecimalPlaces(10, Decimal.ROUND_DOWN) : old.quantity.mul(ratio).floor();
        const value = Money.min(old.value, quantity.mul(a.unitPrice)).toDecimalPlaces(10, Decimal.ROUND_DOWN);
        if (value.gt(0)) values.set(a.id, { quantity, value }); else values.delete(a.id);
      }
      changed = true;
    }
    if (!changed) break;
  }
  // Nearly saturated target systems may converge slowly. Bound that work and
  // conservatively remove a still-violating class's purchases. At most one
  // removal per class is possible, so termination is guaranteed.
  for (let pass = 0; pass < groups.length; pass++) {
    const group = groups.find((candidate) => exceeds(candidate, invested()));
    if (!group) break;
    for (const a of group.assets) values.delete(a.id);
  }
  return finish(input, values, { ...result.calculation, reservedAmount: invested().toString(),
    classTolerancesBrl: Object.fromEntries(Object.keys(input.targets).map((cls, i) => [cls, groups[i].settlementTolerance.toString()])),
  });
}
