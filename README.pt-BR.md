# UOVP Finanças

[English](./README.md)

<p>
  <img width="49%" alt="Screenshot 1" src="https://github.com/user-attachments/assets/5fddede5-1495-4ee5-b5a5-5abf2bb94757" />
  <img width="49%" alt="Screenshot 2" src="https://github.com/user-attachments/assets/e16ffa80-9fcf-4b79-a2ef-d20ed20c6ae3" />
</p>

**Uma Outra Verdade Possível** — uma aplicação financeira pessoal multiusuário para orçamento doméstico, carteira de investimentos e agregação via Open Finance, inspirada no Diagrama do Cerrado da AUVP.

A interface está em português brasileiro. Frontend e backend executam na mesma aplicação Next.js. O PostgreSQL armazena os registros financeiros e o estado das integrações; o Redis opcional compartilha dados públicos de mercado entre usuários.

## Visão geral

| Área | Funcionalidades |
| --- | --- |
| **Painel** (`/home`) | Saldo em conta, entradas e despesas líquidas, resultado do período, calendário de saídas, movimentações por tag e histórico mensal. |
| **Orçamento** (`/orcamento-domestico`) e **Metas** (`/metas`) | Metas de gastos domésticos e acompanhamento por categoria. |
| **Contas** (`/contas`) e **Faturas** (`/faturas`) | Contas e cartões manuais ou conectados, saldos, limites e faturas. |
| **Transações** (`/transacoes`) e **Tags** (`/tags`) | Busca, filtros, regras de classificação, ações em lote, exclusões dos relatórios, transferências internas e tags. |
| **Carteira** (`/carteira`) | Ativos e posições, metas de alocação, sugestões de aporte, perguntas de pontuação e mapa da carteira. |
| **Open Finance** (`/open-finance`) | Conexões Pluggy, contas, transações e investimentos importados, além dos controles de sincronização. |
| **Ferramentas** (`/ferramentas`) | Projeção do primeiro milhão e quadro de ativos versus passivos. |
| Perfil (`/perfil`) | Nome, renda mensal, objetivos e início do mês financeiro. |
| **Configurações** (`/configuracoes`) | Credenciais das integrações, seleção de ativos da Binance, fuso horário, convites para administradores e instalação do app. |

A interface atende desktop e celular.

## Análise com agentes de IA via MCP

Em **Configurações → Agentes de IA / MCP**, habilite voluntariamente análises financeiras somente para leitura no ChatGPT, Codex ou clientes MCP remotos compatíveis. Cada cliente exige autorização OAuth separada e pode ser revogado; o MCP não altera dados financeiros nem sincroniza provedores. Consulte o [guia de conexão e deploy MCP](./docs/mcp.pt-BR.md) para permissões, configuração, privacidade e publicação.

## Comportamento financeiro

### Perfil e mês financeiro

Em Perfil, configure nome, renda mensal, objetivos e Início do Mês Financeiro, entre os dias 1 e 28. Transações anteriores ao dia escolhido pertencem ao mês de referência anterior, considerando o fuso horário do usuário. Por exemplo, com início no dia 5, um lançamento de 3 de março pertence à referência de fevereiro.

Alterar esse dia ou o fuso horário recalcula as referências das transações existentes que usam a classificação mensal automática. Referências ajustadas manualmente são preservadas. A data original da transação não muda; painel, metas e histórico passam a usar a referência recalculada.

### Resumos, transações e tags

Todos os relatórios consolidados usam BRL. Os cards do painel aparecem nesta ordem: **Saldo em conta → Entradas líquidas → Despesas líquidas → Resultado do período**.

- **Entradas líquidas** considera as entradas sem meta atribuída.
- Dentro de cada meta e mês financeiro de referência, a compensação aplicada é o menor valor entre suas entradas e saídas.
- **Despesas líquidas** corresponde às saídas brutas menos essa compensação; o resultado do período é a entrada líquida menos a despesa líquida.
- Entradas atribuídas a uma meta que excedam suas despesas não aumentam a renda disponível. Metas ou meses de referência diferentes não se compensam.
- O progresso das metas e o histórico mensal usam esses cálculos líquidos. Nesses resumos, a compensação ocorre por **meta e mês**, não por tag.

As transações individuais preservam seus valores integrais. **Saídas por dia** usa o valor completo de relatório em BRL nas células, totais e detalhes; lançamentos em moeda estrangeira também mostram o valor original. Lançamentos atribuídos ao mês financeiro selecionado, mas com data fora da grade do calendário, aparecem separadamente.

