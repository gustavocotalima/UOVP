# UOVP Finance

[Português (Brasil)](./README.pt-BR.md)

<p>
  <img width="49%" alt="Screenshot 1" src="https://github.com/user-attachments/assets/5fddede5-1495-4ee5-b5a5-5abf2bb94757" />
  <img width="49%" alt="Screenshot 2" src="https://github.com/user-attachments/assets/e16ffa80-9fcf-4b79-a2ef-d20ed20c6ae3" />
</p>

**Uma Outra Verdade Possível** — a multi-user personal finance application for household budgeting, investment portfolios, and Open Finance aggregation, inspired by AUVP's Diagrama do Cerrado.

The interface is in Brazilian Portuguese. Frontend and backend run in the same Next.js application. PostgreSQL stores financial records and integration state; optional Redis caching shares public market data across users.

## App overview

| Area | What it does |
| --- | --- |
| **Painel** (`/home`) | Account balance, net income and expenses, period result, daily expense calendar, tag flows, and monthly history. |
| **Orçamento** (`/orcamento-domestico`) and **Metas** (`/metas`) | Household spending targets and progress by goal. |
| **Contas** (`/contas`) and **Faturas** (`/faturas`) | Manual or connected bank accounts, credit cards, balances, limits, and invoices. |
| **Transações** (`/transacoes`) and **Tags** (`/tags`) | Search, filters, classification rules, bulk actions, report exclusions, internal transfers, and tags. |
| **Carteira** (`/carteira`) | Assets and holdings, allocation targets, contribution suggestions, scoring questions, and a portfolio map. |
| **Open Finance** (`/open-finance`) | Pluggy connections, imported accounts, transactions, investments, and synchronization controls. |
| **Ferramentas** (`/ferramentas`) | First-million projection and an assets-versus-liabilities worksheet. |
| Perfil (`/perfil`) | Name, monthly income, objectives, and the financial month's start day. |
| **Configurações** (`/configuracoes`) | Integration credentials, Binance wallet selection, time zone, invitations for administrators, and app installation. |

The interface supports desktop and mobile.

## AI analysis through MCP

In **Configurações → Agentes de IA / MCP**, opt in to read-only financial analysis from ChatGPT, Codex, or compatible remote MCP clients. Each client requires separate OAuth consent and can be revoked; MCP does not edit financial data or trigger provider synchronization. See the [MCP connection and deployment guide](./docs/mcp.en.md) for permissions, client setup, privacy, and server configuration.

## Financial behavior

### Profile and financial month

In Perfil, configure your name, monthly income, objectives, and Início do Mês Financeiro, from day 1 to 28. Transactions before that day belong to the previous reference month, using the user's time zone. For example, with a start day of 5, a March 3 transaction belongs to the February reference period.

Changing that day or the time zone recalculates existing transactions that use automatic monthly references. Manually overridden references are preserved. The original transaction date does not change; the dashboard, goals, and history use the recalculated reference.

### Summaries, transactions, and tags

All consolidated reports use BRL. The dashboard cards appear in this order: **Saldo em conta → Entradas líquidas → Despesas líquidas → Resultado do período**.

- **Entradas líquidas** uses income that has no assigned goal.
- Within each goal and financial reference month, applied compensation is the smaller of its income and expenses.
- **Despesas líquidas** is gross expenses minus that applied compensation; the period result is net income minus net expenses.
- Goal-assigned income in excess of the goal's expenses does not increase available income. Different goals or reference months do not offset one another.
- Goal progress and monthly history use these net calculations. Matching for these summaries is by **goal and month**, not by tag.

Individual transactions retain their full amounts. **Saídas por dia** uses full BRL reporting amounts for its day cells, totals, and detail dialogs; foreign-currency entries also show their original amount. Entries assigned to the selected financial month but dated outside its calendar grid are listed separately.

**Transações por Tags** shows actual **Entrada** and **Saída** totals belonging to each tag. It does not distribute a goal's compensation across its tags. The donut's **Total movimentado** is inflows plus outflows, not the net period result. Multi-tag amounts are split equally in integer cents, with deterministic rounding.

