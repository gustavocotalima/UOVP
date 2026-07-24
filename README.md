# UOVP Finance

[Português (Brasil)](./README.pt-BR.md)

**Uma Outra Verdade Possível** — a multi-user personal finance application for household budgeting, investment portfolio management, and Open Finance aggregation.

UOVP keeps the frontend and backend in the same Next.js application. Financial records are persisted in PostgreSQL, private integrations are isolated per user, and market quotes may be cached and shared without exposing portfolio data.

## Features

### Household finances

- Dashboard, monthly budget, goals, accounts, credit cards, invoices, transactions, and tags.
- Manual and Pluggy-synchronized financial records.
- Deterministic transaction classification with per-user rules.
- Historical currency conversion to BRL, with manual review when no reliable rate is available.
- Internal-transfer detection and review of transactions removed by the provider.

### Investment portfolio

- Portfolio targets, allocation charts, contribution suggestions, scoring questions, and a risk map.
- Stocks, ETFs, FIIs, REITs, mutual funds, cryptoassets, and fixed-income groups with collapsible holdings.
- Separate instrument type and allocation exposure, allowing an ETF to count toward another allocation class.
- Pluggy positions reconciled with the diagram while preserving user scores and classification overrides.
- Contributions to Pluggy-controlled positions remain pending until a later synchronization confirms them.
- XLSX import and export.

### Integrations

- **Pluggy:** per-user Open Finance credentials for accounts, cards, transactions, and investments.
- **brapi:** Brazilian stocks, FIIs, and ETFs; every user provides their own API key.
- **Yahoo Finance:** keyless international stocks, REITs, ETFs, and BRL foreign-exchange data.
- **Binance:** keyless public Spot catalog and cryptoasset quotes, prioritizing BRL pairs.

### Multi-user security

- Invitation-only registration.
- Auth.js credential authentication with JWT session revocation.
- Per-user authorization on financial operations and provider connections.
- Versioned AES-256-GCM encryption for brapi and Pluggy credentials.
- Database-backed authentication and webhook rate limits.

## Technology

- Next.js 16 App Router, React 19, and TypeScript
- Tailwind CSS and shadcn/ui-style components
- Lucide, Recharts, Leaflet, and React Leaflet
- PostgreSQL and Prisma
- Auth.js
- Vitest and Cypress
- pnpm

## Requirements

- Node.js 20.9 or newer
- pnpm 10.13.1
- PostgreSQL 16 or a compatible version
- Docker and Docker Compose, optionally, for the local PostgreSQL service

## Local setup

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Replace every credential placeholder. Generate independent secrets, for example:

   ```bash
   openssl rand -base64 48
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
   ```

   Use separate values for `AUTH_SECRET`, `AUTH_RATE_LIMIT_PEPPER`, and each entry in `CREDENTIAL_ENCRYPTION_KEYS`.

3. Start PostgreSQL with Docker Compose, or provide another PostgreSQL instance:

   ```bash
   docker compose up -d postgres
   ```

4. Install dependencies:

   ```bash
   pnpm install
   ```

5. Apply migrations and seed global catalogs, presets, and default questions:

   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

6. Start the development server:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

The project is pnpm-only. Do not install dependencies with npm or Yarn.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Local Docker Compose PostgreSQL configuration. |
| `DATABASE_URL` | Prisma PostgreSQL connection string. |
| `AUTH_SECRET` | Auth.js signing secret; use an independent high-entropy value. |
| `AUTH_RATE_LIMIT_PEPPER` | Pepper used by database-backed authentication limits. |
| `AUTH_URL` | Canonical application origin, such as `http://localhost:3000` locally or the public HTTPS origin in production. |
| `AUTH_TRUST_HOST` | Enables trusted-host behavior when the deployment topology requires it. |
| `AUTH_TRUST_PROXY` | Enables trusted proxy headers. Only use it behind a correctly configured reverse proxy. |
| `APP_ADMIN_EMAILS` | Comma-separated administrators allowed to create and revoke registration invitations. |
| `CREDENTIAL_ENCRYPTION_ACTIVE_KEY` | Active key identifier used for new credential encryption. |
| `CREDENTIAL_ENCRYPTION_KEYS` | Versioned keyring in `key-id:base64url-key` format. |

brapi and Pluggy credentials are not shared server-wide. Each user configures them in **Settings**. Yahoo Finance and Binance market data do not require user credentials.

### Pluggy webhooks

Each user creates a webhook secret in **Settings** and registers the same value in their Pluggy application using the `x-pluggy-webhook-secret` header. The secret is encrypted at rest and is never returned in full after it is stored.

The webhook URL is derived from `AUTH_URL`:

```text
https://your-domain.example/api/pluggy/webhook
```

## Database maintenance

Use Prisma migrations for schema changes:

```bash
pnpm db:migrate
```

After applying the historical-FX migration to an existing database, process unresolved conversions in idempotent batches:

```bash
pnpm fx:backfill
```

The backfill preserves frozen conversions and manual rates. Transactions without a reliable historical pair remain pending for user review.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm test:integration
pnpm cypress:run
pnpm lint
pnpm build
```

Integration tests require a test database available through `DATABASE_URL`. Cypress expects the application at `http://localhost:3000`.

## Production notes

- Use a public HTTPS origin in `AUTH_URL`.
- Enable `AUTH_TRUST_HOST` and `AUTH_TRUST_PROXY` only behind a trusted proxy that removes client-supplied `Forwarded` and `X-Forwarded-For` headers.
- Keep PostgreSQL on a private network. The included Compose file binds it only to `127.0.0.1`.
- Do not reuse local database credentials in production.
- During encryption-key rotation, keep the previous key in `CREDENTIAL_ENCRYPTION_KEYS`, add the new key, and switch `CREDENTIAL_ENCRYPTION_ACTIVE_KEY`. Stored credentials are re-encrypted on later use.

## Security model

The server resolves the user from the authenticated session; financial mutations do not trust a browser-supplied user ID. Imports, contribution execution, synchronization, and bulk changes use scoped queries and transactions. Uploaded spreadsheets are limited to 2 MB and parsed in a disposable Web Worker with a timeout.
