# UOVP Finanças

[English](./README.md)

**Uma Outra Verdade Possível** — uma aplicação financeira pessoal multiusuário para orçamento doméstico, gestão de carteira de investimentos e agregação via Open Finance.

A UOVP mantém frontend e backend na mesma aplicação Next.js. Os registros financeiros são persistidos no PostgreSQL, as integrações privadas são isoladas por usuário e as cotações de mercado podem ser compartilhadas em cache sem expor dados das carteiras.

## Funcionalidades

### Finanças domésticas

- Painel, orçamento mensal, metas, contas, cartões, faturas, transações e tags.
- Registros financeiros manuais e sincronizados pela Pluggy.
- Classificação determinística de transações com regras por usuário.
- Conversão histórica de moedas para BRL, com revisão manual quando não existe uma taxa confiável.
- Detecção de transferências internas e revisão de transações removidas pelo provedor.

### Carteira de investimentos

- Metas da carteira, gráficos de alocação, sugestões de aporte, perguntas de pontuação e mapa de risco.
- Ações, ETFs, FIIs, REITs, fundos, criptoativos e grupos de renda fixa com aplicações recolhíveis.
- Separação entre tipo do instrumento e exposição de alocação, permitindo que um ETF conte em outra classe.
- Posições da Pluggy reconciliadas com o diagrama sem sobrescrever notas e classificações definidas pelo usuário.
- Aportes em posições controladas pela Pluggy ficam pendentes até uma sincronização posterior confirmá-los.
- Importação e exportação em XLSX.

### Integrações

- **Pluggy:** credenciais Open Finance por usuário para contas, cartões, transações e investimentos.
- **brapi:** ações brasileiras, FIIs e ETFs; cada usuário informa sua própria chave de API.
- **Yahoo Finance:** ações internacionais, REITs, ETFs e câmbio para BRL, sem chave.
- **Binance:** catálogo Spot público e cotações de criptoativos, sem chave e priorizando pares em BRL.

### Segurança multiusuário

- Cadastro somente por convite.
- Autenticação por credenciais com Auth.js e revogação de sessões JWT.
- Autorização por usuário nas operações financeiras e conexões com provedores.
- Criptografia AES-256-GCM versionada para credenciais da brapi e Pluggy.
- Limites de autenticação e webhook persistidos no banco.

## Tecnologias

- Next.js 16 App Router, React 19 e TypeScript
- Tailwind CSS e componentes no padrão shadcn/ui
- Lucide, Recharts, Leaflet e React Leaflet
- PostgreSQL e Prisma
- Auth.js
- Vitest e Cypress
- pnpm

## Requisitos

- Node.js 20.9 ou mais recente
- pnpm 10.13.1
- PostgreSQL 16 ou uma versão compatível
- Docker e Docker Compose, opcionalmente, para o PostgreSQL local

## Configuração local

1. Copie o modelo de variáveis de ambiente:

   ```bash
   cp .env.example .env
   ```

2. Substitua todos os placeholders de credenciais. Gere segredos independentes, por exemplo:

   ```bash
   openssl rand -base64 48
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
   ```

   Use valores diferentes em `AUTH_SECRET`, `AUTH_RATE_LIMIT_PEPPER` e em cada entrada de `CREDENTIAL_ENCRYPTION_KEYS`.

3. Inicie o PostgreSQL com Docker Compose ou disponibilize outra instância PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

4. Instale as dependências:

   ```bash
   pnpm install
   ```

5. Aplique as migrations e carregue catálogos globais, perfis e perguntas padrão:

   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

6. Inicie o servidor de desenvolvimento:

   ```bash
   pnpm dev
   ```

   Acesse [http://localhost:3000](http://localhost:3000).

O projeto usa exclusivamente pnpm. Não instale as dependências com npm ou Yarn.

## Variáveis de ambiente

| Variável | Finalidade |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Configuração do PostgreSQL local no Docker Compose. |
| `DATABASE_URL` | String de conexão PostgreSQL usada pelo Prisma. |
| `AUTH_SECRET` | Segredo de assinatura do Auth.js; use um valor independente e de alta entropia. |
| `AUTH_RATE_LIMIT_PEPPER` | Pepper usado nos limites de autenticação persistidos no banco. |
| `AUTH_URL` | Origem canônica da aplicação, como `http://localhost:3000` localmente ou a origem HTTPS pública em produção. |
| `AUTH_TRUST_HOST` | Ativa o comportamento de host confiável quando a topologia de deploy exigir. |
| `AUTH_TRUST_PROXY` | Ativa cabeçalhos de proxy confiável. Use somente atrás de um proxy reverso configurado corretamente. |
| `APP_ADMIN_EMAILS` | Administradores, separados por vírgula, que podem criar e revogar convites de cadastro. |
| `CREDENTIAL_ENCRYPTION_ACTIVE_KEY` | Identificador da chave ativa usada na criptografia de novas credenciais. |
| `CREDENTIAL_ENCRYPTION_KEYS` | Keyring versionado no formato `id-da-chave:chave-base64url`. |

As credenciais da brapi e da Pluggy não são compartilhadas no servidor. Cada usuário as configura em **Configurações**. Yahoo Finance e Binance não exigem credenciais do usuário.

### Webhooks da Pluggy

Cada usuário cria um segredo de webhook em **Configurações** e cadastra o mesmo valor em sua aplicação Pluggy usando o header `x-pluggy-webhook-secret`. O segredo é criptografado e nunca retorna completo ao navegador depois de salvo.

A URL do webhook é derivada de `AUTH_URL`:

```text
https://seu-dominio.example/api/pluggy/webhook
```

## Manutenção do banco

Use migrations do Prisma para alterações de schema:

```bash
pnpm db:migrate
```

Depois de aplicar a migration de câmbio histórico em uma base existente, processe as conversões pendentes em lotes idempotentes:

```bash
pnpm fx:backfill
```

O backfill preserva conversões congeladas e taxas manuais. Transações sem um par histórico confiável continuam pendentes para revisão do usuário.

## Validação

```bash
pnpm typecheck
pnpm test
pnpm test:integration
pnpm cypress:run
pnpm lint
pnpm build
```

Os testes de integração exigem um banco de teste acessível por `DATABASE_URL`. O Cypress espera a aplicação em `http://localhost:3000`.

## Produção

- Use a origem HTTPS pública em `AUTH_URL`.
- Ative `AUTH_TRUST_HOST` e `AUTH_TRUST_PROXY` somente atrás de um proxy confiável que remova cabeçalhos `Forwarded` e `X-Forwarded-For` enviados pelo cliente.
- Mantenha o PostgreSQL em uma rede privada. O Compose incluído publica o banco apenas em `127.0.0.1`.
- Não reutilize credenciais locais do banco em produção.
- Ao rotacionar as chaves de criptografia, mantenha a chave anterior em `CREDENTIAL_ENCRYPTION_KEYS`, adicione a nova e altere `CREDENTIAL_ENCRYPTION_ACTIVE_KEY`. As credenciais armazenadas são recriptografadas nos usos seguintes.

## Modelo de segurança

O servidor resolve o usuário pela sessão autenticada; mutações financeiras não confiam em um ID de usuário enviado pelo navegador. Importações, execução de aportes, sincronizações e alterações em lote usam consultas com escopo e transações. Planilhas enviadas são limitadas a 2 MB e processadas em um Web Worker descartável com timeout.
