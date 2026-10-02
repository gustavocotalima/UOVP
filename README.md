# UOVP Finance

[Português (Brasil)](./README.pt-BR.md)

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
| **Configurações** (`/configuracoes`) | Integration credentials, Binance wallet selection, time zone, invitations for administrators, and app installation. |

The layout supports desktop and mobile, with mobile navigation and safe-area spacing.

## Financial behavior

### Summaries, transactions, and tags

All consolidated reports use BRL. The dashboard cards appear in this order: **Saldo em conta → Entradas líquidas → Despesas líquidas → Resultado do período**.

- **Entradas líquidas** uses income that has no assigned goal.
- Within each goal and financial reference month, applied compensation is the smaller of its income and expenses.
- **Despesas líquidas** is gross expenses minus that applied compensation; the period result is net income minus net expenses.
- Goal-assigned income in excess of the goal's expenses does not increase available income. Different goals or reference months do not offset one another.
- Goal progress and monthly history use these net calculations. Matching for these summaries is by **goal and month**, not by tag.

Individual transactions retain their full amounts. **Saídas por dia** uses full BRL reporting amounts for its day cells, totals, and detail dialogs; foreign-currency entries also show their original amount. Entries assigned to the selected financial month but dated outside its calendar grid are listed separately.

**Transações por Tags** shows actual **Entrada** and **Saída** totals belonging to each tag. It does not distribute a goal's compensation across its tags. Entries use a shade 20% lighter than the tag's outflow color. The donut's **Total movimentado** is inflows plus outflows, not the net period result. Multi-tag amounts are split equally in integer cents, with deterministic rounding.

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

## Investment portfolio

- Allocation classes: international stocks, Brazilian stocks, FIIs, REITs, cryptoassets, Brazilian fixed income, international fixed income, and **Reserva de valor**.
- Instrument type is separate from allocation class. ETFs can represent different exposures; store-of-value assets support domestic/international classification.
- Fixed-income groups organize individual positions by family and indexation. Positions expose issuer, product, rates, dates, values, and operations when available.
- User scores, classifications, and groups survive provider synchronization. Scoring questions can be customized.
- International assets display native values alongside BRL equivalents.
- Contributions accept BRL or USD and a choice of all eligible assets or only assets matching the selected currency. Restricted suggestions redistribute within eligible classes while respecting their target caps; rounding or insufficient eligible capacity can leave an unallocated amount.
- International securities support fractional suggestions; equivalent B3 securities use whole units.
- Contributions to provider-controlled positions await later synchronization before updating the observed quantity. For Pluggy, a newer snapshot with a changed quantity can clear the pending state.
- XLSX import and export are available. Portfolio imports are limited to 2 MB, 1,000 data rows, and 40 columns, with parsing in a Web Worker.

Contribution actions record portfolio activity in UOVP; they do not place broker or exchange orders.

### Connected investment corrections

Use **Editar informações** in Carteira or Open Finance to override a connected position's name and displayed issuer, plus product type, rate terms, purchase date, and maturity when applicable.

Overrides persist per user and position. The editor shows the effective values and the latest raw Pluggy values, with per-field restoration and **Restaurar tudo**. Synchronization continues to control monetary values, quantities, currency, status, identity fields, and imported operations. Converting a position to manual preserves its effective metadata.

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
| brapi | B3 stocks, FIIs, and ETFs. | Per-user API key in Configurações. |
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

brapi normally receives the user's B3 symbols together in one authenticated quote request. Invalid-symbol failures can cause smaller retry requests. A brapi failure does not prevent Yahoo or Binance price updates.

### Prices and logos

Redis is optional and stores public catalogs, metadata, quotes, current FX, and short-lived coordination keys. Private balances, transactions, credentials, sessions, Pluggy snapshots, and Binance wallet responses stay outside that shared cache.

Logo URLs also have durable PostgreSQL storage in `MarketAssetMetadata`. Verified shared URLs take precedence over older holding URLs; usable URLs have no time-based expiry, and missing results generally have a 24-hour retry window. Browser load failures can trigger resolution and persistence of a corrected URL. Only URLs are stored, not image files.

Price refreshes do not perform a logo search or replace saved logos. Metadata resolution is separate. Without Redis, durable logo metadata remains available from PostgreSQL, and market requests can fall back to providers.

## Installable app

In **Configurações → Instalar UOVP**, supported Chromium browsers offer an installation prompt. On iOS/iPadOS Safari, use **Compartilhar → Adicionar à Tela de Início**. An installed session opens in standalone mode.

The manifest includes standard/maskable icons and starts at `/home?source=pwa`. Installation requires a suitable browser and secure origin. There is no service worker, offline mode, push notification support, or background sync; an internet connection is required.

## Technology and requirements

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, and shadcn/ui-style components.
- Prisma 6 with PostgreSQL; optional Redis.
- Auth.js credentials authentication, Lucide, Recharts, Leaflet, and React Leaflet.
- Vitest for unit/integration tests and Cypress for browser tests.
- Node.js **20.9 or newer**, **pnpm 10.13.1**, and PostgreSQL 16 or compatible.
- Optional Docker Compose for the included PostgreSQL 16 and Redis 8 services.

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

3. Start local services, or configure external ones:

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

Use pnpm consistently. `pnpm db:migrate` runs `prisma migrate dev` for developing new schema changes; `prisma migrate deploy` applies existing migrations.

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

brapi, Pluggy, and Binance wallet credentials are entered per user in Configurações, not as shared environment variables. Yahoo and Binance public quotes require no user credentials.

## Validation

```bash
pnpm db:generate
pnpm typecheck
pnpm test
pnpm test:integration
pnpm cypress:run
pnpm lint
pnpm build
```

- `pnpm test` covers `tests/unit`; `pnpm test:integration` covers `tests/integration`.
- Export `DATABASE_URL` for the test processes and point it at a dedicated migrated test database. Integration suites conditionally skip when it is absent; a skipped run is not database validation.
- Cypress expects a running app at `http://localhost:3000`. The app and Cypress tasks must use the same test database and required secrets.
- Cypress creates/removes test users and clears authentication-limit fixtures. Do not run it against production.
- `pnpm cypress:open` opens the interactive runner; `pnpm test:watch` runs Vitest in watch mode.
- `pnpm build` generates Prisma Client and builds Next.js; it does not apply migrations or seed the database.

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
