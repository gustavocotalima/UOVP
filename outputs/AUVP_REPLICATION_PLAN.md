# AUVP Tools replication plan

## 1. Objective

Build a multi-user financial planning application that reproduces the functionality exposed by the **left navigation** of `ferramentas.auvp.com.br`:

- Home
- Carteira
- Orçamento Doméstico
- Ferramentas
- FAQ

The AUVP product navigation in the top header is explicitly out of scope. The replacement should have its own compact application shell with the left navigation, user menu, sign-out, and light/dark theme.

The application will be a full-stack Next.js application using:

- Next.js App Router and TypeScript
- pnpm as the only package manager
- Tailwind CSS
- shadcn/ui
- Lucide icons
- Leaflet for the country-risk map
- PostgreSQL with Prisma
- Next.js Server Actions and Route Handlers for the backend inside the frontend project
- Vitest for unit and database-integration tests
- Cypress for browser end-to-end and visual-parity tests

External data sources that are not available yet will be represented through typed mock adapters. User-entered data, preferences, portfolio data, budgets, questions, and balance-sheet entries will be persisted in PostgreSQL from the first version.

## 2. Verification status

The scope below was verified in the authenticated live application. No logout action was performed during verification. A first session was invalidated by the application's own failed `401` classification request; the second authenticated session remained stable.

The controlled portfolio experiments changed only allocation targets. The original targets were restored and the original R$ 10.000 contribution result was reproduced after restoration. Holdings were never changed.

Calculation confidence is separated into three levels:

- **Exact, client-side:** formulas that were reproduced value-for-value from the live UI.
- **Exact for captured fixtures:** the contribution algorithm is server-side in AUVP, but its behavior was reconstructed by black-box experiments and matches the captured normal-range fixtures exactly.
- **Compatibility fixtures required:** low-contribution and one-share rounding boundaries contain additional fallback behavior. These must be encoded as golden fixtures before parity is declared complete; they should not be guessed or silently simplified.

## 3. Information architecture

| Route | Left-nav item | Main sections |
| --- | --- | --- |
| `/home` | Home | Portfolio summary, budget history, podcast, community CTA |
| `/carteira` | Carteira | Ativos, Metas, Aportar, Perguntas, Mapa |
| `/orcamento-domestico` | Orçamento Doméstico | Orçamento Doméstico, Minhas metas |
| `/ferramentas` | Ferramentas | Primeiro milhão, Ativos vs Passivos |
| `/faq` | FAQ | Minha carteira, Orçamento Doméstico, Ferramentas, support block |

Authenticated routes use a shared `(app)` layout. Public authentication screens use a separate `(auth)` layout. The top AUVP product navbar is not reproduced.

## 4. Functional scope

### 4.1 Shared application shell

- Responsive left sidebar with the five verified destinations.
- Active-route indication and icons.
- Collapsed mobile navigation using shadcn/ui `Sheet`.
- Light/dark theme toggle.
- Profile menu and sign-out.
- Brazilian Real formatting with `pt-BR` locale.
- Feature-level FAQ links using `/faq?categoria=<categoria>`.
- Loading, empty, error, and permission-denied states.

### 4.2 Home

- Portfolio total card and donut chart grouped by investment class.
- Current percentage of each class and total invested amount.
- Household-budget history chart with `Gastos` and `Renda` toggles.
- Embedded podcast block with a configurable Spotify URL.
- Community CTA block with configurable external URL.
- BRL currency indicator.
- Empty-state versions of every summary for new users.

Home is a read model: it aggregates persisted portfolio and monthly-budget data and does not own separate financial records.

### 4.3 Carteira — Ativos

- Search assets by name or ticker.
- Add an asset manually.
- Import assets from `.xlsx` with a preview, validation errors, duplicate handling, and transactional confirmation.
- Filter by the seven verified classes:
  - Ações internacionais
  - Ações nacionais
  - Fundos imobiliários
  - REITs
  - Criptomoedas
  - Renda fixa
  - Renda fixa internacional
- Asset table with:
  - class/type
  - ticker/name
  - current value
  - percentage within its class
  - diagram score/strength
  - quantity
  - last update date
  - edit action
