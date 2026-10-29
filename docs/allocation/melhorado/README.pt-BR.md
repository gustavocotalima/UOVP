# Melhorado

[English](README.md) · [Diagrama do Cerrado](../diagrama-do-cerrado/README.pt-BR.md)

Método padrão do UOVP, selecionável por usuário em Configurações e compartilhado entre a Carteira e o MCP. A versão 4 usa uma distribuição aproximada e determinística em TypeScript, com o `decimal.js` já existente. Não exige novos pacotes, WebAssembly, Python ou serviço externo.

## Prioridades

1. Equilibrar as classes de investimento conforme as metas.
2. Dentro de cada classe, equilibrar as posições conforme as notas.
3. Aproveitar a sobra do orçamento preservando os dois critérios anteriores.

O valor informado é um teto, nunca uma obrigação de gasto. Uma combinação que usa mais dinheiro não deve vencer apenas por isso se piorar o equilíbrio fora das margens de arredondamento.

As notas representam participações desejadas no patrimônio da classe após o aporte. Notas 2, 3 e 5 correspondem a 20%, 30% e 50%. Adicionar outro ativo de nota 5 muda essas referências para 13,33%, 20%, 33,33% e 33,33%. Os saldos existentes entram no cálculo; um ativo com nota alta que já está acima de sua participação pode não receber novas compras.

O algoritmo só propõe compras. Posições acima das metas permanecem na carteira, e um aporte pequeno pode corrigir apenas parte do desequilíbrio.

## Política de orçamento

Os dois métodos oferecem “Usar todo o aporte” nos cálculos somente em BRL ou somente em USD, desmarcado por padrão. Alterar a opção descarta a prévia exibida e exige novo cálculo; não muda preferências da conta nem posições.

- `TARGET_CAPPED`: preservar metas globais, com as margens conforme as cotas descritas abaixo. Posições fora do filtro de moeda continuam no patrimônio total. O planejamento encontra o teto contínuo de investimento usando o aporte efetivo, sem contar o saldo não investido como patrimônio.
- `FULL_BUDGET`: executar primeiro o cálculo normal limitado às metas e preservar todas as compras sugeridas. Se um limite global deixar sobra de pelo menos um centavo, calcular apenas essa sobra entre as classes elegíveis, com suas metas positivas originais normalizadas para 100%. Os saldos iniciais da segunda etapa já incluem as compras da primeira. Preservar proporções das notas, incrementos de compra e posições acima da proporção ou excluídas. Somar quantidades e valores adicionais por ativo; nenhuma etapa pode desfazer compras da primeira.

Até que um teto global de classe limite o aporte, as duas políticas produzem quantidades, valores e sobras idênticos. Arredondamento isolado não ativa a segunda etapa. A opção só flexibiliza limites globais das classes para a sobra; nunca muda as proporções das notas nem dispensa seus limites.

Por exemplo, com somente USD e metas de 15% em ações internacionais e 2% em reserva de valor, o modo integral busca a relação 15:2 entre os saldos finais das classes elegíveis (88,24% / 11,76%), em vez de dividir apenas o dinheiro novo nessa proporção. As metas originais permanecem iguais e são registradas junto às metas de planejamento.

“Usar todo” é uma tentativa: metas zero, notas não positivas, preços ausentes, exclusões por moeda, cotas inteiras e margens de equilíbrio continuam valendo. Conservar o orçamento é obrigatório nos dois modos.

## Distribuição e arredondamento

1. Planejar a distribuição normal limitada dos saldos completos das classes e, depois, dos ativos em cada classe, incluindo o patrimônio existente. Os dois modos preservam a capacidade das notas. O modo integral pode então aplicar a mesma distribuição à sobra, mantendo as primeiras compras como saldos existentes e usando metas relativas somente às classes elegíveis.
2. Converter o conjunto completo de compras para as quantidades permitidas. Considerar arredondamentos próximos do conjunto inteiro, em vez de tentar aumentar uma classe equilibrada ativo por ativo.
3. Refinar compras isoladas, pares, substituições, conjuntos completos de classe e da carteira, nessa ordem: validade financeira, equilíbrio das metas, equilíbrio das notas e uso do orçamento.
4. Recalcular com Decimal e retornar a melhor combinação válida e a sobra exata.