**Transações por Tags** mostra os totais reais de **Entrada** e **Saída** pertencentes a cada tag. O gráfico não distribui a compensação de uma meta entre suas tags. O **Total movimentado** do gráfico é a soma de entradas e saídas, não o resultado líquido do período. Valores com múltiplas tags são divididos igualmente em centavos, com arredondamento determinístico.

A tela Transações mantém entradas, saídas e saldo brutos disponíveis para auditoria. Transações ocultas, transferências internas, registros removidos pelo provedor e valores aguardando conversão seguem as regras de exclusão dos relatórios.

### Contas manuais e USD

Contas bancárias e cartões de crédito manuais aceitam BRL e USD.

- A moeda pertence à conta; transações manuais a herdam. Ela só pode mudar antes de a conta ter transações, e a moeda das contas Pluggy é controlada pelo provedor.
- Saldos, limites, faturas e transações de contas USD exibem o valor nativo em USD, com equivalentes em BRL para os relatórios.
- Saldos atuais usam o câmbio USD/BRL corrente. Transações históricas usam uma taxa congelada para sua data, aceitando o fechamento anterior disponível até sete dias antes.
- O Yahoo fornece o câmbio automático. Se uma taxa necessária estiver indisponível, o formulário solicita uma cotação manual antes de salvar. Taxas históricas manuais são preservadas; uma taxa manual usada no saldo atual pode ser substituída depois pelo câmbio automático.
- Corrigir **Saldo atual** estabelece um novo marco de saldo e incorpora as transações manuais anteriores. Editar ou excluir depois essas transações incorporadas não reverte valores já incluídos no marco.
- Novas transações manuais vêm com **Atualizar saldo da conta** marcado. Desmarcar registra o histórico sem alterar o saldo. Essa escolha é independente de tags, metas e visibilidade nos relatórios.
- Alterações em contas USD atualizam primeiro o saldo nativo e depois seu equivalente em BRL com a taxa corrente da conta.
- Uma transferência BRL↔USD é registrada como duas transações internas manuais. Não existe fluxo automático de câmbio.

### Saldo de conta como investimento

Ao editar uma conta bancária manual ou conectada, marque **Classificar saldo como investimento** para enviar seu saldo positivo à revisão na Carteira. Confirme classe de renda fixa, família, indexação, tipo e nota; produto, taxa e cobertura FGC não são presumidos. Grupos BRL e USD permanecem separados.

A conta continua sendo a única fonte do valor da posição. Alterações do saldo e do câmbio corrente atualizam a holding; taxas descritivas não geram juros nem transações. Desmarcar retira a posição dos totais da Carteira sem perder a classificação. O mesmo dinheiro permanece em **Saldo em conta**: exportações e MCP identificam essa sobreposição, portanto não some as duas representações como patrimônio adicional. O aporte nessa posição é apenas planejado e reconhecido após mudança no saldo nativo, nunca por variação cambial isolada.

## Carteira de investimentos

- Classes de alocação: ações internacionais, ações nacionais, FIIs, REITs, criptoativos, renda fixa nacional, renda fixa internacional e Reserva de valor.
- Tipo do instrumento e classe de alocação são separados. ETFs podem representar exposições diferentes; ativos de reserva de valor permitem classificação nacional ou internacional.
- Fundos de investimento também são suportados como instrumento próprio (`MUTUAL_FUND`), distinto de ETF, FII e REIT. ETFs e fundos permitem selecionar a classe de exposição e definir uma nota manual; posições conectadas continuam vinculadas aos dados do provedor.
- Grupos de renda fixa organizam aplicações por família e indexação. As posições exibem emissor, produto, taxas, datas, valores e operações quando disponíveis.
- Notas, classificações e grupos definidos pelo usuário sobrevivem à sincronização. As perguntas de pontuação podem ser personalizadas.
- Ativos internacionais exibem valores nativos junto dos equivalentes em BRL.
- Aportes aceitam BRL ou USD e a escolha de todos os ativos elegíveis ou apenas os da moeda selecionada. Sugestões restritas redistribuem o aporte entre as classes elegíveis respeitando seus limites de meta; arredondamento ou falta de capacidade elegível pode deixar um valor não alocado.
- Ativos internacionais permitem sugestões fracionadas; instrumentos equivalentes negociados na B3 usam unidades inteiras.
- Aportes em posições controladas por um provedor aguardam sincronização antes de atualizar a quantidade observada. Na Pluggy, uma posição mais recente com quantidade diferente pode encerrar a pendência.
- Há importação e exportação XLSX. A importação da carteira aceita até 2 MB, 1.000 linhas de dados e 40 colunas, com leitura em Web Worker.

As ações de aporte registram a atividade da carteira no UOVP; elas não enviam ordens a corretoras ou exchanges.

