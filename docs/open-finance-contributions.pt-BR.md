# Aportes do Open Finance

[English](open-finance-contributions.en.md)

Registrar uma compra já realizada em um investimento por unidades do Open Finance atualiza imediatamente a quantidade no UOVP. O registro não envia ordens nem altera dados do provedor. Selecione a posição/instituição quando houver várias. O preço pago registra o custo; cotações e câmbio atuais continuam determinando o valor de mercado.

O lote começa na quantidade exibida, incluindo uma correção manual existente. Com 100 unidades e compras de 10 e 5, o UOVP exibe 115. O provedor em 100 mantém ambas pendentes. Uma quantidade de 110 confirma a primeira, incorpora seu custo ao custo-base e remove sua pendência; 115 confirma o restante e remove também o lote. Outra quantidade, como 112, exige revisão.

“Usar quantidade da instituição” adota a posição do provedor e remove as pendências resolvidas. “Manter quantidade manual” conserva temporariamente a posição esperada. Snapshots idênticos reconhecidos não repetem o aviso; uma correspondência posterior restaura a sincronização automática, enquanto outra mudança não explicada exige revisão novamente.

Somente quantidades comparáveis de snapshots válidos contam, com precisão de dez casas decimais. Mudanças isoladas de preço, câmbio ou data não confirmam compras. Quantidades ausentes e conexões indisponíveis também não confirmam. Snapshots sem data de atualização exigem revisão explícita. O custo projetado usa o custo-base mais as compras ainda pendentes, sem duplicar movimentações importadas; um custo desconhecido continua desconhecido.

ETFs como AUPO11 seguem o fluxo por unidades mesmo alocados em renda fixa. Produtos como CDBs aguardam sincronização sem aumentar temporariamente o saldo. Binance e saldos bancários mantêm seus fluxos de confirmação existentes.

Compras manuais atualizam somente quantidade e custo da posição, sem histórico local de operações. Apenas pendências e lotes ativos de conciliação são persistidos. Manter uma posição desconectada como manual materializa a quantidade efetiva uma única vez e remove suas pendências. Excluir o ativo ou sua classe resolve a projeção antes de remover a posição.

Os resultados do cálculo permanecem na memória do navegador até clicar em Calcular novamente. Atualizações das integrações e registros de compra não invalidam nem recalculam a lista. Aportes por unidades do Open Finance conferem a quantidade exibida da posição selecionada no momento do registro; uma mudança na quantidade exige conferir a posição antes de somar unidades, enquanto mudanças isoladas de preço, câmbio e data não bloqueiam o registro. Registros e decisões continuam coordenados pela trava operacional existente; decisões de conflito desatualizadas são recusadas.

Pendências migradas sem um lote seguro exigem revisão explícita. Aplique a [migração de pendências](pending-contributions-migration.md) com a versão anterior parada.