- Edit quantity, price/value, name/ticker, class, and applicable metadata.
- Manual value/price entry for types without a market-data price.
- Delete one asset or delete all assets from a selected class, both with confirmation.
- Portfolio donut chart and applicable class/segment toggles.
- Store prices and quantities at high precision; only round for display.

The first version uses a mocked market catalog and mocked price refresh service. Manual values remain fully functional.

### 4.4 Carteira — Metas

- Investor-profile presets: Conservador, Moderado, and Arrojado.
- One percentage slider/input for each of the seven investment classes.
- Running total that must equal 100% before save.
- Reset to last persisted values.
- Save targets per user.
- Target-distribution chart.
- Unsaved-change warning when navigating away.

Preset values are seed data, while the user's selected/custom targets are persisted separately.

### 4.5 Carteira — Aportar

- BRL contribution input.
- `Calcular` action that does not mutate holdings.
- Suggested-distribution chart.
- Suggestions table showing asset, class, quantity, suggested value, contribution percentage, and post-contribution portfolio percentage.
- Per-row `Aportar` action.
- `Aportar tudo` action.
- Confirmation before holdings are updated.
- One database transaction for `Aportar tudo`; a partial failure must roll back the whole operation.
- Simulation history can be retained for audit/debugging without being treated as a completed purchase.
- No brokerage order is sent in the mocked version. Confirming an allocation updates the application's own portfolio only.

### 4.6 Carteira — Perguntas

- Two diagram/questionnaire types:
  - Cerrado
  - Investimentos imobiliários
- Search questions.
- Create, edit, order, enable/disable, and delete questions.
- Restore the seeded default questionnaire.
- Apply the verified model/default-answer helper.
- Answer each applicable question with yes/no.
- Recalculate an asset's score when its answers or active question set changes.
- Keep user-created questions isolated per user.

The score model is the sum of `+1` for each positive answer and `-1` for each negative answer. For `N` answered questions and `Y` positive answers, this is:

```text
score = (2 × Y) - N
```

An asset with score `0` remains in portfolio totals but is not eligible to receive an allocation suggestion.

### 4.7 Carteira — Mapa

- Leaflet map loaded client-side only.
- World-country GeoJSON layer.
- Country coloring by risk classification.
- Country search and selection.
- Filter/legend for risk bands.
- Country detail panel with tabs for:
  - indices
  - companies
  - ETFs
- Zoom/pan and responsive detail drawer.
- Accessible non-map country list as a keyboard/screen-reader alternative.

Versioned GeoJSON and country metadata should live in `public/data` for the initial mocked version. A `CountryDataProvider` interface allows later replacement with an external service without changing the UI.

### 4.8 Orçamento Doméstico

- Month/year navigation.
- Monthly income input.
- Tabs for `Total` plus the six verified categories.
- Default target categories:
  - Custos fixos — 30%
  - Conforto — 10%
  - Metas — 20%
  - Prazeres — 10%
  - Liberdade financeira — 25%
  - Conhecimento — 5%
- Add, edit, and delete an expense with name, amount, category, date, and recurring flag.
- Category-scoped expense list.
- Summary table with category, spent, should spend, utilized percentage, and total.
- Cards for total spent, total planned, and total utilized percentage.
- `Preencher` action to copy/apply recurring expenses to the selected month.
- `Ver gastos` action to inspect the recurring-expense source list before applying it.
- `Minhas metas` section with sliders totaling 100%, reset, and save.
- Persist all income, expense, and target data by user and calendar month.
- Feed income/spending history back to Home.

### 4.9 Ferramentas — Primeiro milhão

- Annual return input.
- Disabled monthly-return field derived from the annual return.
- Initial-value input.
- Desired-value input used as the result threshold/visual target.
- `Calcular` action.
- Results table and line chart.
- Fixed monthly-contribution rows:

```text
50, 100, 200, 300, 400, 500, 1.000, 2.000, 3.000,
5.000, 10.000, 15.000, 20.000, 30.000, 50.000 BRL
```

- Fixed horizons: 10, 15, 20, 25, 30, 35, and 40 years.
- Highlight values that meet or exceed the desired amount.

This tool is pure client-side computation and does not require persistence unless product analytics or saved scenarios are later requested.

### 4.10 Ferramentas — Ativos vs Passivos