The Transactions screen keeps gross inflows, outflows, and balance available for auditing. Hidden transactions, internal transfers, removed provider records, and amounts awaiting currency conversion follow the report-exclusion rules.

### Manual accounts and USD

Manual bank accounts and credit cards support BRL and USD.

- The account owns the currency; manual transactions inherit it. Currency can change only before the account has transactions, and Pluggy account currencies are provider-controlled.
- USD balances, limits, invoices, and transactions display USD as their native amount, with BRL equivalents for reporting.
- Current account balances use current USD/BRL rates. Historical transactions use a frozen rate for their date, with the preceding available close allowed up to seven days earlier.
- Yahoo supplies automatic FX. When required FX is unavailable, the form requests a manual rate before saving. Historical manual rates remain preserved; a manual current-balance fallback can later be replaced by automatic FX.
- Correcting **Saldo atual** establishes a new balance snapshot and absorbs previous manual transactions. Later edits or deletions of those absorbed transactions do not reverse amounts already included in the snapshot.
- New manual transactions have **Atualizar saldo da conta** enabled by default. Disabling it records history without changing the account balance. This choice is independent of tags, goals, and report visibility.
- USD balance changes update the native balance first, then its BRL equivalent using the account's current rate.
- A BRL↔USD transfer is recorded as two manual internal transactions. There is no automatic currency-exchange workflow.

### Account balances as investments

When editing a manual or connected bank account, enable **Classificar saldo como investimento** to send its positive balance for review in Carteira. Confirm the fixed-income class, family, indexation, product type and score; no product, rate or FGC coverage is assumed. BRL and USD groups remain separate.

The account remains the only source of the position's value. Balance changes and current FX update the linked holding; descriptive rates do not generate interest or transactions. Disabling the option removes the position from portfolio totals without losing its classification. The same money remains in **Saldo em conta**: portfolio exports and MCP identify this overlap, so do not add both representations as additional wealth. A contribution to this position is only planned, and is acknowledged after a native balance change, never after an FX-only change.

## Investment portfolio

- Allocation classes: international stocks, Brazilian stocks, FIIs, REITs, cryptoassets, Brazilian fixed income, international fixed income, and Store of value.
- Instrument type is separate from allocation class. ETFs can represent different exposures; store-of-value assets support domestic/international classification.
- Investment funds are also supported as a separate instrument (`MUTUAL_FUND`), distinct from ETFs, FIIs, and REITs. ETFs and funds allow selection of an exposure class and a manual score; connected holdings remain linked to provider data.
- Fixed-income groups organize individual positions by family and indexation. Positions expose issuer, product, rates, dates, values, and operations when available.
- User scores, classifications, and groups survive provider synchronization. Scoring questions can be customized.
- International assets display native values alongside BRL equivalents.
- Contributions accept BRL or USD and all eligible assets or only those in the selected currency. The calculation method is a per-user setting shared with MCP: [Improved (Melhorado)](docs/allocation/melhorado/README.md), the default, prioritizes class balance, then score proportions within each class, and finally budget use, with lot-aware allowances; [Diagrama do Cerrado](docs/allocation/diagrama-do-cerrado/README.md) reproduces the reconstructed AUVP logic. Calculation results stay in the browser and remain visible until Calculate is clicked again; only contributions awaiting provider synchronization are stored. Allocation accounts for existing positions, permits remainders and does not require proof of a global optimum.
- The “Usar todo o aporte” checkbox is available for BRL-only or USD-only contributions and is off by default for both methods. Leave it off to cap purchases at global class targets; enable it to keep those normal purchases and then distribute only the remainder beyond global targets, preserving relative target weights among eligible final holdings and score balance. Neither mode exceeds the budget; whole units and method rules may leave a remainder.
- International securities support fractional suggestions; equivalent B3 securities use whole units.
- Recorded contributions to unit-based Open Finance investments immediately update the temporary portfolio quantity, including accumulated contributions per institution/holding. Matching provider quantities restore automatic synchronization; partial matches confirm complete contributions in order, and unexplained differences require a choice. Fixed-income products such as CDBs, Binance holdings and bank-account balances retain their existing awaiting-sync behavior. See the [contribution synchronization guide](docs/open-finance-contributions.en.md).
- XLSX import and export are available. Portfolio imports are limited to 2 MB, 1,000 data rows, and 40 columns, with parsing in a Web Worker.

