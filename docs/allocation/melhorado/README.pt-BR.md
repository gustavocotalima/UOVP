# Melhorado

[English](README.md) · [Diagrama do Cerrado](../diagrama-do-cerrado/README.pt-BR.md)

Método padrão do UOVP, selecionável por usuário em Configurações e compartilhado entre a Carteira e o MCP. A versão 3 usa uma distribuição aproximada e determinística em TypeScript, com o `decimal.js` já existente. Não exige novos pacotes, WebAssembly, Python ou serviço externo.

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
- `FULL_BUDGET`: permitir ultrapassar as metas globais. Distribuir os saldos finais das classes elegíveis proporcionalmente às metas positivas originais, usando posições existentes como limites mínimos imutáveis. Dentro de cada classe, fazer o mesmo com as notas positivas. Posições acima da proporção ou excluídas são mantidas; apenas posições elegíveis abaixo da proporção recebem compras até as demais alcançarem o equilíbrio.

Por exemplo, com somente USD e metas de 15% em ações internacionais e 2% em reserva de valor, o modo integral busca a relação 15:2 entre os saldos finais das classes elegíveis (88,24% / 11,76%), em vez de dividir apenas o dinheiro novo nessa proporção. As metas originais permanecem iguais e são registradas junto às metas de planejamento.

“Usar todo” é uma tentativa: metas zero, notas não positivas, preços ausentes, exclusões por moeda, cotas inteiras e margens de equilíbrio continuam valendo. Conservar o orçamento é obrigatório nos dois modos.

## Distribuição e arredondamento

1. Planejar uma distribuição proporcional limitada dos saldos completos das classes e, depois, dos ativos em cada classe, incluindo o patrimônio existente. No modo limitado, restringir o valor pelas metas globais e pela capacidade das notas; no modo integral, derivar participações de planejamento viáveis dos saldos finais proporcionais.
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

A versão 3 exige recalcular rascunhos de versões anteriores. A migração invalida rascunhos antigos ainda não registrados; histórico executado e aportes aguardando sincronização mantêm seus dados originais. O servidor também recusa executar um cálculo de versão incompatível.

- Preparação e validação financeira: `features/portfolio/calculation/improved.ts`.
- Planejamento do orçamento: `features/portfolio/calculation/budget-policy.ts`.
- Distribuição e refinamento: `features/portfolio/calculation/balanced-search.ts`.
- Serviço e admissão: `features/portfolio/calculation/server.ts` e `admission.ts`.
- Proporções, posições existentes, sobras e compras inteiras: `tests/unit/allocation-balance.test.ts`.
- Comparações pequenas independentes: `tests/unit/allocation-methods.test.ts`.
- Preferências, histórico e interface/MCP: `tests/integration/allocation-methods.test.ts`.
- Navegador: `cypress/e2e/allocation-methods.cy.ts` e `allocation-budget-policy.cy.ts`.

Capturas financeiras pessoais e seus replays ficam fora do Git. Taxas, mínimos de corretoras e execução de ordens não fazem parte desta distribuição.

Regressões de políticas e compras coordenadas: `tests/unit/allocation-budget-policy.test.ts`; os dois filtros de moeda, métodos e políticas na interface/MCP: `tests/integration/allocation-methods.test.ts`.
