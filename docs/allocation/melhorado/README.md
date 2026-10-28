# Improved (Melhorado)

[Português](README.pt-BR.md) · [Diagrama do Cerrado](../diagrama-do-cerrado/README.md)

UOVP's default method, selected per user in Settings and shared by the portfolio and MCP. Version 2 uses deterministic approximate apportionment in TypeScript with the existing `decimal.js` dependency. It requires no new packages, WebAssembly, Python or external service.

## Priorities

1. Balance investment classes against their targets.
2. Within each class, balance positions against their scores.
3. Use the remaining budget while preserving the first two criteria.

The entered amount is a ceiling, not a spending requirement. A combination must not win merely by spending more if it worsens balance beyond rounding allowances.

Scores describe desired shares of class wealth after the contribution. Scores 2, 3 and 5 represent 20%, 30% and 50%. Adding another score-5 asset changes those references to 13.33%, 20%, 33.33% and 33.33%. Existing positions are included; a high-score asset already above its share may receive no purchases.

The algorithm proposes purchases only. Overweight positions remain in the portfolio, and a small contribution may correct only part of an imbalance.

## Apportionment and rounding

1. Calculate positive class gaps against existing wealth plus the requested contribution. Only classes with eligible purchases receive a contribution reference.
2. Within each class, calculate positive-score shares and asset gaps against projected class wealth. Divide its reference across eligible receivers' positive gaps.
3. Round toward nearby purchase increments. If internal rounding exceeds the budget, reduce proposed quantities before producing any result.
4. Refine purchases, balanced purchase pairs and replacements in this priority order: financial validity, class balance, score balance, and budget use. Restart from the best valid candidate if rounded refinement stalls; probe simple fallback purchases even before the refinement loop. Existing quantities are never reduced.
5. Return the best valid combination found and the exact remainder.

The initial combination already considers scores. It does not start by concentrating each class in the cheapest asset. Canonical ID order prevents table sorting from changing calculations.

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

Version 2 requires recalculating version-1 drafts. The migration invalidates old drafts without recorded contributions; executed history and contributions awaiting synchronization retain their original data. The server also rejects execution of an incompatible calculation version.

- Financial preparation and validation: `features/portfolio/calculation/improved.ts`.
- Apportionment and refinement: `features/portfolio/calculation/balanced-search.ts`.
- Service and admission: `features/portfolio/calculation/server.ts` and `admission.ts`.
- Proportions, existing positions, remainders and whole purchases: `tests/unit/allocation-balance.test.ts`.
- Independent small-case comparisons: `tests/unit/allocation-methods.test.ts`.
- Preferences, history and UI/MCP: `tests/integration/allocation-methods.test.ts`.
- Browser: `cypress/e2e/allocation-methods.cy.ts`.

Personal financial captures and replays stay outside Git. Fees, broker-specific minimums and order execution are outside this apportionment.