Contribution actions record portfolio activity in UOVP; they do not place broker or exchange orders.

### Cost, average price, and rates

- Invested cost has its own currency (`investedValueCurrency`), which may differ from the quote currency or BRL reporting currency. Legacy costs with unknown currencies are flagged; current FX does not reconstruct an unknown historical cost.
- Consolidated cost is displayed only when every holding has a reported cost in the same known currency. Missing data or incompatible currencies produce unavailable information, not zero cost or a sum of different currencies.
- Average price uses the provider's original invested amount when available; otherwise, connected holdings use summaries of imported purchases. Manual holdings use reported cost divided by quantity. Prices retain their currency; incomplete histories show Histórico parcial, and insufficient data does not produce an assumed price.
- The Rentabilidade column in fixed-income details displays descriptive rate terms, such as a percentage of a benchmark, a benchmark plus spread, or an annual rate. It is not a realized-return calculation and does not accrue interest automatically.

### XLSX import and export

Use an export from the portfolio itself as the header template. Numeric cells must contain numbers; purchase and maturity dates use `YYYY-MM-DD`. Preserve the exported ISO 8601 timestamp in `Data do câmbio`. Import limits are 2 MB, 1,000 data rows, and 40 columns.

| Columns | Usage |
| --- | --- |
| `ID da aplicação` | Identifies an existing manual holding owned by the user for updates. Preserve the ID when editing an export; provider-controlled holdings are not overwritten by import. |
| `Classe`, `Instrumento`, `Mercado` | Define allocation, instrument, and market. Exported values include `FIXED_INCOME`, `ETF`, `MUTUAL_FUND`, `Nacional`, and `Internacional`. |
| `Ticker`, `Nome`, `Quantidade`, `Preço`, `Moeda`, `Fracionado`, `Nota` | Identification, position, price, and classification for market assets. |
| `Família`, `Indexação`, `Emissor`, `Produto`, `Valor atual` | Required for fixed-income rows; also supply a valid `Catálogo ID` or `Tipo personalizado`. Legacy aggregate groups without individual holding details are not accepted. |
| `Valor investido`, `Moeda investimento` | Supply both or leave both empty. This currency describes cost, not necessarily the quote currency. |
| `Valor atual nativo`, `Câmbio para BRL`, `Data do câmbio` | Preserve the original value and its conversion for foreign-currency holdings with a manual value. Exported `Valor atual` is consolidated BRL and cannot be reinterpreted as a native amount. |
| `Formato da taxa`, `Indexador`, `Taxa`, `Data da compra`, `Vencimento` | Additional fixed-income holding details. |

A new foreign-currency holding with a manual value requires valid FX. On updates, existing FX can be reused only when the ID identifies the same manual holding and its currency has not changed. A workbook without IDs can be ambiguous when an asset has multiple manual holdings; preserve identifiers to avoid this situation.

### Connected investment corrections

Use **Editar informações** in Carteira or Open Finance to override a connected position's name and displayed issuer, plus product type, rate terms, purchase date, and maturity when applicable.

Overrides persist per user and position. The editor shows the effective values and the latest raw Pluggy values, with per-field restoration and **Restaurar tudo**. Synchronization continues to control the original data received from the institution, including monetary values, quantities, currency, status, identity fields, and operations. Converting a position to manual preserves its effective metadata.

Eligible Pluggy stock, ETF, FII, and REIT holdings support a Quantidade temporária override. The portfolio uses that quantity with the market quote while keeping the institution's original value separate. The correction persists across synchronization until restored; zero removes the holding from totals. It does not modify Pluggy, create movements, or confirm contributions awaiting synchronization.

