# Conexão MCP do UOVP

[English](./mcp.en.md)

O UOVP oferece um servidor privado de Model Context Protocol (MCP), somente para leitura e análise financeira. Cada usuário precisa habilitar o acesso e autorizar cada cliente separadamente. O UOVP não exige publicação em um diretório público de plugins nem chave de API da OpenAI.

## O que os agentes podem fazer

- Ler resumos financeiros, orçamento, metas, saldos, cartões, faturas e transações permitidos.
- Analisar alocação, posições, operações disponíveis, notas e informações efetivas dos investimentos.
- Simular a distribuição de um aporte sem salvar nem executar um investimento.
- Ler o levantamento separado de bens e dívidas.
- Consultar datas de atualização e avisos sobre dados incompletos.

Agentes não podem editar registros, alterar saldos, negociar, executar transferências, sincronizar bancos nem obter credenciais dos provedores. Autorizações e registros mínimos de acesso são persistidos; consultas financeiras não criam registros nem configurações financeiras padrão.

## Habilitar o acesso no UOVP

1. Abra **Configurações → Agentes de IA / MCP**.
2. Clique em **Habilitar MCP**. Isso permite autorizações; não dá acesso automático a um cliente.
3. Copie a URL exibida. Na instalação de produção:

   ```text
   https://uovp.cotalima.com.br/api/mcp
   ```

4. Cadastre a URL no cliente de IA usando **Streamable HTTP** e **OAuth**.
5. Quando o cliente abrir o UOVP, entre na sua conta e confira nome, callback e permissões. Selecione apenas os dados que deseja compartilhar e clique em **Autorizar leitura**.

Se aparecer o aviso de configuração do servidor, o administrador precisa concluir a configuração OAuth antes de habilitar o acesso.

## Permissões

| Escopo | Informações compartilhadas |
| --- | --- |
| `finance:read` | Resumos, orçamento, metas, histórico mensal, movimentação por tags e saídas por dia. |
| `accounts:read` | Saldos, limites de cartões, faturas e informações de câmbio. |
| `transactions:read` | Valores, descrições, datas, nomes das contas e classificação de transações individuais. |
| `portfolio:read` | Posições, alocação, operações disponíveis, notas, metadados e simulações sem salvar. |
| `balance-sheet:read` | Levantamento separado de bens e dívidas. |

O Client ID identifica o cliente; não é senha nem autorização. As permissões são verificadas em cada requisição e consulta de registro. O agente não pode escolher outro usuário do UOVP.

`get_financial_summary` e o documento de discovery `summary:AAAA-MM` exigem `finance:read`. O campo `currentAccountTotals` só é consultado e preenchido quando a conexão também possui `accounts:read`; sem essa permissão, ele é `null`, não um saldo zero. Nesse caso, `complete` considera apenas os valores financeiros autorizados, e os avisos não incluem informações de câmbio ou sobreposição de contas omitidas. Uma conexão com somente `accounts:read` pode usar `list_accounts`, mas não obter o resumo financeiro. A ausência de permissão não é tratada como ausência de dados.

## Codex

Em um Codex CLI compatível, cadastre o servidor remoto e inicie o login OAuth:

```bash
codex mcp add uovp --url https://uovp.cotalima.com.br/api/mcp
codex mcp login uovp
```

Conclua a autorização do UOVP no navegador. `codex mcp list` mostra o servidor configurado; `/mcp` no CLI mostra as ferramentas ativas. Consulte a [documentação oficial da OpenAI sobre MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) para opções e compatibilidade da versão do cliente.

Se o cliente exigir cadastro prévio, use **Cliente personalizado / configuração avançada** no UOVP. Cadastre o callback informado pelo cliente e use o Client ID recebido:

```bash
codex mcp add uovp --url https://uovp.cotalima.com.br/api/mcp --oauth-client-id SEU_CLIENT_ID
codex mcp login uovp
```

Callbacks nativos usam `http://127.0.0.1/callback`, com a porta local escolhida pelo cliente. Confira o host e o caminho exibidos; não use curingas nem um callback presumido. Callbacks HTTPS precisam corresponder exatamente à URL cadastrada.

## ChatGPT

