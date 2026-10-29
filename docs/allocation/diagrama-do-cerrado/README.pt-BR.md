# Diagrama do Cerrado

[English](README.md) · [Melhorado](../melhorado/README.pt-BR.md)

Selecionável em Configurações → Sistema de cálculo de aportes. A preferência é individual e vale para a Carteira e para o preview MCP. O padrão do UOVP é Melhorado.

## Origem e alcance

Este motor reproduz a lógica reconstruída por observação das respostas da AUVP. Não contém seu código privado e não consulta sua API para calcular. Paridade significa os mesmos ativos, preços, saldos, notas, metas e ordens de entrada nos cenários verificados; não é uma garantia universal sobre futuras mudanças na AUVP.

Filtros BRL/USD e classes adicionais do UOVP são extensões: a captura oficial usada na investigação recebia apenas o valor do aporte. A classificação da posição continua sendo a definida pelo usuário, inclusive ETFs em renda fixa e reserva de valor.

## Adaptador de orçamento do UOVP (versão 3)

O núcleo reconstruído permanece na versão 1, com as etapas abaixo intactas. O cálculo público primeiro aplica a política comum de orçamento do UOVP; essa extensão não pretende reproduzir uma configuração da AUVP.

“Usar todo o aporte” aparece nos aportes somente em BRL ou somente em USD, desmarcado por padrão. `TARGET_CAPPED` planeja o teto viável de investimento pelas metas globais e pelo patrimônio efetivamente investido. `FULL_BUDGET` executa primeiro esse cálculo normal limitado às metas. Se um teto global deixar pelo menos um centavo de sobra, mantém essas compras como posições existentes e calcula apenas a sobra, usando metas relativas entre as classes elegíveis. Os dois preservam filtros de moeda, notas, preços e incrementos de compra. A opção pertence ao cálculo atual e também está disponível no campo `budgetPolicy` do MCP.

As duas políticas produzem compras idênticas até que um teto global de classe realmente limite o aporte. Arredondamento isolado nunca ativa a segunda etapa. O modo integral só flexibiliza o teto global para a sobra; as regras das notas continuam iguais, e as primeiras compras não podem ser reduzidas nem substituídas.

O adaptador fornece o valor planejado e as metas efetivas de classe ao núcleo original de duas passadas. O núcleo continua aplicando suas lacunas pelas notas, reservas e arredondamentos. Uma proteção final arredonda compras para baixo e verifica novamente as metas quando o denominador diminui, com até 32 passadas e uma saída conservadora. Somente a etapa adicional da sobra dispensa o teto global; ainda pode deixar sobra pelas regras do núcleo. Nenhum modo ultrapassa o orçamento solicitado ou vende posições existentes.

Metas originais e de planejamento, política, valor planejado e motivos da sobra ficam nos diagnósticos. Resultados em duas etapas também registram o investimento inicial, seu orçamento restante e o investimento adicional. As quantidades e os valores retornados somam as duas etapas por ativo, sem alterar as primeiras compras. Percentuais finais exibidos sempre usam o patrimônio total original mais o investimento efetivo. Rascunhos antigos não registrados exigem novo cálculo; histórico registrado e aguardando sincronização é preservado. Testes de paridade do núcleo ficam separados dos testes do adaptador.

## Etapas

1. Some o patrimônio e o aporte solicitado para obter a referência final.
2. Para cada classe com meta positiva e recebedores elegíveis, calcule `máximo(0, referência final × meta − saldo atual da classe)`.
3. Divida o orçamento da passada proporcionalmente a essas lacunas.
4. Dentro de cada classe, calcule o patrimônio elegível após seu aporte. A referência de cada ativo é esse patrimônio multiplicado pela sua nota e dividido pela soma das notas positivas elegíveis. Distribua o orçamento pelas diferenças positivas entre referências e saldos.
5. Arredonde compras de ativos inteiros para baixo. Ativos fracionários recebem o valor proporcional. A segunda passada tenta distribuir a sobra.

O comportamento observado inclui uma reserva entre passadas. Na ordem de inclusão, cada ativo inteiro que recebeu orçamento teórico positivo, mas nenhuma unidade, reserva o preço de uma cota. Quando a reserva não cabe no saldo restante, o ativo é omitido da segunda passada. A reserva é descontada mesmo quando não cabe; os seguintes também podem ser omitidos. As omissões afetam o saldo e a elegibilidade considerados na segunda passada.

A distribuição usa ordem de ticker; a reserva usa a ordem estável de inclusão (`createdAt` e ID). Ordenar uma tabela na interface não muda essas ordens. Entradas offline podem fornecer sua ordem original explicitamente.

As antigas aproximações de completar uma cota a partir de 94% e reter 99,48% de compras fracionárias foram removidas. Nenhuma tolerância do Melhorado é aplicada aqui.

## Valores e limitações

Ativos com nota não positiva, meta zero, preço inválido ou fora do filtro não recebem compras. As regras de omissão podem deixar uma sobra maior e alterar a distribuição. Isso é preservado para compatibilidade.

O resultado identifica método e versão. Os percentuais finais exibidos pelo UOVP usam todo o patrimônio inicial mais o investimento efetivo, sem contar a sobra. A persistência arredonda quantidades e valores fracionários para baixo em dez casas para respeitar a precisão do banco e o orçamento. A diferença subcentavo dessa apresentação não é uma nova regra de distribuição.

Trocar de método invalida rascunhos e exige novo cálculo. Histórico executado e aportes aguardando sincronização são preservados. O MCP só retorna uma prévia; calcular nunca envia ordens ao mercado.

Os dois métodos compartilham o limite por conta de um cálculo em andamento e seis inícios por minuto móvel em cada processo do servidor, somando interface e clientes MCP. Veja os [limites de execução](../melhorado/README.pt-BR.md#precisão-e-execução).

## Implementação e verificação

- Motor puro: `features/portfolio/calculation/cerrado.ts`.
- Serviço comum: `features/portfolio/calculation/server.ts`.
- Núcleo Decimal com precisão 40; planejamento comum com precisão 60; sem mudanças globais de precisão.
- Testes sintéticos são versionados. Capturas pessoais e seus replays ficam fora do Git.
- A execução local verifica a reconstrução contra as capturas disponíveis. Os testes de integração cobrem seleção, isolamento, invalidação e equivalência entre interface e MCP.

O adaptador limitado tolera apenas o efeito calculável do arredondamento para baixo das quantidades fracionárias e dos valores de outras classes em dez casas sobre a meta. Não amplia o orçamento nem aplica as margens por cota do Melhorado. Isso impede que diferenças subcentavo de liquidação eliminem progressivamente um conjunto equilibrado de compras.
