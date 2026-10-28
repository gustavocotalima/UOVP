# Melhorado

[English](README.md) · [Diagrama do Cerrado](../diagrama-do-cerrado/README.pt-BR.md)

Método padrão do UOVP, selecionável por usuário em Configurações. A interface e o MCP usam a mesma preferência e o mesmo serviço. A implementação é própria, em TypeScript, com o `decimal.js` já existente. Não exige WebAssembly, Python, serviço externo ou pacote adicional.

## Objetivos, em ordem

1. Maximizar o valor reservado sem ultrapassar o orçamento.
2. Mantendo esse valor, minimizar a soma dos desvios monetários das referências de classe.
3. Mantendo a melhor distribuição de classe encontrada, minimizar os desvios das referências dos ativos, orientadas pelas notas.

Para o valor investível encontrado, a referência de cada classe divide esse valor proporcionalmente às lacunas positivas até suas metas sobre o patrimônio final. A referência de cada ativo divide a referência da classe pelas lacunas positivas até a distribuição indicada pelas notas. Posições existentes continuam na base mesmo que não recebam compras. O desempate usa ordem canônica de ID, independente da tabela.

Essa prioridade pode alterar bastante a distribuição entre ativos da mesma classe: uma aproximação mais exata da meta de classe vem antes da preferência individual das notas.

## Tolerância conforme as cotas

Encontre a menor compra elegível de cada classe, em BRL. Ativos inteiros usam uma cota; fracionários usam seu passo de quantidade convertido em dinheiro, com piso de um centavo da grade de reserva. Limite esse passo ao orçamento. Nota não positiva, preço zero, meta zero e exclusão por moeda não ampliam a margem.

Para uma classe `i`, com meta como fração entre 0 e 1:

```text
tolerância_i = R$ 0,01 + meta_i × soma(menores compras das outras classes)
```

Quando outra classe arredonda uma compra para baixo, a participação de `i` aumenta. A margem cobre esse efeito sem exigir encaixes exatos entre cotas. Ela limita o excesso de uma classe que recebe compras; o orçamento nunca recebe tolerância.

Exemplo sintético: classes 50/50, cotas de R$ 99 e R$ 100, orçamento R$ 5.000. A regra quase exata de um centavo não compra nada. Este método compra 25 cotas de cada: R$ 4.975, sobra R$ 25, pesos 49,7487% e 50,2513%.

Para carteira inicialmente vazia com todas as classes elegíveis, arredondar a referência contínua para baixo fornece uma combinação cuja sobra é menor que a soma dos passos de classe. Isso não garante gastar tudo quando faltam recebedores ou existe patrimônio preexistente desequilibrado.

## Busca e precisão

A busca inteira própria usa relaxações lineares, ramificação e poda. Uma combinação inicial viável de cotas dá um limite inicial; o motor considera substituições, não apenas compras adicionais. A primeira etapa maximiza centavos reservados. Cada etapa seguinte fixa o resultado anterior, com folga numérica de 0,00001 centavo nos objetivos de distribuição.

Os números de ponto flutuante da busca não são aceitos como prova de segurança financeira. Decimal com precisão 60 recalcula o resultado, verifica as metas, arredonda quantidades para baixo e exige `gasto ≤ reservado ≤ orçamento`. Valores persistidos também são arredondados para baixo em dez casas. A sobra conserva o orçamento exato, incluindo câmbio, na precisão suportada pelo banco.

Passos fracionários monetários de pelo menos um centavo usam seus incrementos exatos. Passos grossos que exigem liquidação em fração de centavo são rejeitados até existir uma grade explícita. Cotações de instrumentos inteiros também precisam dessa grade em centavos.

As restrições da grade valem somente para compras elegíveis. Posições excluídas, notas não positivas e classes com meta zero mantêm toda a sua avaliação existente sem precisar atender a uma grade de compra.

## Limites de execução

O cálculo roda em workers nativos do Node, fora da thread principal e das transações do banco. Há no máximo dois workers simultâneos, fila limitada a 16 e limite de memória por worker. Cada etapa tem três segundos e até 10.000 nós de busca. O modelo aceita até 256 grupos de ativos para limitar sua memória.

Antes de montar o modelo, o serviço comum aceita no máximo um cálculo em andamento e seis inícios por minuto móvel por conta autenticada, somando interface, clientes MCP e os dois métodos. Assim, uma conta não consegue ocupar toda a fila FIFO dos workers. O MCP informa erros de ferramenta com os códigos `ALLOCATION_BUSY` ou `ALLOCATION_RATE_LIMIT`. Esses limites operacionais ficam na memória de cada processo do servidor; reiniciá-lo zera a janela.

Se um limite ou dificuldade numérica impedir a comprovação, o resultado informa isso. Uma combinação válida pode ser exibida com aviso; ela não é apresentada como ótimo comprovado. Se nenhuma combinação válida for encontrada, o cálculo falha explicitamente. O método nunca muda silenciosamente para Cerrado.

Sobras ainda podem ser necessárias por preços indivisíveis, filtros de moeda, falta de classes elegíveis ou posições acima da meta. A margem pode representar muitos pontos percentuais em aportes pequenos diante das cotas. Taxas, mínimos específicos de corretoras e execução de ordens não fazem parte do cálculo.

## Configuração, histórico e testes

Contas novas e existentes começam em Melhorado. Trocar de método invalida rascunhos. Registros executados e aguardando sincronização são preservados; simulações antigas não são relabeladas como resultados deste motor.

- Regras e objetivos: `features/portfolio/calculation/improved.ts`.
- Busca própria: `features/portfolio/calculation/integer-search.ts`.
- Worker e serviço compartilhado: `features/portfolio/calculation/server.ts`.
- Admissão por conta e regressões de rajadas: `features/portfolio/calculation/admission.ts` e `tests/unit/allocation-admission.test.ts`.
- Testes unitários com enumeração independente: `tests/unit/allocation-methods.test.ts`.
- Integração: `tests/integration/allocation-methods.test.ts`.
- Navegador: `cypress/e2e/allocation-methods.cy.ts`.

As capturas financeiras pessoais ficam fora do repositório. As verificações locais incluem comparação com a referência offline e casos de cotas sem fracionários.
