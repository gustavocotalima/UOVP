# Diagrama do Cerrado

[English](README.md) · [Melhorado](../melhorado/README.pt-BR.md)

Selecionável em Configurações → Sistema de cálculo de aportes. A preferência é individual e vale para a Carteira e para o preview MCP. O padrão do UOVP é Melhorado.

## Origem e alcance

Este motor reproduz a lógica reconstruída por observação das respostas da AUVP. Não contém seu código privado e não consulta sua API para calcular. Paridade significa os mesmos ativos, preços, saldos, notas, metas e ordens de entrada nos cenários verificados; não é uma garantia universal sobre futuras mudanças na AUVP.

Filtros BRL/USD e classes adicionais do UOVP são extensões: a captura oficial usada na investigação recebia apenas o valor do aporte. A classificação da posição continua sendo a definida pelo usuário, inclusive ETFs em renda fixa e reserva de valor.

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

## Implementação e verificação

- Motor puro: `features/portfolio/calculation/cerrado.ts`.
- Serviço comum: `features/portfolio/calculation/server.ts`.
- Aritmética local Decimal com precisão 40; sem mudanças globais de precisão.
- Testes sintéticos são versionados. Capturas pessoais e seus replays ficam fora do Git.
- A execução local verifica a reconstrução contra as capturas disponíveis. Os testes de integração cobrem seleção, isolamento, invalidação e equivalência entre interface e MCP.