### Custo, preço médio e taxas

- O valor investido possui moeda própria (`investedValueCurrency`), que pode ser diferente da moeda da cotação ou do relatório em BRL. Custos legados sem moeda conhecida são sinalizados; o câmbio atual não reconstrói um custo histórico desconhecido.
- Um custo consolidado só é exibido quando todas as posições têm custo informado na mesma moeda conhecida. Dados ausentes ou moedas incompatíveis produzem informação indisponível, não custo zero nem soma de moedas diferentes.
- O preço médio usa o valor original informado pelo provedor quando disponível; caso contrário, posições conectadas usam os resumos das compras importadas. Posições manuais usam custo informado dividido pela quantidade. A moeda acompanha o preço; históricos incompletos recebem o aviso Histórico parcial, e dados insuficientes não geram um preço presumido.
- A coluna Rentabilidade dos detalhes de renda fixa apresenta as condições descritivas da taxa, como percentual do indexador, indexador mais spread ou taxa anual. Ela não representa um cálculo de retorno realizado nem gera juros automaticamente.

### Importação e exportação XLSX

Use uma exportação da própria carteira como modelo de cabeçalhos. As células numéricas devem conter números; datas de compra e vencimento usam `AAAA-MM-DD`. Preserve a data/hora ISO 8601 exportada em `Data do câmbio`. Os limites de importação são 2 MB, 1.000 linhas de dados e 40 colunas.

| Colunas | Uso |
| --- | --- |
| `ID da aplicação` | Identifica uma posição manual existente do próprio usuário para atualização. Preserve o ID ao editar uma exportação; posições controladas por provedores não são sobrescritas pela importação. |
| `Classe`, `Instrumento`, `Mercado` | Definem alocação, instrumento e mercado. O arquivo exportado usa valores como `FIXED_INCOME`, `ETF`, `MUTUAL_FUND`, `Nacional` e `Internacional`. |
| `Ticker`, `Nome`, `Quantidade`, `Preço`, `Moeda`, `Fracionado`, `Nota` | Identificação, posição, preço e classificação dos ativos de mercado. |
| `Família`, `Indexação`, `Emissor`, `Produto`, `Valor atual` | Obrigatórias nas linhas de renda fixa; informe também `Catálogo ID` válido ou `Tipo personalizado`. Grupos agregados antigos sem os dados das aplicações não são aceitos. |
| `Valor investido`, `Moeda investimento` | Devem ser informadas juntas ou ficar ambas vazias. A moeda descreve o custo, não necessariamente a moeda da cotação. |
| `Valor atual nativo`, `Câmbio para BRL`, `Data do câmbio` | Preservam o valor original e sua conversão nas posições estrangeiras com valor manual. O `Valor atual` exportado é consolidado em BRL e não pode ser reinterpretado como valor nativo. |
| `Formato da taxa`, `Indexador`, `Taxa`, `Data da compra`, `Vencimento` | Informações complementares das aplicações de renda fixa. |

Uma nova posição estrangeira com valor manual exige câmbio válido. Na atualização, o câmbio existente só pode ser reaproveitado quando o ID identifica a mesma posição manual e a moeda não mudou. Uma planilha sem IDs pode ser ambígua quando há várias posições manuais do mesmo ativo; preserve os identificadores para evitar essa situação.

### Correções de investimentos conectados

Use **Editar informações** na Carteira ou no Open Finance para personalizar o nome e o emissor exibido de uma posição conectada, além de tipo do produto, remuneração, compra e vencimento quando aplicável.

As alterações persistem por usuário e posição. O editor mostra os valores efetivos e os últimos dados originais da Pluggy, com restauração por campo e **Restaurar tudo**. A sincronização continua controlando os dados originais recebidos da instituição, incluindo valores monetários, quantidades, moeda, status, identificadores e operações. Converter uma posição para manual preserva seus metadados efetivos.

Posições Pluggy elegíveis de ações, ETFs, FIIs e REITs permitem definir uma Quantidade temporária. A Carteira usa essa quantidade com a cotação de mercado, mantendo o valor original da instituição separado. A correção persiste nas sincronizações até ser restaurada; zero retira a posição dos totais. Ela não altera a Pluggy, não cria movimentações e não confirma aportes aguardando sincronização.

Quando a quantidade informada pela instituição muda em relação à referência reconhecida, o app apresenta as quantidades anterior, atual e manual para revisão. Escolha entre manter a correção ou usar novamente a quantidade da instituição; a substituição não é automática. Conexões desconectadas, posições indisponíveis ou excluídas não podem receber novas correções.

### Caixinhas e saldos reservados

