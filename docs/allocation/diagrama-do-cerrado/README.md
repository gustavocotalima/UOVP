# Diagrama do Cerrado

[Português](README.pt-BR.md) · [Improved](../melhorado/README.md)

Select this method in Settings → Contribution calculation system. The preference belongs to each user and applies to the portfolio and MCP preview. UOVP defaults to Improved (Melhorado).

## Origin and scope

This engine reproduces rules reconstructed from observed AUVP responses. It contains no private AUVP source code and makes no AUVP API calls. Parity requires the same assets, prices, holdings, scores, targets and input orders in the verified scenarios; it cannot guarantee compatibility with future AUVP changes.

BRL/USD filters and additional UOVP classes are extensions: the official request captured during the investigation accepted only the contribution amount. Positions retain the user's classifications, including fixed-income ETFs and store-of-value assets.

## UOVP budget adapter (version 3)

The reconstructed core remains version 1, with the steps below unchanged. The public calculation first applies UOVP's shared budget policy; this extension is not claimed to reproduce an AUVP setting.

“Usar todo o aporte” is shown for BRL-only or USD-only contributions, unchecked by default. `TARGET_CAPPED` plans the feasible investment ceiling against global targets and actual invested wealth. `FULL_BUDGET` runs that normal capped calculation first. If a global cap leaves at least one cent unspent, it fixes those purchases as existing holdings and calculates only the remainder, using relative targets among eligible classes. Both retain currency filters, scores, prices and purchase increments. The checkbox belongs to the current calculation and is also available through MCP's `budgetPolicy` input.

Both policies produce identical purchases until a global class ceiling actually binds. Rounding alone never activates the second stage. Full mode relaxes only the global ceiling for the remainder; score rules remain unchanged, and the first purchases cannot be reduced or replaced.

The adapter feeds its planned amount and effective class targets into the original two-pass core. The core still applies its own score gaps, reservation walk and rounding. A final safeguard rounds purchases down and rechecks class targets when the denominator falls, with at most 32 passes and a conservative fallback. Only the additional remainder stage skips the global cap; it may still leave money unallocated because of the core's rules. Neither mode exceeds the requested budget or sells existing holdings.

Original and planning targets, policy, planned amount and remainder reasons are recorded in calculation diagnostics. Two-stage results also record the first-stage investment, its remaining budget and the additional investment. The returned quantities and values combine both stages by asset, without changing first-stage purchases. Displayed final percentages always use original total wealth plus actual investment. Unexecuted older drafts require recalculation; recorded and awaiting-sync history is preserved. Raw-core parity tests remain separate from adapter tests.

## Steps

1. Add the requested contribution to existing wealth to obtain the final reference.
2. For each positive-target class with eligible receivers, calculate `max(0, final reference × target − current class value)`.
3. Divide the pass budget in proportion to these gaps.
4. Within each class, calculate eligible wealth after its contribution. Each asset's reference is that wealth multiplied by its score and divided by eligible positive scores. Distribute the budget in proportion to positive gaps between references and existing values.
5. Round whole-unit purchases down. Fractional assets receive their proportional amount. A second pass attempts to distribute the remainder.

The observed behavior includes a reservation walk between passes. In inclusion order, each whole-unit asset with a positive theoretical allocation but no purchased unit reserves the cost of one unit. If that reservation exceeds the remaining balance, the asset is omitted from the second pass. The cost is subtracted even when unaffordable, so later assets may also be omitted. Omissions affect the wealth and eligibility used in the second pass.

Distribution uses ticker order; reservation uses stable inclusion order (`createdAt` and ID). Sorting a UI table does not change either order. Offline inputs can supply their original order explicitly.

The previous approximations that completed a unit at 94% or retained 99.48% of fractional purchases have been removed. Improved's tolerance is not applied to this engine.

## Amounts and limitations

Nonpositive scores, zero targets, invalid prices and currency exclusions prevent purchases. The omission rule can increase the remainder and change the distribution; this is intentionally preserved for compatibility.

Results identify their method and version. UOVP's final percentages use all initial wealth plus actual investment, excluding the remainder. Persistence rounds fractional quantities and values down to ten decimal places to respect database precision and the budget. This subcent presentation difference is not a new allocation rule.

Changing methods invalidates drafts and requires recalculation. Executed history and contributions awaiting synchronization are preserved. MCP returns previews only; calculation never places market orders.

Both methods share the per-account limit of one outstanding calculation and six starts per sliding minute per server process, counting UI and MCP clients together. See [execution limits](../melhorado/README.md#precision-and-execution).

## Implementation and verification

- Pure engine: `features/portfolio/calculation/cerrado.ts`.
- Shared service: `features/portfolio/calculation/server.ts`.
- Core Decimal arithmetic with precision 40; shared planner with precision 60; no global precision changes.
- Synthetic tests are versioned. Personal captures and their replays remain outside Git.
- Local validation replays available captured responses. Integration tests cover selection, isolation, invalidation and UI/MCP equivalence.

The capped adapter tolerates only the calculable effect of rounding other fractional quantities and amounts down to ten decimals on a class target. It does not enlarge the cash budget or apply Improved’s lot allowances. This prevents subcent settlement differences from progressively erasing a balanced basket.