When the institution's quantity changes from the acknowledged baseline, the app shows the previous, current, and manual quantities for review. Choose whether to retain the correction or use the institution's quantity again; replacement is not automatic. Disconnected connections, unavailable holdings, or excluded positions cannot receive new corrections.

### Caixinhas and reserved balances

Pluggy account `bankData.reservedBalances` can supply investments that are absent from the investments endpoint, including Mercado Pago Caixinhas.

- Each reserve and currency becomes a separate connected position.
- Positive positions appear in Open Finance and await classification in Carteira before entering portfolio totals.
- Detailed reserves take precedence over aggregate `automaticallyInvestedBalance`; the aggregate can provide a fallback when details are unavailable.
- Reserves are not added to available bank-account cash. Their classification does not automatically assume a CDB, RDB, or FGC guarantee.
- Values remain provider-controlled after classification. Complete snapshots can mark missing reserves unavailable; partial responses preserve prior values.
- These account-derived positions have no imported investment-operation history.

## Integrations

| Provider | Data | Credentials |
| --- | --- | --- |
| Pluggy | Accounts, cards, transactions, investments, and available investment operations. | Per-user Client ID, Client Secret, and webhook secret in Configurações. |
| brapi | B3 stocks, FIIs, and ETFs. | Per-user API key and plan in Configurações. |
| Yahoo Finance | International stocks, ETFs, REITs, and current/historical FX. | No user API key. |
| Binance public market data | Spot symbols and crypto prices, prioritizing BRL pairs with USDT conversion as needed. | No user API key. |
| Binance wallet | Private Spot, Funding, and Simple Earn balances. | Per-user HMAC API key and secret in Configurações. |

### Pluggy connections

**Sincronizar dados** imports the latest snapshot already available in Pluggy. **Atualizar banco** opens Pluggy Connect to request an institution update; the bank may require renewed authorization. Repeated snapshot imports do not guarantee newer bank data.

Connection names can be renamed locally. Disconnecting supports preserving imported positions as manual or removing them through the explicit resolution flow. Available fields and history depend on the institution and connector.

Each user configures a webhook secret in Configurações and registers it in their Pluggy application as the `x-pluggy-webhook-secret` header. The webhook URL is derived from `AUTH_URL`:

```text
https://your-domain.example/api/pluggy/webhook
```

Webhooks validate events, update immediate deletion/review state where needed, and mark connections pending. The full import runs through the normal synchronization flow.

### Binance wallet

One connection per user imports Spot, Funding, and Simple Earn flexible/locked quantities. The client tries the consolidated wallet endpoint and has separate Spot/Funding fallbacks.

Newly discovered assets require selection. A matching manual crypto position offers **Substituir manual**, **Manter ambos**, or **Ignorar**. Replacement preserves the old manual position for audit and excludes it from totals. Fiat is excluded; stablecoins remain selectable.

Tracked balances are provider-controlled. Prices use the public market pipeline; supported valuation can use a direct pair or BTC valuation fallback. Assets without a supported valuation cannot be tracked. Partial failures preserve the last values from failed wallets and keep synchronization pending.

Disconnecting can preserve Binance holdings as manual positions or remove imported holdings. Margin, Futures, Options, orders, trades, and withdrawal operations are not imported or executed.

Use an HMAC key with reading enabled. Read-only keys and server-IP restrictions are recommended; broader permissions show a warning but are accepted. Private requests originate on the application server. An HTTP 451 response is reported as a server region/IP access restriction; API-key IP allowlisting does not override that restriction.

## Automatic updates and caching

After the authenticated shell renders, a coordinator calls `POST /api/bootstrap-refresh`. It checks again when the app returns after at least 15 minutes in the background. Session storage throttles checks; server-side operation leases coordinate concurrent work.

Pluggy and Binance wallet synchronization run in parallel. The market-price check waits for both to finish, including partial failures, so it uses the synchronized positions and leaves market quotes as the final pricing step. Manual USD account FX runs independently. Pluggy reconciliation preserves the newest usable market quote; provider snapshot timestamps alone do not mark market prices as fresh.