Movimentos coordenados permitem que três ou mais ativos fracionários equilibrados cresçam juntos. Eles evitam o bloqueio anterior nos filtros somente USD/BRL, causado pelas margens de notas rejeitarem compras intermediárias de um ativo ou de um par. A ordem canônica de ID impede que ordenar a tabela altere o cálculo. Quantidades existentes nunca são reduzidas.

## Margens conforme as cotas

Cotas inteiras impedem proporções exatas em todos os aportes. As comparações usam margens monetárias de arredondamento, em vez de sacrificar as notas para ganhar um centavo na meta de uma classe.

Para cada classe, considere sua menor compra elegível e acessível pelo orçamento, em BRL. A margem é R$ 0,01 mais o maior entre:

- Metade desse incremento, quando todas as classes com meta positiva têm recebedores acessíveis.
- A meta da classe multiplicada pela soma dos incrementos das outras classes.
- A compensação necessária pelo arredondamento para baixo das quantidades fracionárias de outras classes.

Uma posição recebe margem de um incremento de compra, mais a compensação das perdas fracionárias das outras posições da classe. Notas não positivas, metas zero, preços zero e exclusões por moeda impedem compras. Posições excluídas mantêm seu patrimônio no denominador e não precisam atender à grade de uma compra que não receberão.

As margens não ampliam o orçamento. Compras de classes ou ativos que ultrapassem seus limites superiores são rejeitadas. Em aportes pequenos, uma única cota pode representar uma diferença percentual relevante.

## Precisão e execução

Reservas usam centavos inteiros. Passos fracionários de pelo menos um centavo precisam de uma grade de liquidação explícita em centavos; instrumentos inteiros também exigem preços nessa grade. Quantidades fracionárias são arredondadas para baixo ao passo permitido e à precisão de dez casas do banco.

A busca numérica não decide a validade financeira final: Decimal com precisão 60 recalcula os valores e verifica orçamento, limites das classes e proporções das notas. A sobra conserva o orçamento, incluindo câmbio, na precisão suportada pelo banco.

O refinamento é local e limitado, sem promessa de ótimo global. Ele encerra quando não encontra uma melhoria no conjunto de movimentos considerado, após 64 a 256 iterações conforme o tamanho da carteira, ou após três segundos. Os diagnósticos registram prioridades, iterações, avaliações e motivo da parada. O término normal não gera o antigo aviso de falta de comprovação matemática.

O modelo aceita até 256 grupos de ativos. Workers nativos do Node executam fora da thread principal e das transações: dois simultâneos, fila de até 16 e memória limitada por worker. O serviço aceita um cálculo em andamento e seis inícios por minuto móvel por conta, somando interface, MCP e os dois métodos. O controle fica na memória de cada processo do servidor.

## Histórico e verificação

Os cálculos são retornados ao navegador sem salvar simulações ou sugestões. O resultado permanece fixo até clicar em Calcular novamente, inclusive durante o registro das compras. Compras manuais atualizam quantidade e custo da posição, sem histórico local de operações. Apenas pendências de sincronização são gravadas e são removidas após a confirmação.

- Preparação e validação financeira: `features/portfolio/calculation/improved.ts`.
- Planejamento do orçamento: `features/portfolio/calculation/budget-policy.ts`.
- Distribuição e refinamento: `features/portfolio/calculation/balanced-search.ts`.
- Serviço e admissão: `features/portfolio/calculation/server.ts` e `admission.ts`.
- Proporções, posições existentes, sobras e compras inteiras: `tests/unit/allocation-balance.test.ts`.
- Comparações pequenas independentes: `tests/unit/allocation-methods.test.ts`.
- Preferências, pendências e interface/MCP: `tests/integration/allocation-methods.test.ts`.
- Navegador: `cypress/e2e/allocation-methods.cy.ts` e `allocation-budget-policy.cy.ts`.

Capturas financeiras pessoais e seus replays ficam fora do Git. Taxas, mínimos de corretoras e execução de ordens não fazem parte desta distribuição.

Regressões de políticas e compras coordenadas: `tests/unit/allocation-budget-policy.test.ts`; preservação das primeiras compras, totais das duas etapas e proporções finais: `tests/unit/allocation-two-stage.test.ts`; os dois filtros de moeda, métodos e políticas na interface/MCP: `tests/integration/allocation-methods.test.ts`.