- Live net-worth card.
- Asset total and liability total.
- Inline add/edit/delete entries under:
  - Contas a receber
  - Investimentos
  - Disponibilidade
  - Passivo de valor
  - Passivo circulante
  - Não circulante
- Each entry contains a name and BRL value.
- Persist entries per user.
- Recalculate totals immediately after each confirmed change.

### 4.11 FAQ

- Accordion categories:
  - Minha carteira
  - Orçamento Doméstico
  - Ferramentas
- Query-string deep link that opens the requested category.
- Accordion question/answer items.
- Seed the verified FAQ structure/content as versioned application data.
- Support block with configurable WhatsApp/phone link and QR code.
- Mobile and keyboard-accessible behavior using shadcn/ui `Accordion`.

## 5. Exact calculations

All monetary math should use decimal arithmetic. JavaScript binary floats must not be used for persisted amounts or allocation decisions. Use Prisma `Decimal` in the data layer and a decimal library in the calculation domain.

### 5.1 First-million calculator — exact client formula

Convert annual effective rate `a` to monthly effective rate `r`:

```text
r = (1 + a)^(1/12) - 1
```

For initial principal `P`, end-of-month contribution `PMT`, and `n = years × 12`:

```text
FV = P × (1 + r)^n + PMT × (((1 + r)^n - 1) / r)
```

When `r = 0`, use:

```text
FV = P + PMT × n
```

The UI displays the monthly percentage rounded to two decimals but the calculation uses the unrounded monthly rate. Verified live example:

```text
annual return: 8%
monthly effective return: 0.643403011...% (displayed as 0.64%)
initial value: R$ 10.000,00
monthly contribution: R$ 50,00
time: 10 years
result: R$ 30.595,46
```

### 5.2 Budget calculations — exact client/read-model formulas

For category target percentage `p`, monthly income `I`, and category spending `S`:

```text
targetAmount = I × p / 100
utilizedPercent = targetAmount == 0 ? 0 : S / targetAmount × 100
remainingAmount = targetAmount - S
```

Monthly totals are the sums of the category amounts. Displayed percentages are rounded only at presentation time.

### 5.3 Balance-sheet calculations

```text
assets = sum(asset-category entries)
liabilities = sum(liability-category entries)
netWorth = assets - liabilities
```

### 5.4 Portfolio percentages

```text
classPercent = classCurrentValue / portfolioCurrentValue × 100
assetPercentWithinClass = assetCurrentValue / classCurrentValue × 100
```

Guard division by zero and show `0%` for empty totals.

### 5.5 Contribution suggestion response fields

For requested contribution `C`, an asset's current value `V`, its suggested amount `S`, and current portfolio total `T`:

```text
suggestionPercentage = S / C × 100
totalAfterSuggestionPercentage = (V + S) / (T + C) × 100
```

The live response also exposes `recommendedPercentage`, but it remained `0` in the verified responses and should not be used to drive the UI.

For crypto, store the full-precision suggested value and quantity. Match the live presentation by displaying suggested quantity to four decimal places; do not recompute the money value from that rounded display quantity.

## 6. Reconstructed contribution-allocation algorithm

### 6.1 Server boundary

In the live application, the client sends only the contribution value to `POST /users/suggestions` and renders the returned rows. The allocation algorithm is not shipped to the client. In the replacement, implement it as a server-only domain service invoked by a Route Handler or Server Action.

### 6.2 Inputs

- Current value of every asset.
- Investment class for every asset.
- User's target percentage for every class.
- Asset score/strength.
- Current unit price.
- Whether the asset supports fractional quantities.
- Requested contribution.

All assets, including score-zero assets, contribute to current class and portfolio totals. Only score-positive assets are eligible for new suggestions. Classes with target `0%` or no eligible asset are skipped.

### 6.3 Macro allocation by class

For final portfolio value `F = currentPortfolio + contribution`:

```text
gap[class] = max(0, F × classTarget[class] / 100 - currentClassValue[class])
classBudget[class] = remainingContribution × gap[class] / sum(all positive gaps)
```

An overweight class therefore receives zero. After a pass spends money, recompute current simulated class values, remaining contribution, and gaps.

### 6.4 Micro allocation inside a class

For eligible assets in a class:

```text
strengthTotal = sum(assetStrength)
finalEligibleClassValue = currentEligibleClassValue + classBudget
idealValue[asset] = finalEligibleClassValue × assetStrength / strengthTotal
deficit[asset] = max(0, idealValue[asset] - currentAssetValue[asset])
rawSuggestion[asset] = classRemaining × deficit[asset] / sum(deficits)
```

For indivisible assets:

```text
quantity = floor(rawSuggestion / unitPrice)
spent = quantity × unitPrice
```

For divisible assets such as crypto:

```text
spent = rawSuggestion
quantity = spent / unitPrice
```

Update simulated asset values after each allocation before the next pass.

### 6.5 Residual-pass behavior

The captured normal-range results are reproduced by this schedule:

1. Outer pass 1: recompute class gaps, then perform one micro allocation pass per class.
2. Outer pass 2: recompute class gaps from simulated values, then perform two micro residual passes per class.
3. Return unspent cash when indivisible unit prices prevent further valid purchases.

This schedule reproduced the captured baseline R$ 5.000, R$ 10.000, and R$ 20.000 results to floating-point precision and reproduced controlled profile fixtures across multiple contribution values.

### 6.6 Mandatory compatibility gate

Very small contributions show an additional conditional fallback at indivisible-share boundaries. Captured examples include no suggestion at R$ 1,10 and distinct fallback selections at R$ 25, R$ 50, R$ 75, and R$ 100 in an isolated single-class test. Specific one-share boundaries also differ from the normal residual schedule.

Do not invent a generic fallback. Before declaring parity:

- Convert every captured response to anonymized golden fixtures.
- Capture more values immediately below, at, and above every observed unit-price boundary.
- Implement the smallest deterministic edge policy that passes all fixtures.
- Run differential tests against the reference application for synthetic portfolios.
- Treat any unmatched cent, quantity, or selected ticker as a failed parity test.

The plan therefore distinguishes the high-confidence core algorithm from the still-black-box low-value fallback instead of claiming unverified universal equivalence.

## 7. Application architecture

```text
Browser
  -> Next.js Server Components for initial reads
  -> Client Components for forms, charts, Leaflet, and pure calculators
  -> Server Actions / Route Handlers
  -> authenticated domain services
  -> Prisma repositories
  -> PostgreSQL

Mock market/country adapters
  -> typed provider interfaces
  -> domain services
```

Recommended boundaries:

- `app/`: routes, layouts, loading/error boundaries.
- `components/`: reusable shadcn-based UI and feature components.
- `features/<feature>/domain`: pure calculations and invariants.
- `features/<feature>/server`: authenticated services and repository orchestration.
- `features/<feature>/ui`: feature-specific Client Components.
- `lib/auth`: session resolution and authorization helpers.
- `lib/db`: Prisma singleton and transaction helpers.
- `lib/money`: decimal, currency parsing, and formatting.
- `providers`: market data, asset lookup, country data, and external-link adapters.
- `prisma`: schema, migrations, and seed data.
- `public/data`: versioned map/FAQ/mock catalog assets.

Use Server Components for initial data retrieval. Use Client Components only where interaction or browser APIs are required. Load Leaflet dynamically with SSR disabled.

## 8. Multi-user authentication and isolation

- Use Auth.js as the session boundary while keeping the identity provider replaceable.
- Implement the sign-in method selected for the product without coupling financial records to that provider.
- Resolve the authenticated user on the server for every query/mutation.
- Never accept `userId` from a client form as authorization.
- Every user-owned table includes a non-null `userId` foreign key and user-scoped indexes.
- Repository methods require the authenticated user ID and include it in every `where` clause.
- Add CSRF/session protections supplied by the authentication layer.
- Rate-limit login, import, and calculation endpoints.
- Use transactions for batch import, target replacement, recurring-expense copy, and `Aportar tudo`.
- Record timestamps and optional audit metadata for financial mutations.

## 9. Prisma data model

Exact names can be refined during schema design, but the model must cover these aggregates:

| Aggregate | Principal models | Ownership/invariants |
| --- | --- | --- |
| Identity | `User`, Auth.js account/session models, `UserPreference` | One preference row per user |
| Portfolio | `Portfolio`, `Asset`, `AssetPriceSnapshot` | Unique asset identity within user portfolio/class; decimal quantity/value |
| Targets | `InvestmentTarget`, `InvestorProfilePreset` | Seven user targets total 100%; presets are global seed data |
| Diagram | `Diagram`, `DiagramQuestion`, `AssetQuestionAnswer`, `AssetScore` | User questions isolated; one answer per asset/question |
| Contributions | `ContributionSimulation`, `ContributionSuggestion`, `ContributionExecution` | Simulation immutable; execution transactional |
| Budget | `BudgetMonth`, `BudgetTarget`, `Expense`, `RecurringExpense` | Unique user/year/month; targets total 100% |
| Balance sheet | `BalanceSheetEntry` | User-owned, typed by six verified categories |
| Content | `FaqCategory`, `FaqItem` | Global seeded content unless an admin CMS is later requested |

Use enums for investment class, diagram type, balance-sheet category, asset divisibility, and simulation/execution status. Use `Decimal` for money, price, and quantity; never store money as `Float`.

Suggested important constraints:

- `BudgetMonth`: unique `[userId, year, month]`.
- `InvestmentTarget`: unique `[userId, investmentClass]`.
- `AssetQuestionAnswer`: unique `[assetId, questionId]`.
- `Asset`: scoped uniqueness appropriate to class and instrument identity.
- Cascade only dependent records; require explicit confirmation for deleting financial aggregates.

## 10. Mock-provider strategy

Define stable interfaces before creating mocks:

- `AssetCatalogProvider`
- `MarketPriceProvider`
- `ExchangeRateProvider`
- `CountryDataProvider`
- `CommunityContentProvider`

Initial adapters:

- `StaticAssetCatalogProvider`: seeded tickers, names, class, currency, and divisibility.
- `MockMarketPriceProvider`: deterministic prices and a fixed `asOf` timestamp.
- `MockExchangeRateProvider`: deterministic BRL conversion rates.
- `StaticCountryDataProvider`: GeoJSON plus versioned country-risk/company/index/ETF data.
- Config-driven podcast/community/support links.

Mock responses must be deterministic so screenshots and allocation tests do not change over time. UI should visibly show the price date and whether data is mocked/manual.

## 11. Validation and error handling

- Validate Server Action/Route Handler input with Zod.
- Parse BRL-formatted input to decimal values centrally.
- Reject negative quantities, prices, income, expenses, and contributions.
- Enforce 100% totals server-side as well as in the UI.
- Reject allocations when prices are missing/stale unless manual values are explicitly allowed.
- Provide row-level import errors without importing partial invalid batches.
- Use optimistic locking or an updated-at check when a simulation is executed after holdings changed.
- Return structured domain errors rather than raw Prisma errors.

## 12. Implementation sequence

### Phase 0 — Parity fixtures and design inventory

- Anonymize the captured calculation fixtures.
- Expand boundary-value fixtures for the allocation fallback.
- Record colors, spacing, typography, table states, empty states, and responsive layouts.
- Freeze route and terminology mapping.

Exit: calculation fixture pack and UI inventory approved.

### Phase 1 — Foundation and identity

- Next.js, Tailwind, shadcn/ui, theme, sidebar, and route layouts.
- Authentication/session integration.
- Prisma/PostgreSQL schema and initial migrations.
- User-scoped data-access layer.
- Seed global presets, FAQ, mock catalog, and map data.

Exit: two users can sign in and cannot see or mutate each other's data.

### Phase 2 — Portfolio core

- Asset CRUD, search, filters, charts, and `.xlsx` import.
- Targets and investor-profile presets.
- Diagram questions, answers, and score calculation.
- Mock asset/price provider adapters.

Exit: each user can build an isolated portfolio and reproduce class/asset percentages and diagram scores.

### Phase 3 — Contribution engine

- Decimal-based macro/micro allocation domain service.
- Residual passes and indivisible/divisible handling.
- Simulation UI and result chart/table.
- Per-asset and batch contribution execution.
- Golden/differential tests, including low-value edge policy.

Exit: every approved golden fixture matches ticker selection, quantity, value, and percentages exactly.

### Phase 4 — Household budget

- Monthly income, targets, expense CRUD, summaries, and month navigation.
- Recurring-expense source list and copy flow.
- Home history read model.