| Integration | Automatic trigger | Scope |
| --- | --- | --- |
| Market prices | Any effective quote is missing or at least 12 hours old after checking shared cache and persisted data. | All eligible market holdings of that user. |
| Manual USD account FX | Current FX is missing or at least 12 hours old. | Active manual USD accounts; native balances are preserved. |
| Pluggy | Any active connection is pending, never synchronized, or at least 12 hours old. | All active Pluggy connections of that user. |
| Binance wallet | The connection is pending, never synchronized, or at least 12 hours old. | The configured wallet and its selected holdings. |

These operations return separate `SKIPPED`, `UPDATED`, `PARTIAL`, or `FAILED` results. Navigation renders immediately; changed data triggers a refresh, and failures retain prior values with a notice. Manual refresh buttons bypass the 12-hour freshness check and still obey operation limits. There is no scheduled job that keeps refreshing a closed app.

Choose your brapi plan in Configurações: Free (the default) sends one B3 symbol per request, with one request at a time; Startup uses batches of up to 10 symbols and up to 4 simultaneous requests; Pro uses batches of up to 20 symbols and up to 16 simultaneous requests. The preference belongs to each user and can be changed without replacing the key; it does not change the subscription with brapi. Shared cache remains per symbol and avoids requests for already cached quotes outside an explicit refresh. Market refresh isolates invalid symbols within each batch. A brapi failure does not prevent Yahoo or Binance price updates.

### Prices and logos

Redis is optional and stores public catalogs, metadata, quotes, current FX, and short-lived coordination keys. Private balances, transactions, credentials, sessions, Pluggy snapshots, and Binance wallet responses stay outside that shared cache.

Logo URLs also have durable PostgreSQL storage in `MarketAssetMetadata`. Verified shared URLs take precedence over older holding URLs; usable URLs have no time-based expiry, and missing results generally have a 24-hour retry window. Browser load failures can trigger resolution and persistence of a corrected URL. Only URLs are stored, not image files.

Price refreshes do not perform a logo search or replace saved logos. Metadata resolution is separate. Without Redis, durable logo metadata remains available from PostgreSQL, and market requests can fall back to providers.

## Installable app

In **Configurações → Instalar UOVP**, supported Chromium browsers offer an installation prompt. On iOS/iPadOS Safari, use **Compartilhar → Adicionar à Tela de Início**. An installed session opens in standalone mode.

The manifest includes standard/maskable icons and starts at `/home?source=pwa`. Installation requires a suitable browser and secure origin. There is no service worker, offline mode, push notification support, or background sync; an internet connection is required.

## Technology and requirements

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, and shadcn/ui-style components.
- Prisma 7 with PostgreSQL; optional Redis.
- Auth.js credentials authentication, Lucide, Recharts, Leaflet, and React Leaflet.
- Vitest for unit/integration tests and Cypress for browser tests.
- Node.js 24 (see `.nvmrc`), pnpm 12.16.1, and PostgreSQL 18.4.
- Python 3 for CI/deployment script tests; it is not required to run the application.
- Optional Docker Compose for PostgreSQL 18.4 and Redis 7.2.15, matching the development and production services.

## Local setup

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Replace every credential placeholder. Run the first command separately for `AUTH_SECRET` and `AUTH_RATE_LIMIT_PEPPER`; use the second for a 32-byte encryption key:

   ```bash
   openssl rand -base64 48
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
   ```

   Set `CREDENTIAL_ENCRYPTION_KEYS="v1:<generated-key>"` and `CREDENTIAL_ENCRYPTION_ACTIVE_KEY="v1"`. Keep database/Redis passwords consistent with their URLs; URL-encode special characters in connection strings.

   To enable MCP, generate another independent 32-byte key in unpadded base64url:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Set `MCP_OAUTH_SIGNING_KEYS="v1:<new-key>"` and `MCP_OAUTH_ACTIVE_KEY="v1"`. Do not reuse authentication, encryption, or provider secrets. Leaving the keyring empty keeps MCP unavailable, but the complete Cypress suite requires this configuration.

