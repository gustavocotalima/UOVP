# Melhorado

[English](README.md) · [Diagrama do Cerrado](../diagrama-do-cerrado/README.pt-BR.md)

Método padrão do UOVP, selecionável por usuário em Configurações e compartilhado entre a Carteira e o MCP. A versão 2 usa uma distribuição aproximada e determinística em TypeScript, com o `decimal.js` já existente. Não exige novos pacotes, WebAssembly, Python ou serviço externo.

## Prioridades

1. Equilibrar as classes de investimento conforme as metas.
2. Dentro de cada classe, equilibrar as posições conforme as notas.
3. Aproveitar a sobra do orçamento preservando os dois critérios anteriores.

O valor informado é um teto, nunca uma obrigação de gasto. Uma combinação que usa mais dinheiro não deve vencer apenas por isso se piorar o equilíbrio fora das margens de arredondamento.

As notas representam participações desejadas no patrimônio da classe após o aporte. Notas 2, 3 e 5 correspondem a 20%, 30% e 50%. Adicionar outro ativo de nota 5 muda essas referências para 13,33%, 20%, 33,33% e 33,33%. Os saldos existentes entram no cálculo; um ativo com nota alta que já está acima de sua participação pode não receber novas compras.

O algoritmo só propõe compras. Posições acima das metas permanecem na carteira, e um aporte pequeno pode corrigir apenas parte do desequilíbrio.

## Distribuição e arredondamento

1. Calcular as lacunas positivas das classes sobre o patrimônio existente mais o aporte solicitado. Apenas classes com compras elegíveis recebem uma referência de aporte.
2. Em cada classe, calcular as participações pelas notas positivas e as lacunas dos ativos sobre o patrimônio projetado da classe. Dividir sua referência pelas lacunas positivas dos recebedores elegíveis.
3. Arredondar para incrementos de compra próximos das referências. Se o arredondamento interno ultrapassar o orçamento, reduzir quantidades propostas antes de produzir qualquer resultado.
4. Refinar compras e substituições, nessa ordem de prioridade: validade financeira, equilíbrio das metas, equilíbrio das notas e uso do orçamento. Quantidades já existentes nunca são reduzidas.
5. Retornar a melhor combinação válida encontrada e a sobra exata.

A combinação inicial já considera as notas. O método não começa concentrando cada classe no ativo mais barato. A ordem canônica de ID impede que ordenar a tabela altere o cálculo.

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

A versão 2 exige recalcular rascunhos da versão 1. A migração invalida rascunhos antigos ainda não registrados; histórico executado e aportes aguardando sincronização mantêm seus dados originais. O servidor também recusa executar um cálculo de versão incompatível.

- Preparação e validação financeira: `features/portfolio/calculation/improved.ts`.
- Distribuição e refinamento: `features/portfolio/calculation/balanced-search.ts`.
- Serviço e admissão: `features/portfolio/calculation/server.ts` e `admission.ts`.
- Proporções, posições existentes, sobras e compras inteiras: `tests/unit/allocation-balance.test.ts`.
- Comparações pequenas independentes: `tests/unit/allocation-methods.test.ts`.
- Preferências, histórico e interface/MCP: `tests/integration/allocation-methods.test.ts`.
- Navegador: `cypress/e2e/allocation-methods.cy.ts`.

Capturas financeiras pessoais e seus replays ficam fora do Git. Taxas, mínimos de corretoras e execução de ordens não fazem parte desta distribuição.