No ChatGPT web, abra **Plugins → + → Add custom MCP server**, informe a URL do UOVP, selecione OAuth e conclua a conexão. Instale o plugin privado criado antes de usá-lo em uma conversa. Políticas da conta ou workspace podem restringir conexões personalizadas. Veja o [guia oficial para servidor MCP personalizado](https://developers.openai.com/api/docs/guides/custom-mcp-server).

O ChatGPT web não lê a configuração MCP local do Codex. Configure e autorize os dois separadamente. Se precisar fornecer um cliente já cadastrado, registre o callback exato mostrado pelo ChatGPT e use o Client ID do UOVP; clientes públicos não possuem Client Secret.

## Outros agentes

Use um cliente com suporte a MCP remoto autenticado, Streamable HTTP e Authorization Code com PKCE `S256`. Ele precisa seguir os metadados OAuth do UOVP, preservar o parâmetro `resource` e tratar expiração e revogação. Para clientes sem identificação automática compatível, cadastre seus callbacks exatos no UOVP.

Não há campo de API key ou bearer token fixo para usuários. O cookie de login do navegador não autoriza requisições MCP.

## Significado financeiro e atualização

- Relatórios são consolidados em BRL. Contas e posições em outras moedas incluem valor original e equivalente BRL correspondente.
- A cotação de uma transação permanece histórica; o câmbio atual da conta não substitui a conversão de lançamentos antigos.
- Custos de posições informam `investedValue` e `investedValueCurrency` separadamente da moeda da cotação. `investedValueNative` só é preenchido quando a moeda do custo corresponde à moeda nativa da posição; custos legados ambíguos têm moeda `null` e `costBasisIssue: "UNKNOWN_COST_CURRENCY"`. O câmbio atual não reconstrói custos históricos desconhecidos.
- Resumos e metas usam a compensação líquida existente, por meta e mês. O calendário mantém o valor integral dos lançamentos; tags representam entradas e saídas reais.
- Exclusões dos relatórios, transferências internas, câmbio ausente, disponibilidade do provedor e estados de revisão/acompanhamento seguem as regras do app.
- Informações efetivas do investimento ficam separadas do último valor original do provedor. Histórico incompleto não permite presumir rentabilidade completa.
- Respostas informam momento da consulta, datas relevantes de sincronização/cotação/câmbio e limites de cobertura. Valores desconhecidos não viram zero silenciosamente.
- Consultas MCP não chamam Pluggy, sincronização Binance ou atualização de mercado. Se os dados estiverem antigos, atualize pelo UOVP e pergunte novamente. O app autenticado continua com seu coordenador automático existente.
- Listas possuem limites e paginação. O agente precisa seguir as páginas para obter uma lista completa; agregados usam todo o escopo solicitado, não apenas a página retornada.

Exemplos de perguntas:

> Compare minhas despesas líquidas deste mês com o anterior e explique as maiores mudanças. Separe os valores brutos das transações da compensação das metas.

> Compare a carteira com as metas e simule um aporte de R$ 1.500 sem salvar nada. Informe preços ausentes e dados incompletos.

## Revogação e privacidade

Em **Agentes autorizados**, use **Revogar acesso** para um cliente ou **Revogar todos**. **Desabilitar MCP** também revoga os acessos existentes. Uma nova autorização será necessária depois. Sair da sessão comum do UOVP não equivale a revogar um agente.

As informações financeiras consultadas dentro das permissões são enviadas ao provedor de IA escolhido e seguem suas políticas. Revogar bloqueia consultas futuras, mas não recupera dados já recebidos nem os remove de conversas anteriores. DTOs MCP não expõem segredos dos provedores, CPF, números completos de conta/cartão ou payloads completos das integrações.

## Configuração do servidor e deploy

Use Node.js 22 ou mais recente e o processo de publicação existente no Coolify. Faça backup do PostgreSQL e aplique a migration MCP antes de disponibilizar o recurso. O acesso permanece desabilitado para cada usuário até a habilitação voluntária.

| Variável | Finalidade |
| --- | --- |
| `AUTH_URL` | Origem canônica HTTPS pública usada por recursos e callbacks OAuth. HTTP local é apenas para desenvolvimento. |
| `MCP_OAUTH_SIGNING_KEYS` | Keyring independente de assinatura, como `v1:<chave-base64url>`; cada chave decodificada deve ter exatamente 32 bytes. |
| `MCP_OAUTH_ACTIVE_KEY` | Identificador da chave ativa, como `v1`. |

Gere chaves novas e independentes com um gerador criptograficamente seguro. Não reutilize `AUTH_SECRET`, chaves de criptografia de credenciais ou segredos de provedores. Guarde as chaves apenas no gerenciador de segredos do servidor. Na rotação, mantenha as anteriores até que os tokens afetados deixem de ser válidos e selecione a nova chave ativa.

Mantenha o PostgreSQL privado e não coloque respostas financeiras em Redis compartilhado ou CDN. Respostas OAuth/MCP não devem ter cache público. O proxy deve preservar a origem HTTPS canônica e cabeçalhos Authorization. Nenhuma porta pública adicional é necessária.

Os metadados ficam em `/.well-known/oauth-authorization-server` e `/.well-known/oauth-protected-resource/api/mcp` (com um alias na raiz para o recurso protegido). A autorização usa `/mcp/authorize`; troca e revogação de tokens usam `/api/mcp/oauth/token` e `/api/mcp/oauth/revoke`.

Códigos de autorização expiram em cinco minutos. Tokens de acesso duram 15 minutos; refresh tokens são rotacionados e expiram em 30 dias. Requisições MCP têm limite de 60 por usuário/minuto e 120 por par usuário/cliente por minuto. Páginas retornam 50 registros por padrão e no máximo 100; consultas detalhadas abrangem até 12 meses. A auditoria mínima tem uma janela de retenção de 30 dias, com remoção dos registros vencidos durante atividades posteriores.

Registros OAuth encerrados também têm retenção de 30 dias após a última expiração ou revogação da família. Códigos consumidos e refresh tokens rotacionados permanecem enquanto qualquer descendente puder autenticar ou renovar, preservando a revogação por replay. Após consentimento e emissão/rotação, uma limpeza limitada a 100 tokens, 100 códigos e 100 autorizações por execução remove somente registros elegíveis. Ela respeita o lock do usuário, não bloqueia uma emissão em andamento e não apaga clientes cadastrados.

Para backlog de usuários sem atividade, use `pnpm exec tsx scripts/cleanup-mcp-oauth.ts --user-id=ID` para visualizar o próximo lote elegível, sem gravações. Para aplicar, acrescente `--apply`; `--max-batches=100` limita o trabalho total. Sem `--user-id`, a manutenção percorre usuários com autorizações por cursor. A prévia não soma registros que só se tornarão elegíveis após remover lotes anteriores; usuários ocupados são preservados e podem ser tratados numa execução posterior.

Se atingir o limite global, retome com `--after-user-id=ID` usando o `resumeAfterUserId` retornado no resumo. Um usuário com lotes ainda pendentes não avança esse cursor; repetir a execução continua seu backlog antes de avançar.

## Problemas comuns

- **Aviso de configuração:** confira a origem canônica e o keyring OAuth independente; publique novamente.
- **Autorização indisponível:** confirme que o MCP está habilitado para o usuário autenticado. Reinicie a conexão no cliente em vez de reutilizar uma URL antiga.
- **Callback rejeitado:** cadastre a URL HTTPS exata ou o host/caminho local suportado informado pelo cliente.
- **Acesso não autorizado ou revogado:** faça login OAuth novamente. Não cole cookies do navegador nem chaves dos provedores no cliente.
- **Ferramenta ausente ou negada:** confira o escopo necessário e autorize novamente com a permissão correspondente.
- **Valores mudaram entre consultas:** confira os horários de consulta e sincronização; requisições diferentes não compartilham uma fotografia congelada.
- **Cotação ou histórico incompleto:** atualize ou corrija pelo UOVP. O agente deve preservar os avisos e não inventar valores ausentes.

## Validação

Use banco de teste dedicado, com migrations aplicadas e segredos independentes. Valide OAuth, isolamento por escopo/usuário, revogação, protocolo, paridade dos cálculos, paginação e ausência de alterações financeiras/chamadas a provedores. Execute typecheck, testes unitários/de integração, Cypress, lint e build de produção antes do deploy. A conexão real também precisa ser conferida nas contas de destino do ChatGPT/Codex; testes automatizados não confirmam disponibilidade do recurso na conta.
