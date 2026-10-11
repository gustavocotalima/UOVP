# UOVP MCP connection

[Português (Brasil)](./mcp.pt-BR.md)

UOVP exposes a private, read-only Model Context Protocol (MCP) server for financial analysis. Each UOVP user must enable access and authorize each client separately. No public plugin-directory publication or OpenAI API key is required by UOVP.

## What agents can do

- Read permitted financial summaries, budgets, goals, account balances, cards, invoices, and transactions.
- Analyze portfolio allocation, holdings, available operations, scores, and effective investment metadata.
- Preview contribution allocations without saving or executing an investment.
- Read the separately maintained assets/liabilities worksheet.
- Retrieve data timestamps and incomplete-data warnings.

Agents cannot edit records, change balances, place trades, execute transfers, trigger bank synchronization, or retrieve provider credentials. Authentication grants and access audit records are persisted; financial analysis reads do not create financial defaults or records.

## Enable access in UOVP

1. Open **Configurações → Agentes de IA / MCP**.
2. Select **Habilitar MCP**. This enables authorization; it does not grant a client access automatically.
3. Copy the displayed MCP URL. For the production installation it is:

   ```text
   https://uovp.cotalima.com.br/api/mcp
   ```

4. Add that URL to your AI client using **Streamable HTTP** and **OAuth**.
5. When the client opens UOVP, sign in and review its name, callback, and requested permissions. Select only the information you want to share, then **Autorizar leitura**.

If the server-configuration warning is displayed, an administrator must complete the OAuth deployment configuration first.

## Permissions

| Scope | Information shared |
| --- | --- |
| `finance:read` | Financial summaries, budgets, goals, monthly history, tag flows, and daily expenses. |
| `accounts:read` | Account balances, credit-card limits, invoices, and FX information. |
| `transactions:read` | Individual transaction amounts, descriptions, dates, account labels, and classification. |
| `portfolio:read` | Portfolio positions, allocation, available operations, scores, metadata, and non-saving simulations. |
| `balance-sheet:read` | The separately maintained assets/liabilities worksheet. |

A client ID is an identifier, not a password or authorization. Permission checks apply to every request and record lookup; clients cannot select another UOVP user.

## Codex

For a compatible Codex CLI, add the remote server and start OAuth login:

```bash
codex mcp add uovp --url https://uovp.cotalima.com.br/api/mcp
codex mcp login uovp
```

Complete UOVP's authorization page in the browser. `codex mcp list` shows the configured server; the `/mcp` command in the CLI shows the active tools. See the [official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) for client-version and configuration details.

If the client requires pre-registration, use **Cliente personalizado / configuração avançada** in UOVP. Register the callback reported by the client, then add the returned Client ID:

```bash
codex mcp add uovp --url https://uovp.cotalima.com.br/api/mcp --oauth-client-id YOUR_CLIENT_ID
codex mcp login uovp
```

Native callbacks use `http://127.0.0.1/callback` with the client-selected loopback port. Match the displayed host and path; do not use wildcards or a guessed callback. HTTPS callbacks must match the registered URL exactly.

## ChatGPT

On ChatGPT web, open **Plugins → + → Add custom MCP server**, provide UOVP's URL, select OAuth, and follow the linking flow. Install the resulting private plugin before using it in a conversation. Account/workspace policy may restrict custom connections. These steps are described in the [official custom MCP server guide](https://developers.openai.com/api/docs/guides/custom-mcp-server).

ChatGPT web does not read local Codex MCP configuration. Configure and authorize it separately. If a provided-client configuration is required, register the exact callback displayed by ChatGPT and use the returned UOVP Client ID; a public client does not have a client secret.

## Other agents

Use a client that supports authenticated remote MCP over Streamable HTTP and Authorization Code with PKCE `S256`. It must follow UOVP's OAuth discovery, preserve the requested `resource`, and handle expiration and revocation. For clients without supported automatic identification, register their exact callbacks in UOVP.

There is no API-key or fixed bearer-token input for users, and a browser login cookie does not authorize MCP requests.

## Financial meaning and freshness

