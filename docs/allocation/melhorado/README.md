# Improved (Melhorado)

[Português](README.pt-BR.md) · [Diagrama do Cerrado](../diagrama-do-cerrado/README.md)

UOVP's default method, selected per user in Settings. The UI and MCP share the preference and calculation service. This is an original TypeScript implementation using the existing `decimal.js` dependency. It requires no WebAssembly, Python, external service or additional package.

## Objectives, in order

1. Maximize reserved investment without exceeding the budget.
2. Fix that amount and minimize total monetary deviations from class references.
3. Fix the best class distribution found and minimize asset-reference deviations guided by scores.

For the investable amount found, each class reference divides that amount in proportion to positive gaps to its target on final wealth. Each asset reference divides its class reference in proportion to positive gaps to the score-weighted distribution. Existing positions remain in the base even if they receive no purchases. Canonical ID order makes results independent of UI sorting.

This priority can substantially change the distribution within a class: a closer class reference takes priority over individual score preferences.

## Lot-aware tolerance

Find each class's cheapest eligible purchase in BRL. Whole instruments use one unit; fractional instruments use their quantity step converted to money, with a one-cent floor for the reservation grid. Cap this step at the budget. Nonpositive scores, zero prices, zero targets and currency exclusions do not enlarge the allowance.

For class `i`, with its target expressed as a fraction from 0 to 1:

```text
allowance_i = BRL 0.01 + target_i × sum(other classes' cheapest purchases)
```

Rounding another class's purchase down increases class `i`'s weight. The allowance covers that effect without requiring exact whole-unit combinations. It limits the excess of classes receiving purchases; it never increases the budget.

Synthetic example: 50/50 classes, prices BRL 99 and BRL 100, budget BRL 5,000. A nearly exact one-cent rule buys nothing. This method buys 25 units of each: BRL 4,975, remainder BRL 25, weights 49.7487% and 50.2513%.

For an initially empty portfolio with every target class eligible, rounding the continuous reference down provides a combination leaving less than the sum of class purchase steps. This does not guarantee full investment when receivers are missing or existing wealth is unbalanced.

## Search and precision

The original integer search uses linear relaxations and branch-and-bound. An initial feasible cheap-lot combination provides an incumbent; the search considers replacements rather than only adding purchases. Stage one maximizes cent reservations. Later stages fix prior results, allowing a numerical slack of 0.00001 cent in distribution objectives.

Floating-point search output is not trusted for financial safety. Decimal arithmetic at precision 60 recalculates the result, checks targets, rounds quantities down and requires `spent ≤ reserved ≤ budget`. Persisted values are also rounded down to ten decimal places. The remainder conserves the exact budget, including FX, within database precision.

Fractional monetary steps of at least one cent use their exact increments. Coarse steps requiring subcent settlement are rejected until an explicit settlement grid is provided. Whole-unit prices also require a cent settlement grid.

## Execution limits

Native Node workers run calculations outside the main thread and database transactions. At most two workers run concurrently, with a queue limited to 16 and a memory limit per worker. Each stage has three seconds and up to 10,000 search nodes. Models accept at most 256 asset groups to bound memory.

If a limit or numerical difficulty prevents proof, the result says so. A valid combination can be displayed with a warning; it is not presented as proven optimal. If no valid combination is found, calculation fails explicitly. The method never silently switches to Cerrado.

Indivisible prices, currency filters, missing eligible classes and overweight positions may still leave a remainder. The allowance can represent many percentage points for contributions small relative to unit prices. Fees, broker-specific minimums and order execution are outside this calculation.

## Settings, history and tests

New and existing accounts default to Improved. Changing methods invalidates drafts. Executed and awaiting-sync records are preserved; historical simulations are not relabelled as results from this engine.

- Rules and objectives: `features/portfolio/calculation/improved.ts`.
- Original search: `features/portfolio/calculation/integer-search.ts`.
- Worker and shared service: `features/portfolio/calculation/server.ts`.
- Unit tests with independent exhaustive enumeration: `tests/unit/allocation-methods.test.ts`.
- Integration: `tests/integration/allocation-methods.test.ts`.
- Browser: `cypress/e2e/allocation-methods.cy.ts`.

Personal financial captures remain outside the repository. Local verification includes comparisons with the offline reference and whole-unit portfolios without fractional receivers.