O campo `bankData.reservedBalances` das contas Pluggy pode fornecer investimentos ausentes do endpoint de investimentos, incluindo Caixinhas do Mercado Pago.

- Cada reserva e moeda gera uma posição conectada separada.
- Posições positivas aparecem no Open Finance e aguardam classificação na Carteira antes de entrar nos totais.
- Reservas detalhadas têm precedência sobre `automaticallyInvestedBalance`; o saldo agregado pode servir como alternativa quando os detalhes não estão disponíveis.
- Reservas não são acrescentadas ao dinheiro disponível da conta. A classificação não presume automaticamente CDB, RDB ou garantia do FGC.
- Depois da classificação, os valores continuam controlados pelo provedor. Respostas completas podem marcar reservas ausentes como indisponíveis; respostas parciais preservam os valores anteriores.
- Essas posições derivadas de contas não possuem histórico importado de movimentações de investimento.

## Integrações

| Provedor | Dados | Credenciais |
| --- | --- | --- |
| Pluggy | Contas, cartões, transações, investimentos e movimentações de investimentos disponíveis. | Client ID, Client Secret e segredo de webhook por usuário em Configurações. |
| brapi | Ações da B3, FIIs e ETFs. | Chave de API por usuário em Configurações. |
| Yahoo Finance | Ações internacionais, ETFs, REITs e câmbio atual/histórico. | Sem chave de API do usuário. |
| Binance: dados públicos | Símbolos Spot e preços de criptoativos, priorizando pares BRL e convertendo USDT quando necessário. | Sem chave de API do usuário. |
| Binance: carteira | Saldos privados de Spot, Funding e Simple Earn. | Chave de API HMAC e segredo por usuário em Configurações. |

### Conexões Pluggy

**Sincronizar dados** importa a posição mais recente já disponível na Pluggy. **Atualizar banco** abre o Pluggy Connect para solicitar uma atualização à instituição; o banco pode exigir nova autorização. Importar repetidamente os dados disponíveis não garante dados bancários mais recentes.

Os nomes das conexões podem ser alterados localmente. A desconexão permite preservar posições importadas como manuais ou removê-las pelo fluxo explícito de resolução. Os campos e o histórico disponíveis dependem da instituição e do conector.

Cada usuário configura um segredo de webhook em Configurações e o registra em sua aplicação Pluggy no header `x-pluggy-webhook-secret`. A URL do webhook deriva de `AUTH_URL`:

```text
https://seu-dominio.example/api/pluggy/webhook
```

Os webhooks validam eventos, atualizam imediatamente estados de exclusão/revisão quando necessário e marcam as conexões como pendentes. A importação completa ocorre pelo fluxo normal de sincronização.

### Carteira Binance

Uma conexão por usuário importa quantidades de Spot, Funding e Simple Earn flexível/bloqueado. O cliente tenta o endpoint consolidado de carteiras e possui alternativas separadas para Spot e Funding.

Novos ativos descobertos precisam ser selecionados. Se houver uma posição manual do mesmo criptoativo, aparecem **Substituir manual**, **Manter ambos** e **Ignorar**. A substituição preserva a posição manual anterior para auditoria e a exclui dos totais. Moedas fiduciárias são excluídas; stablecoins continuam selecionáveis.

Os saldos acompanhados são controlados pelo provedor. Os preços usam o fluxo público de mercado; a avaliação pode usar um par direto ou, como alternativa, o valor em BTC. Ativos sem avaliação suportada não podem ser acompanhados. Falhas parciais preservam os últimos valores das carteiras que falharam e mantêm a sincronização pendente.

A desconexão permite preservar as posições Binance como manuais ou remover as posições importadas. Margin, Futures, Options, ordens, negociações e saques não são importados nem executados.

Use uma chave HMAC com leitura habilitada. São recomendadas chaves somente leitura e restrição ao IP do servidor; permissões mais amplas geram aviso, mas são aceitas. As requisições privadas partem do servidor da aplicação. Uma resposta HTTP 451 é apresentada como restrição de acesso da região/IP do servidor; liberar o IP na chave não anula essa restrição.

## Atualização automática e cache

Após renderizar a área autenticada, um coordenador chama `POST /api/bootstrap-refresh`. Ele verifica novamente quando o app retorna após pelo menos 15 minutos em segundo plano. O session storage limita verificações repetidas; bloqueios temporários no servidor coordenam operações concorrentes.

A sincronização da Pluggy e da carteira Binance ocorre em paralelo. A verificação das cotações aguarda ambas terminarem, inclusive com falhas parciais, para usar as posições sincronizadas e deixar os preços de mercado como última etapa de precificação. O câmbio das contas USD manuais roda de forma independente. A reconciliação da Pluggy preserva a cotação de mercado utilizável mais recente; a data do snapshot do provedor, por si só, não torna a cotação de mercado recente.