3. Start local services, or configure external ones:

   Existing PostgreSQL 16 installations need a logical backup from the old service and a restore into PostgreSQL 18.4. Compose uses the separate `uovp_postgres18` volume mounted at `/var/lib/postgresql`, following the [PostgreSQL 18 image layout](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata). Keep the old `uovp_postgres` volume until the restore is verified. Changing the image or running Prisma migrations does not upgrade PostgreSQL 16 data files.

   ```bash
   docker compose up -d postgres redis
   ```

4. Install dependencies, generate Prisma Client, apply committed migrations, and seed catalogs:

   ```bash
   pnpm install --frozen-lockfile
   pnpm db:generate
   pnpm exec prisma migrate deploy
   pnpm db:seed
   ```

5. Start the app:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000). The first registered user becomes administrator; later registration requires an invitation created by the administrator.

Use pnpm consistently. `pnpm db:migrate` runs `prisma migrate dev` for developing new schema changes; `prisma migrate deploy` applies existing migrations. Prisma configuration and seeding are defined in `prisma.config.ts`; the generated client in `generated/prisma` is excluded from Git. After a schema change, run `pnpm db:generate` explicitly. Cypress uses an installed Google Chrome browser. See the [dependency upgrade notes](docs/dependency-upgrades.md) for toolchain compatibility.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Local Compose database settings. |
| `DATABASE_URL` | Prisma PostgreSQL connection string. |
| `REDIS_PASSWORD`, `REDIS_PORT` | Local Compose Redis settings. |
| `REDIS_URL` | Optional shared public-data cache. Leave unset when not using Redis. |
| `SHARED_CACHE_NAMESPACE` | Redis namespace; defaults to `uovp:shared:v1`. |
| `AUTH_SECRET` | Independent high-entropy Auth.js signing secret, at least 32 characters. |
| `AUTH_RATE_LIMIT_PEPPER` | Independent secret for authentication rate limits. |
| `AUTH_URL` | Canonical origin: localhost in development, public HTTPS in production. |
| `AUTH_TRUST_HOST`, `AUTH_TRUST_PROXY` | Both must be `true` at production runtime; configure a trusted reverse proxy accordingly. Local example values are `false`. |
| `CREDENTIAL_ENCRYPTION_ACTIVE_KEY` | Identifier of the active credential encryption key. |
| `CREDENTIAL_ENCRYPTION_KEYS` | Comma-separated keyring, e.g. `v1:<base64url-key>,v2:<base64url-key>`; each decoded key must be exactly 32 bytes. |
| `MCP_OAUTH_ACTIVE_KEY` | Identifier of the active MCP OAuth signing key, e.g. `v1`. |
| `MCP_OAUTH_SIGNING_KEYS` | Independent MCP keyring, e.g. `v1:<base64url-key>`; each key must be 32 bytes encoded as 43 unpadded base64url characters. Required to enable MCP and its browser tests. |
| `UOVP_TEST_REDIS_URL` | Tests only: isolated loopback Redis for the cross-process coordination suite. Export it explicitly; `REDIS_URL` does not replace it. |

brapi, Pluggy, and Binance wallet credentials are entered per user in Configurações, not as shared environment variables. Yahoo and Binance public quotes require no user credentials.

## Validation

Prepare a dedicated test database with migrations and seed applied, plus an isolated test Redis, before running the suites that use them. Export `DATABASE_URL`, `REDIS_URL`, and `UOVP_TEST_REDIS_URL` for test processes; both Redis URLs must point to the test service. `UOVP_TEST_REDIS_URL` accepts only loopback hosts, such as `127.0.0.1` and `localhost`.

Also provide authentication secrets, the encryption keyring, and independent MCP keys to the test app and processes that need them. The `.env` loaded by Next.js does not replace exported variables for Vitest or Cypress tasks. For local Cypress, keep `AUTH_URL` and the development app at `http://localhost:3000`; CI production runs use the HTTPS proxy described below.

