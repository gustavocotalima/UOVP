# Improved (Melhorado)

[Português](README.pt-BR.md) · [Diagrama do Cerrado](../diagrama-do-cerrado/README.md)

UOVP's default method, selected per user in Settings and shared by the portfolio and MCP. Version 3 uses deterministic approximate apportionment in TypeScript with the existing `decimal.js` dependency. It requires no new packages, WebAssembly, Python or external service.

## Priorities

1. Balance investment classes against their targets.
2. Within each class, balance positions against their scores.
3. Use the remaining budget while preserving the first two criteria.

The entered amount is a ceiling, not a spending requirement. A combination must not win merely by spending more if it worsens balance beyond rounding allowances.

Scores describe desired shares of class wealth after the contribution. Scores 2, 3 and 5 represent 20%, 30% and 50%. Adding another score-5 asset changes those references to 13.33%, 20%, 33.33% and 33.33%. Existing positions are included; a high-score asset already above its share may receive no purchases.

The algorithm proposes purchases only. Overweight positions remain in the portfolio, and a small contribution may correct only part of an imbalance.

## Budget policy

Both methods offer “Usar todo o aporte” for BRL-only or USD-only calculations, unchecked by default. Changing the checkbox discards the displayed preview and requires recalculation; it does not change account preferences or holdings.

- `TARGET_CAPPED`: preserve global class targets, with the lot-aware allowances below. Currency-excluded holdings remain in total wealth. The planner finds the continuous feasible investment ceiling using actual investment, rather than counting the uninvested amount as wealth.
- `FULL_BUDGET`: allow global targets to be exceeded. Water-fill final eligible class balances in proportion to their original positive targets, counting existing positions as immutable lower bounds. Within each class, do the same using positive scores. Existing overweight or excluded holdings remain untouched; only underweight eligible holdings receive purchases until the others catch up.

For example, with USD-only targets of 15% international stocks and 2% store of value, full mode aims for a 15:2 ratio between the final eligible class balances (88.24% / 11.76%), rather than splitting the new money alone in that ratio. Original targets remain unchanged and are recorded alongside the planning targets.

“Use all” is a best effort: zero targets, nonpositive scores, missing prices, currency exclusions, whole units and balancing allowances still apply. Budget conservation is mandatory in both policies.

## Apportionment and rounding

1. Prepare a bounded weighted allocation of entire class balances, then all asset balances within each class, including existing wealth. In capped mode, constrain the amount by global targets and score capacity; in full mode, derive feasible planning shares from the weighted final balances.
2. Convert the complete purchase basket to permitted quantities. Consider nearby whole-basket rounding, rather than trying to grow a balanced class one asset at a time.
3. Refine single purchases, pairs, replacements, complete class baskets and a portfolio-wide basket, in priority order: financial validity, class balance, score balance and budget use.
4. Recalculate with Decimal and return the best valid combination and exact remainder.

Coordinated moves let three or more balanced fractional assets grow together. They prevent the former USD-only/BRL-only stall caused by score limits rejecting intermediate single-asset or pair purchases. Canonical ID order prevents table sorting from changing calculations. Existing quantities are never reduced.

## Lot-aware allowances

Whole units prevent exact proportions for every contribution. Comparisons use monetary rounding bands rather than sacrificing scores to gain one cent of class-target precision.

For each class, consider its cheapest eligible purchase affordable within the budget, in BRL. Its allowance is BRL 0.01 plus the largest of:

- Half that increment, when every positive-target class has affordable receivers.
- The class target multiplied by the sum of other classes' increments.
- The compensation required for rounding other classes' fractional quantities down.

A position receives an allowance of one purchase increment plus compensation for other positions' fractional rounding losses within its class. Nonpositive scores, zero targets, zero prices and currency exclusions prevent purchases. Excluded holdings retain their wealth in the denominator and need not satisfy a grid for purchases they cannot receive.

Allowances never increase the budget. Purchases exceeding class or asset upper limits are rejected. For small contributions, a single unit can represent a material percentage difference.

## Precision and execution

Reservations use integer cents. Fractional steps worth at least one cent require an explicit cent settlement grid; whole instruments also require prices on that grid. Fractional quantities are rounded down to their permitted step and the database's ten-decimal precision.

Numeric refinement does not determine final financial validity: Decimal at precision 60 recalculates values and checks the budget, class limits and score proportions. The remainder conserves the budget, including FX, within database precision.

Refinement is local and bounded, with no promise of a global optimum. It stops when no improvement exists among the considered moves, after 64–256 iterations depending on portfolio size, or after three seconds. Diagnostics record priorities, iterations, evaluations and the stop reason. Normal completion does not produce the former mathematical-proof warning.

Models accept at most 256 asset groups. Native Node workers execute outside the main thread and database transactions: two concurrently, a queue of up to 16 and a memory limit per worker. Admission permits one outstanding calculation and six starts per sliding minute per account across the UI, MCP and both methods. Bookkeeping is held in memory per server process.

## History and verification

Version 3 requires recalculating drafts from older versions. The migration invalidates old drafts without recorded contributions; executed history and contributions awaiting synchronization retain their original data. The server also rejects execution of an incompatible calculation version.

- Financial preparation and validation: `features/portfolio/calculation/improved.ts`.
- Budget planner: `features/portfolio/calculation/budget-policy.ts`.
- Apportionment and refinement: `features/portfolio/calculation/balanced-search.ts`.
- Service and admission: `features/portfolio/calculation/server.ts` and `admission.ts`.
- Proportions, existing positions, remainders and whole purchases: `tests/unit/allocation-balance.test.ts`.
- Independent small-case comparisons: `tests/unit/allocation-methods.test.ts`.
- Preferences, history and UI/MCP: `tests/integration/allocation-methods.test.ts`.
- Browser: `cypress/e2e/allocation-methods.cy.ts` and `allocation-budget-policy.cy.ts`.

Personal financial captures and replays stay outside Git. Fees, broker-specific minimums and order execution are outside this apportionment.

Policy and coordinated-basket regressions: `tests/unit/allocation-budget-policy.test.ts`; both currency filters, methods and UI/MCP policies: `tests/integration/allocation-methods.test.ts`.
