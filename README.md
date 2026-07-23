# Aurum Finanças

Aplicação financeira multiusuário em Next.js que reúne carteira de investimentos, orçamento doméstico, simuladores, mapa de risco e FAQ. A interface replica o escopo funcional verificado no menu lateral do aplicativo de referência, sem o cabeçalho de produtos externos.

## Stack

- Next.js App Router, React e TypeScript
- Tailwind CSS e componentes no padrão shadcn/ui
- Lucide e Recharts
- Leaflet / React Leaflet
- PostgreSQL e Prisma
- Auth.js com credenciais e sessões JWT
- Vitest e Cypress
- pnpm exclusivamente

## Configuração local

1. Copie `.env.example` para `.env` e substitua todos os placeholders de credenciais.
2. Disponibilize PostgreSQL usando sua instalação ou `docker compose up -d postgres`.
3. Instale com `pnpm install`.
4. Crie a migração local com `pnpm db:migrate` e carregue os dados globais com `pnpm db:seed`.
5. Inicie com `pnpm dev`.

O primeiro `pnpm install` gera `pnpm-lock.yaml`; o projeto não deve ser instalado com npm ou yarn.

Gere segredos independentes. Por exemplo, `openssl rand -base64 48` para `AUTH_SECRET` e
`AUTH_RATE_LIMIT_PEPPER`, e `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='` para cada
entrada de `CREDENTIAL_ENCRYPTION_KEYS`. Ao rotacionar a chave de credenciais, mantenha a chave
anterior no keyring, adicione uma nova versão e altere `CREDENTIAL_ENCRYPTION_ACTIVE_KEY`; as
credenciais são recriptografadas no próximo uso.

Em produção atrás de um proxy confiável, configure `AUTH_TRUST_HOST=true` e
`AUTH_TRUST_PROXY=true`, garantindo que o proxy remova cabeçalhos `Forwarded` e
`X-Forwarded-For` enviados diretamente pelo cliente.

## Validação

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm cypress:run`
- `pnpm build`

Os testes de integração precisam de um banco de teste acessível via `DATABASE_URL`. O Cypress espera a aplicação em `http://localhost:3000`.

## Dados simulados

O catálogo e os preços de mercado, os perfis globais, os dados de países e o conteúdo de suporte são determinísticos. O cadastro de usuários, ativos, metas, perguntas, aportes, orçamentos e balanço patrimonial é persistido no PostgreSQL. O perfil Moderado está identificado como distribuição neutra de demonstração até sua configuração de produto ser substituída.

## Segurança e isolamento

Todas as operações financeiras resolvem o usuário a partir da sessão no servidor; nenhuma ação confia em `userId` enviado pelo navegador. Importação, execução de aporte e alterações em lote usam transações, e cada consulta de dados privados contém o escopo do usuário autenticado.

As tentativas de autenticação são limitadas no PostgreSQL por conta e por IP confiável. O logout
incrementa a versão da sessão e revoga todos os JWTs anteriores do usuário. A chave da brapi usa
AES-256-GCM com chave independente e versionada, vinculada ao usuário por dados autenticados.
Planilhas são limitadas a 2 MB e processadas em um Web Worker descartável com timeout.

O `docker-compose.yml` publica o PostgreSQL apenas em `127.0.0.1`. Não reutilize suas credenciais
locais no Coolify e mantenha o banco em uma rede privada.