Exit: totals and percentages match verified formulas across empty, normal, overspent, and zero-income months.

### Phase 5 — Tools

- First-million table/chart and threshold highlighting.
- Assets-vs-liabilities CRUD and live totals.

Exit: the verified 8%/R$ 10.000/R$ 50/10-year fixture returns R$ 30.595,46 and balance-sheet totals remain exact after CRUD operations.

### Phase 6 — Map, Home, and FAQ

- Leaflet risk map and accessible list/detail alternative.
- Home aggregate dashboard, podcast, and community CTA.
- FAQ accordion, deep links, and support block.

Exit: every left-nav destination and every internal section is reachable and functional without the AUVP top product navbar.

### Phase 7 — Hardening and parity review

- Accessibility, responsive design, keyboard navigation, and contrast.
- Security and cross-user isolation tests.
- Performance budgets and database query review.
- Full end-to-end parity checklist against the reference application.
- Backup/restore and migration rehearsal.

Exit: functional, calculation, multi-user, accessibility, and persistence acceptance criteria all pass.

## 13. Test strategy

The project uses only these test runners:

- **Vitest:** pure domain calculations, validation, server services, provider contracts, and Prisma integration tests.
- **Cypress:** authenticated browser flows, responsive behavior, accessibility-oriented interaction checks, and visual/reference parity.

Recommended scripts:

```text
pnpm test                 -> vitest run
pnpm test:watch           -> vitest
pnpm test:integration     -> vitest run --config vitest.integration.config.ts
pnpm cypress:open         -> cypress open
pnpm cypress:run          -> cypress run
```

### Vitest unit tests

- Annual-to-monthly rate conversion and future-value matrix.
- Budget/category/portfolio percentages.
- Diagram score.
- Net worth.
- Allocation macro gaps, micro deficits, rounding, residual passes, zero-score exclusion, target-zero classes, and fractional quantities.

### Vitest database integration tests

- User isolation for every aggregate.
- Target and budget 100% invariants.
- Batch import rollback.
- Recurring-expense copy idempotency.
- `Aportar tudo` rollback and stale-simulation rejection.

### Cypress end-to-end tests

- Sign in as two different users and prove isolation.
- Complete every sidebar/internal navigation flow.
- Asset CRUD/import, target save/reset, questionnaire CRUD, simulate/execute contribution.
- Monthly budget and recurring expenses.
- First-million matrix.
- Balance-sheet CRUD.
- Map selection and FAQ query deep links.
- Mobile sidebar and keyboard-only flows.

### Golden parity tests

- Store anonymized input portfolios and reference responses as Vitest fixtures.
- Compare exact selected assets and integer quantities.
- Compare money at cent precision.
- Compare crypto value at full precision and displayed quantity at four decimals.
- Include one-cent and one-share boundary cases.
- Use Cypress screenshots for stable UI states at agreed desktop and mobile viewports.
- Keep calculation parity in Vitest; Cypress verifies that the browser presents those results correctly.

## 14. Definition of done

The replication is complete only when:

- All five left-nav destinations and every verified internal section are implemented.
- The unrelated top product navbar is absent.
- Two or more authenticated users have strictly isolated persistent data.
- Portfolio, budget, questionnaire, and balance-sheet data survive logout/login and server restart.
- External market/country dependencies use deterministic mock adapters without blocking functionality.
- Every exact client formula matches the verified values.
- Every approved allocation golden fixture matches exactly, including low-value fallback cases.
- Destructive actions require confirmation and transactional mutations cannot leave partial state.
- Desktop and mobile layouts, light/dark theme, keyboard navigation, and core accessibility checks pass.
- The app can later replace mock providers without rewriting feature UI or domain calculations.

## 15. Source note

The functional inventory and formula fixtures came from authenticated live inspection of [AUVP Ferramentas](https://ferramentas.auvp.com.br). The contribution algorithm is a black-box reconstruction, not copied server source. Its macro-gap and micro-balancing behavior is consistent with a [technical discussion in the AUVP community](https://comunidade.auvp.com.br/topic/38114-pergunta-t%C3%A9cnica-para-quem-trabalha-na-auvp/) and with an [independent public recreation](https://github.com/LucasGazula/diagrama_pantaneiro), but those sources are corroboration rather than authoritative AUVP implementation code.