```bash
pnpm db:generate
python3 -m unittest discover -s tests/ci
pnpm typecheck
pnpm test
pnpm test:integration
pnpm cypress:run
pnpm lint
pnpm build
```

- `pnpm test` covers `tests/unit`; `pnpm test:integration` covers `tests/integration`.
- Database integration suites skip without `DATABASE_URL`; the cross-process coordination suite skips without `UOVP_TEST_REDIS_URL`, even when the database is configured. A run with skipped tests does not prove complete validation.
- The Python command covers branch synchronization and deployment guards in `tests/ci`, including rejection of superseded commits and concurrency scenarios. CI also runs it in the Code quality job.
- Cypress expects a running app at `http://localhost:3000`. The app and Cypress tasks must use the same test database and required secrets.
- Cypress creates/removes test users and clears authentication-limit fixtures. Do not run it against production.
- `pnpm cypress:open` opens the interactive runner; `pnpm test:watch` runs Vitest in watch mode.
- `pnpm build` generates Prisma Client and builds Next.js; it does not apply migrations or seed the database.

### Continuous integration and deployment

GitHub Actions runs typecheck, lint, unit tests, integration tests, a production build, and Cypress on pushes to `dev`/`main` and pull requests targeting either branch. Integration and browser jobs use disposable PostgreSQL 18.4 and Redis 7.2.15 services, migrated and seeded independently. CI generates temporary authentication/encryption secrets and rejects skipped integration tests.

Cypress tests the built app through a temporary local HTTPS proxy at `https://uovp-ci.test:8443`, preserving production security validation. Failed browser checks upload screenshots and server logs.

The `CI passed` check requires every validation job to succeed. Protection on `main` requires a pull request, this check against an up-to-date base, and resolved review conversations; force pushes and branch deletion are disabled. No additional reviewer approval is required.

Dev deploys only after CI passes on `dev`. Coolify's direct push deployment is disabled. The deployment job pins the tested commit before invoking the checked-in copy of Gustavo's `coolify-deploy` CLI, waits for completion, and checks dev health. Superseded commits are skipped. Production keeps its existing Coolify deployment on `main` after a protected merge.

After CI passes, equal `dev` and `main` source trees put the dev app, Redis and PostgreSQL to sleep while preserving all volumes. New tested changes wake the dependencies before deployment. Use the manual CI input `dev_mode=deploy` to activate dev even when the branches match. See the [dev lifecycle guide](docs/dev-environment-lifecycle.md).

After a `dev` → `main` PR merges, `Sync dev after merge` moves `dev` to the same commit as `main`, including after squash merges. It skips if either branch has advanced and uses an exact `--force-with-lease` to protect concurrent dev pushes. If main advances during the push, the workflow reports a failure and withholds CI dispatch until the branches are reconciled. Otherwise it explicitly dispatches CI on `dev`; deployment still waits for all checks. A failed dispatch can be retried from Actions using the merged PR number. The workflow runs only trusted main code and does not change main protection. Before resuming local work after synchronization, save local changes and align your local `dev` with `origin/dev`; do not push its old history back.

The GitHub `development` environment only allows the `dev` branch. It contains `COOLIFY_URL` and `COOLIFY_DEV_APP_UUID` variables and a `COOLIFY_TOKEN` secret with Coolify `read`, `write`, and `deploy` permissions. Write access is required to pin the exact commit because the installed restart API does not accept a commit parameter. The token is available only to the deployment job; pull request validation uses no deployment credentials. Rotate it before expiry.

## Production and maintenance

Deploy through Coolify with the application's public HTTPS origin and private PostgreSQL/Redis services. The included Compose file runs only the local data services, not the application.

Configure installation with `pnpm install --frozen-lockfile`, build with `pnpm build`, and start with `pnpm start`. Apply `pnpm exec prisma migrate deploy` in the release process before serving code that needs the new schema. Run `pnpm db:seed` for initial catalogs and when catalog changes require it; the seed also rebuilds global default question templates.