| Integração | Gatilho automático | Escopo |
| --- | --- | --- |
| Cotações | Alguma cotação efetiva está ausente ou tem pelo menos 12 horas, após verificar o cache compartilhado e os dados persistidos. | Todos os ativos de mercado elegíveis daquele usuário. |
| Câmbio de contas USD manuais | O câmbio corrente está ausente ou tem pelo menos 12 horas. | Contas USD manuais ativas; o saldo nativo é preservado. |
| Pluggy | Alguma conexão ativa está pendente, nunca foi sincronizada ou tem pelo menos 12 horas. | Todas as conexões Pluggy ativas daquele usuário. |
| Carteira Binance | A conexão está pendente, nunca foi sincronizada ou tem pelo menos 12 horas. | A carteira configurada e suas posições selecionadas. |

As operações retornam resultados separados: `SKIPPED`, `UPDATED`, `PARTIAL` ou `FAILED`. A navegação abre imediatamente; mudanças atualizam a tela, e falhas preservam os valores anteriores com um aviso. Os botões manuais ignoram a janela de 12 horas, mantendo os limites de operação. Não há tarefa agendada que continue atualizando um app fechado.

Normalmente, a brapi recebe todos os símbolos B3 do usuário em uma requisição autenticada de cotação. Falhas por símbolos inválidos podem gerar novas requisições menores. Uma falha da brapi não impede atualizações de preços pelo Yahoo ou pela Binance.

### Preços e logos

O Redis é opcional e armazena catálogos públicos, metadados, cotações, câmbio corrente e chaves temporárias de coordenação. Saldos privados, transações, credenciais, sessões, dados de conexões Pluggy e respostas da carteira Binance ficam fora desse cache compartilhado.

As URLs de logos também possuem armazenamento durável no PostgreSQL em `MarketAssetMetadata`. URLs compartilhadas verificadas têm precedência sobre URLs antigas das posições; URLs utilizáveis não expiram por tempo, e resultados ausentes normalmente possuem uma janela de 24 horas antes de nova tentativa. Falhas de carregamento no navegador podem provocar a resolução e persistência de uma URL corrigida. Somente URLs são armazenadas, não os arquivos de imagem.

Atualizar preços não realiza uma busca de logos nem substitui logos salvos. A resolução de metadados é separada. Sem Redis, os logos persistidos continuam disponíveis no PostgreSQL, e as consultas de mercado podem recorrer aos provedores.

## App instalável

Em **Configurações → Instalar UOVP**, navegadores Chromium compatíveis oferecem a instalação. No Safari do iOS/iPadOS, use **Compartilhar → Adicionar à Tela de Início**. A sessão instalada abre em uma janela própria.

O manifesto inclui ícones normais/maskable e inicia em `/home?source=pwa`. A instalação depende de navegador compatível e origem segura. Não há service worker, modo offline, notificações push ou sincronização em segundo plano; é necessária conexão com a internet.

## Tecnologias e requisitos

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS e componentes no padrão shadcn/ui.
- Prisma 6 com PostgreSQL; Redis opcional.
- Autenticação por credenciais com Auth.js, Lucide, Recharts, Leaflet e React Leaflet.
- Vitest para testes unitários/de integração e Cypress para testes de navegador.
- Node.js 22 ou mais recente, pnpm 10.13.1 e PostgreSQL 18.4.
- Python 3 para os testes dos scripts de CI/deploy; não é necessário para executar a aplicação.
- Docker Compose opcional para PostgreSQL 18.4 e Redis 7.2.15, nas mesmas versões dos serviços de desenvolvimento e produção.

## Configuração local

1. Copie o modelo de variáveis de ambiente:

   ```bash
   cp .env.example .env
   ```

2. Substitua todos os placeholders de credenciais. Execute o primeiro comando separadamente para `AUTH_SECRET` e `AUTH_RATE_LIMIT_PEPPER`; use o segundo para gerar uma chave de criptografia de 32 bytes:

   ```bash
   openssl rand -base64 48
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
   ```

   Configure `CREDENTIAL_ENCRYPTION_KEYS="v1:<chave-gerada>"` e `CREDENTIAL_ENCRYPTION_ACTIVE_KEY="v1"`. Mantenha as senhas de PostgreSQL/Redis consistentes com suas URLs; codifique caracteres especiais nas strings de conexão.

   Para habilitar MCP, gere outra chave independente de 32 bytes em base64url, sem padding:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Defina `MCP_OAUTH_SIGNING_KEYS="v1:<nova-chave>"` e `MCP_OAUTH_ACTIVE_KEY="v1"`. Não reutilize os segredos de autenticação, criptografia ou provedores. Deixar o keyring vazio mantém o MCP indisponível, mas a suíte Cypress completa exige essa configuração.