- Reports consolidate in BRL. Foreign-currency accounts and positions include native values and the relevant BRL equivalents.
- Transaction reporting rates stay historical; current account FX is not substituted into past transactions.
- Summaries and goal progress use UOVP's existing same-goal, same-month net compensation. Calendar transactions retain full reporting amounts; tag flows represent actual entries and exits.
- Report exclusions, internal transfers, missing FX, provider availability, and review/tracking states retain the application's rules.
- Effective investment metadata is distinguished from the latest original provider metadata. Missing history does not imply a complete return calculation.
- Responses identify their retrieval time, relevant stored sync/price/FX timestamps, and missing or incomplete coverage. Unknown amounts are not silently treated as zero.
- MCP reads do not call Pluggy, Binance wallet sync, or market refresh. If data is stale, update it in UOVP and ask the agent again. The normal authenticated app still has its existing automatic update coordinator.
- Lists are bounded and paginated. An agent must follow pagination for complete record lists; aggregates are calculated across their requested scope, not just one returned page.

Example questions:

> Compare this month's net expenses with last month and explain the largest changes. Keep gross transaction values separate from net goal compensation.

> Compare my portfolio with its target allocations and preview an aporte of R$ 1.500 without saving anything. Warn me about missing prices or incomplete data.

## Revoke and privacy

In **Agentes autorizados**, use **Revogar acesso** for one client or **Revogar todos**. **Desabilitar MCP** also revokes existing access. A client needs new consent afterward. Signing out of the ordinary UOVP browser session is not the same as revoking an agent.

Financial information requested under your permissions is sent to the chosen AI provider and governed by its policies. Revocation blocks future retrieval; it cannot retract information already received or remove it from earlier conversations. Provider secrets, CPF, full account/card numbers, and complete provider payloads are not exposed by MCP DTOs.

## Server configuration and deployment

Use Node.js 22 or newer and deploy through the existing Coolify release process. Back up PostgreSQL and apply the MCP migration before serving the feature. Access remains disabled for each user until they opt in.

| Variable | Purpose |
| --- | --- |
| `AUTH_URL` | Canonical public HTTPS origin; OAuth resources and callbacks use this origin. Local loopback HTTP is for development only. |
| `MCP_OAUTH_SIGNING_KEYS` | Independent signing keyring, e.g. `v1:<base64url-key>`; each decoded key is exactly 32 bytes. |
| `MCP_OAUTH_ACTIVE_KEY` | Identifier of the active signing key, e.g. `v1`. |

Generate fresh, independent key material with a cryptographically secure generator. Do not reuse `AUTH_SECRET`, credential-encryption keys, or provider credentials. Store signing material only in the server's secret manager. During rotation, keep existing keys until affected tokens are no longer valid and choose the new active key.

Keep PostgreSQL private and do not cache private financial responses in shared Redis or a CDN. OAuth/MCP responses must not be publicly cached. The reverse proxy must preserve the canonical HTTPS origin and Authorization headers. No additional public port is required.

Discovery is exposed at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/api/mcp` (with a root protected-resource alias). Authorization uses `/mcp/authorize`; token exchange and revocation use `/api/mcp/oauth/token` and `/api/mcp/oauth/revoke`.

Authorization codes expire after five minutes. Access tokens expire after 15 minutes; refresh tokens rotate and expire after 30 days. MCP requests are limited to 60 per user per minute and 120 per user/client pair per minute. List pages default to 50 records and allow at most 100; detailed queries span at most 12 months. Minimal access audit entries have a 30-day retention window, with expired entries cleaned up during subsequent activity.

## Troubleshooting

- **Configuration warning:** verify the canonical origin and independent OAuth keyring, then redeploy.
- **Authorization unavailable:** confirm MCP is enabled for the logged-in UOVP user. Retry linking from the client rather than reusing an old authorization URL.
- **Callback rejected:** register the exact HTTPS URL, or supported native loopback host/path, reported by the client.
- **Unauthorized or revoked:** perform OAuth login again. Do not paste browser cookies or provider API keys into the client.
- **A tool is missing or denied:** check its permission scope and reconnect with the appropriate consent.
- **Values differ between calls:** inspect retrieval and provider timestamps; separate calls are not a shared frozen snapshot.
- **Incomplete prices/history:** refresh or correct data through UOVP. The agent must retain incomplete-data warnings rather than inventing missing values.

## Validation

Use a dedicated migrated test database and independent test secrets. Validate OAuth, scope/ownership isolation, revocation, protocol compatibility, calculation parity, pagination, and absence of financial writes/provider calls. Run typecheck, unit/integration tests, Cypress, lint, and production build before deployment. Real-client linking must also be checked in the target ChatGPT/Codex account; automated tests do not establish account-level feature availability.