- Production runtime requires `AUTH_TRUST_HOST=true`, `AUTH_TRUST_PROXY=true`, and a public HTTPS `AUTH_URL`. The reverse proxy must sanitize client-supplied forwarding headers.
- Keep database and Redis ports private. The local Compose services bind to `127.0.0.1`.
- Optional Redis uses `allkeys-lru` with a memory limit; durable cache persistence is not required.
- `GET /api/health` is a process health endpoint; it does not verify database or provider availability.
- Back up PostgreSQL and retain the encryption keyring before migrations or connection/data maintenance.
- During key rotation, keep old keys available, add the new key, and change `CREDENTIAL_ENCRYPTION_ACTIVE_KEY`. Credentials are re-encrypted as they are used.
- `pnpm db:studio` opens Prisma Studio. Keep it local or behind a private tunnel.
- `pnpm fx:backfill` processes unresolved foreign-currency Pluggy transactions in batches of 500, preserving existing and manual conversions. Export `DATABASE_URL` for this script; unresolved rates remain pending.
- There is no self-service password-reset flow in the current app.

### Diagnostics and repairs

Export `DATABASE_URL` for the database being inspected and apply the required migrations. These are maintenance commands, not part of normal startup. Without `--apply`, all commands below only preview changes. Back up before applying repairs and use `--user-id=ID` to limit inspection to one person; without that filter, the scripts traverse applicable users or records.

| Preview command | Purpose and limits |
| --- | --- |
| `pnpm exec tsx scripts/repair-finance-setup.ts` | In apply mode, creates only missing financial configuration; preserves customizations and reports name conflicts for review. |
| `pnpm exec tsx scripts/repair-financial-references.ts` | Recalculates automatic monthly references from the user's financial start day and time zone; preserves manual reference overrides. |
| `pnpm exec tsx scripts/repair-purchase-summaries.ts` | Rebuilds quantity and cost summaries of imported Pluggy purchases. Requires the purchase-summary migration and coordinates concurrent updates. |
| `pnpm exec tsx scripts/repair-financial-integrity.ts` | Diagnoses orphaned or ambiguous external holdings and reporting amounts. Repairs only proven BRL/NATIVE/1 reporting snapshots; external holdings are never merged or deleted. Accepts `--batch-size=100`. |

Example preview and application for one user:

```bash
pnpm exec tsx scripts/repair-financial-references.ts --user-id=ID
pnpm exec tsx scripts/repair-financial-references.ts --user-id=ID --apply
```

Concurrently changed records may be preserved or reported for another inspection, depending on the script. See the [MCP guide](./docs/mcp.en.md) for cleanup of ended OAuth records and the `pnpm fx:backfill` command described above for pending historical conversions.

## Code map

| Path | Responsibility |
| --- | --- |
| `app/(app)`, `app/(auth)`, `app/api` | Authenticated pages, authentication pages, and API handlers. |
| `features/finance` | Accounts, transactions, FX, classification, and financial reporting. |
| `features/portfolio` | Holdings, allocation, market data, logos, and Binance wallet sync. |
| `features/open-finance` | Pluggy import, reconciliation, Caixinhas, and investment overrides. |
| `features/balance-sheet` | Financial tools. |
| `components/layout`, `components/pwa` | App shell, refresh coordinator, and installation UI. |
| `lib` | Authentication helpers, authorization, operation leases, encryption, and shared cache. |
| `prisma`, `scripts` | Schema, migrations, catalogs, and maintenance utilities. |
| `tests`, `cypress` | Unit, integration, and browser coverage. |

## Security model

The server resolves ownership from the authenticated session. Financial mutations use scoped queries, transactions, and operation controls. Passwords use bcrypt; JWT sessions have a revocation version. Registration becomes invitation-only after the administrator bootstrap.

brapi, Pluggy, and Binance wallet credentials use versioned AES-256-GCM encryption bound to the user and credential type. Authentication and webhook limits are stored in PostgreSQL. Integration logs record anonymized users, status, duration, and counts rather than credential contents or complete financial payloads.