3. Inicie os serviços locais ou configure serviços externos:

   Instalações existentes com PostgreSQL 16 exigem backup lógico do serviço antigo e restauração no PostgreSQL 18.4. O Compose usa o volume separado `uovp_postgres18`, montado em `/var/lib/postgresql`, conforme a [estrutura da imagem PostgreSQL 18](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata). Preserve o volume antigo `uovp_postgres` até verificar a restauração. Trocar a imagem ou executar migrations do Prisma não atualiza os arquivos de dados do PostgreSQL 16.

   ```bash
   docker compose up -d postgres redis
   ```

4. Instale as dependências, gere o Prisma Client, aplique as migrations existentes e carregue os catálogos:

   ```bash
   pnpm install --frozen-lockfile
   pnpm db:generate
   pnpm exec prisma migrate deploy
   pnpm db:seed
   ```

5. Inicie o app:

   ```bash
   pnpm dev
   ```

   Acesse [http://localhost:3000](http://localhost:3000). O primeiro usuário cadastrado torna-se administrador; os cadastros seguintes exigem convite criado pelo administrador.

Use pnpm de forma consistente. `pnpm db:migrate` executa `prisma migrate dev` para desenvolver alterações de schema; `prisma migrate deploy` aplica as migrations existentes.

## Variáveis de ambiente

| Variável | Finalidade |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Configuração do banco local no Compose. |
| `DATABASE_URL` | String de conexão PostgreSQL usada pelo Prisma. |
| `REDIS_PASSWORD`, `REDIS_PORT` | Configuração do Redis local no Compose. |
| `REDIS_URL` | Cache opcional de dados públicos compartilhados. Deixe sem definir se não usar Redis. |
| `SHARED_CACHE_NAMESPACE` | Namespace Redis; o padrão é `uovp:shared:v1`. |
| `AUTH_SECRET` | Segredo independente de assinatura do Auth.js, com alta entropia e pelo menos 32 caracteres. |
| `AUTH_RATE_LIMIT_PEPPER` | Segredo independente para limites de autenticação. |
| `AUTH_URL` | Origem canônica: localhost no desenvolvimento, HTTPS público em produção. |
| `AUTH_TRUST_HOST`, `AUTH_TRUST_PROXY` | Ambos devem ser `true` na execução em produção; configure um proxy reverso confiável. O exemplo local usa `false`. |
| `CREDENTIAL_ENCRYPTION_ACTIVE_KEY` | Identificador da chave ativa de criptografia das credenciais. |
| `CREDENTIAL_ENCRYPTION_KEYS` | Keyring separado por vírgulas, como `v1:<chave-base64url>,v2:<chave-base64url>`; cada chave decodificada deve ter exatamente 32 bytes. |
| `MCP_OAUTH_ACTIVE_KEY` | Identificador da chave ativa de assinatura OAuth do MCP, como `v1`. |
| `MCP_OAUTH_SIGNING_KEYS` | Keyring independente do MCP, como `v1:<chave-base64url>`; cada chave deve ter 32 bytes, codificados em 43 caracteres base64url sem padding. Necessário para habilitar MCP e seus testes de navegador. |
| `UOVP_TEST_REDIS_URL` | Apenas testes: Redis isolado em loopback para a suíte de coordenação entre processos. Exporte explicitamente; não é substituído por `REDIS_URL`. |

As credenciais da brapi, Pluggy e carteira Binance são informadas por usuário em Configurações, não como variáveis de ambiente compartilhadas. Yahoo e cotações públicas Binance não exigem credenciais do usuário.

## Validação

Prepare um banco de teste dedicado, com migrations e seed aplicados, e um Redis de teste isolado antes de executar as suítes que os utilizam. Exporte `DATABASE_URL`, `REDIS_URL` e `UOVP_TEST_REDIS_URL` para os processos de teste; as duas URLs Redis devem apontar ao serviço de teste. `UOVP_TEST_REDIS_URL` aceita somente hosts de loopback, como `127.0.0.1` e `localhost`.

Disponibilize também os segredos de autenticação, o keyring de criptografia e as chaves MCP independentes ao app de teste e aos processos que precisam deles. O `.env` carregado pelo Next.js não substitui variáveis exportadas para Vitest ou tarefas Cypress. Para Cypress local, mantenha `AUTH_URL` e o app de desenvolvimento em `http://localhost:3000`; a execução de produção no CI usa o proxy HTTPS descrito abaixo.

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

- `pnpm test` cobre `tests/unit`; `pnpm test:integration` cobre `tests/integration`.
- As suítes de integração com banco são puladas sem `DATABASE_URL`; a suíte de coordenação entre processos é pulada sem `UOVP_TEST_REDIS_URL`, mesmo quando o banco está configurado. Um resultado com testes pulados não comprova a validação completa.
- O comando Python cobre as proteções de sincronização de branches e deploy em `tests/ci`, incluindo a rejeição de commits substituídos e os cenários de concorrência. Ele também é executado pelo job Code quality do CI.
- O Cypress espera um app em execução em `http://localhost:3000`. O app e as tarefas Cypress devem usar o mesmo banco de teste e os segredos necessários.
- O Cypress cria/remove usuários de teste e limpa registros de limites de autenticação usados nos testes. Não o execute contra produção.
- `pnpm cypress:open` abre o executor interativo; `pnpm test:watch` executa o Vitest em modo de observação.
- `pnpm build` gera o Prisma Client e compila o Next.js; não aplica migrations nem executa o seed.

### Integração contínua e deploy

O GitHub Actions executa typecheck, lint, testes unitários, testes de integração, build de produção e Cypress nos pushes para `dev`/`main` e nos pull requests destinados a essas branches. Os jobs de integração e navegador usam PostgreSQL 18.4 e Redis 7.2.15 descartáveis, com migrations e seed independentes. O CI gera segredos temporários de autenticação/criptografia e rejeita testes de integração pulados.

O Cypress testa o app compilado por um proxy HTTPS local temporário em `https://uovp-ci.test:8443`, preservando a validação de segurança de produção. Falhas nos testes de navegador disponibilizam capturas de tela e logs do servidor.

O check `CI passed` exige sucesso em todos os jobs de validação. A proteção de `main` exige pull request, esse check com a base atualizada e conversas de revisão resolvidas; force push e exclusão da branch ficam bloqueados. Não é exigida aprovação adicional de outro revisor.

O dev só recebe deploy depois que o CI passa em `dev`. O deploy direto por push do Coolify fica desativado. O job fixa o commit testado antes de chamar a cópia versionada do CLI `coolify-deploy` do Gustavo, aguarda a conclusão e verifica a saúde do dev. Commits substituídos por versões mais novas são ignorados. Produção mantém seu deploy existente pelo Coolify em `main`, após merge protegido.

Após o merge de um PR de `dev` → `main`, `Sync dev after merge` alinha `dev` ao mesmo commit de `main`, inclusive em squash merges. A sincronização é pulada se alguma branch avançou e usa `--force-with-lease` com o commit esperado para preservar pushes concorrentes em dev. Se main avançar durante o push, o workflow informa uma falha e não dispara o CI até as branches serem reconciliadas. Caso contrário, dispara explicitamente o CI em `dev`; o deploy continua aguardando todos os checks. Se o disparo falhar, execute novamente o workflow pelo Actions informando o número do PR já integrado. O workflow executa apenas código confiável de main e mantém sua proteção. Antes de retomar o trabalho local, salve as alterações e alinhe seu `dev` com `origin/dev`; não envie novamente o histórico antigo.

O environment `development` do GitHub só permite a branch `dev`. Ele contém as variáveis `COOLIFY_URL` e `COOLIFY_DEV_APP_UUID` e o secret `COOLIFY_TOKEN`, com permissões Coolify `read`, `write` e `deploy`. A escrita é necessária para fixar o commit exato, pois a API de restart instalada não aceita um commit como parâmetro. O token só fica disponível no job de deploy; a validação de pull requests não usa credenciais de deploy. Renove o token antes do vencimento.

## Produção e manutenção

Faça o deploy pelo Coolify com a origem HTTPS pública do app e serviços privados de PostgreSQL/Redis. O Compose incluído executa apenas os serviços locais de dados, não a aplicação.

Configure a instalação com `pnpm install --frozen-lockfile`, o build com `pnpm build` e a inicialização com `pnpm start`. Aplique `pnpm exec prisma migrate deploy` no processo de publicação antes de atender requisições com código que exige o novo schema. Execute `pnpm db:seed` para os catálogos iniciais e quando alterações dos catálogos exigirem; o seed também recria os modelos globais de perguntas padrão.

- A execução em produção exige `AUTH_TRUST_HOST=true`, `AUTH_TRUST_PROXY=true` e `AUTH_URL` com HTTPS público. O proxy reverso deve higienizar cabeçalhos de encaminhamento enviados pelo cliente.
- Mantenha as portas de PostgreSQL e Redis privadas. Os serviços do Compose local ficam vinculados a `127.0.0.1`.
- O Redis opcional usa `allkeys-lru` com limite de memória; não exige persistência durável do cache.
- `GET /api/health` verifica se o processo responde; não verifica banco ou disponibilidade dos provedores.
- Faça backup do PostgreSQL e preserve o keyring de criptografia antes de migrations ou manutenção de conexões/dados.
- Na rotação de chaves, mantenha as anteriores disponíveis, adicione a nova e altere `CREDENTIAL_ENCRYPTION_ACTIVE_KEY`. As credenciais são recriptografadas conforme são utilizadas.
- `pnpm db:studio` abre o Prisma Studio. Mantenha-o local ou acessível por túnel privado.
- `pnpm fx:backfill` processa transações Pluggy em moeda estrangeira sem conversão, em lotes de 500, preservando conversões existentes e manuais. Exporte `DATABASE_URL` para esse script; taxas não encontradas continuam pendentes.
- O app atual não possui fluxo de recuperação de senha pelo próprio usuário.

### Diagnóstico e reparos

Exporte `DATABASE_URL` para o banco que será inspecionado e aplique as migrations necessárias. Os comandos abaixo são de manutenção, não fazem parte da inicialização normal. Sem `--apply`, todos executam apenas uma prévia. Faça backup antes de aplicar alterações e use `--user-id=ID` para limitar a análise a uma pessoa; sem esse filtro, os scripts percorrem os usuários ou registros aplicáveis.

| Comando de prévia | Finalidade e limites |
| --- | --- |
| `pnpm exec tsx scripts/repair-finance-setup.ts` | Cria, no modo de aplicação, somente configurações financeiras ausentes; preserva personalizações e aponta conflitos de nomes para revisão. |
| `pnpm exec tsx scripts/repair-financial-references.ts` | Recalcula as referências mensais automáticas conforme início do mês financeiro e fuso do usuário; preserva referências ajustadas manualmente. |
| `pnpm exec tsx scripts/repair-purchase-summaries.ts` | Reconstrói os resumos de quantidade e custo das compras importadas da Pluggy. Exige a migration dos resumos de compras e coordena atualizações concorrentes. |
| `pnpm exec tsx scripts/repair-financial-integrity.ts` | Diagnostica posições externas órfãs ou ambíguas e valores de relatório. Só repara casos comprovados de snapshots BRL/NATIVE/1; posições externas não são mescladas nem excluídas. Aceita `--batch-size=100`. |

Exemplo de análise e aplicação para um usuário:

```bash
pnpm exec tsx scripts/repair-financial-references.ts --user-id=ID
pnpm exec tsx scripts/repair-financial-references.ts --user-id=ID --apply
```

Registros alterados concorrentemente podem ser preservados ou reportados para nova análise, conforme o script. Consulte também o [guia MCP](./docs/mcp.pt-BR.md) para a limpeza de registros OAuth encerrados e o comando `pnpm fx:backfill` descrito acima para conversões históricas pendentes.

## Organização do código

| Caminho | Responsabilidade |
| --- | --- |
| `app/(app)`, `app/(auth)`, `app/api` | Páginas autenticadas, páginas de autenticação e handlers da API. |
| `features/finance` | Contas, transações, câmbio, classificação e relatórios financeiros. |
| `features/portfolio` | Posições, alocação, dados de mercado, logos e sincronização da carteira Binance. |
| `features/open-finance` | Importação Pluggy, conciliação, Caixinhas e correções de investimentos. |
| `features/balance-sheet` | Ferramentas financeiras. |
| `components/layout`, `components/pwa` | Estrutura do app, coordenador de atualização e interface de instalação. |
| `lib` | Autenticação, autorização, bloqueios de operação, criptografia e cache compartilhado. |
| `prisma`, `scripts` | Schema, migrations, catálogos e utilitários de manutenção. |
| `tests`, `cypress` | Cobertura unitária, de integração e de navegador. |

## Modelo de segurança

O servidor resolve a titularidade dos dados pela sessão autenticada. Mutações financeiras usam consultas com escopo, transações e controles de operação. Senhas usam bcrypt; sessões JWT possuem uma versão para revogação. Após criar o administrador inicial, o cadastro passa a exigir convite.

Credenciais da brapi, Pluggy e carteira Binance usam AES-256-GCM versionado, vinculado ao usuário e ao tipo de credencial. Limites de autenticação e webhook ficam no PostgreSQL. Logs das integrações registram usuários anonimizados, status, duração e contagens, sem conteúdo das credenciais ou respostas financeiras completas.
