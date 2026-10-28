# Aportes do Open Finance

[English](open-finance-contributions.en.md)

Registrar uma compra já realizada em um investimento por unidades do Open Finance atualiza imediatamente a quantidade no UOVP. O registro não envia ordens nem altera dados do provedor. Selecione a posição/instituição quando o ativo tiver várias posições. O preço pago registra o custo; cotações e câmbio atuais continuam determinando o valor de mercado.

O lote começa na quantidade exibida no UOVP, incluindo uma correção manual existente. Os aportes acumulam uma quantidade esperada absoluta. Os dados recebidos da instituição permanecem separados: o total pendente nunca é somado novamente de forma cega a cada sincronização.

Com 100 unidades e compras de 10 e 5, o UOVP exibe 115. A quantidade do provedor mantida em 100 deixa ambas as compras pendentes. Uma nova quantidade de 110 confirma a primeira compra e mantém 115 em uso, com 5 pendentes. A quantidade de 115 confirma o restante e restaura a sincronização automática. Outra quantidade recebida, como 112, exige revisão.

“Usar quantidade da instituição” adota a posição do provedor e encerra os registros restantes com motivo de resolução pelo usuário, preservando quantidades e preços pagos originais. “Manter quantidade manual” mantém temporariamente a posição esperada. A mesma informação não repete o aviso; uma correspondência posterior restaura a sincronização automática, enquanto outra mudança não explicada pede revisão novamente. Resolva uma divergência existente antes de registrar outra compra nessa posição.

Somente observações de quantidade comparáveis e mais recentes contam, com precisão de dez casas decimais. Mudanças isoladas de preço, câmbio ou data não confirmam compras. Quantidades ausentes e conexões indisponíveis também não confirmam. Durante o lote ativo, o custo usa o custo inicial conhecido mais as compras registradas, evitando duplicidade quando as movimentações do provedor chegam antes da posição. Um custo inicial desconhecido continua desconhecido.

ETFs de renda fixa como AUPO11 seguem esse fluxo por unidades, mesmo alocados na classe de renda fixa. Produtos/grupos de renda fixa como CDBs mantêm a espera atual pela sincronização, sem aumentos temporários de saldo. Binance e saldos bancários também preservam seus fluxos atuais.

Pendências antigas sem ambiguidades são inicializadas durante a reconciliação. Baselines ausentes, vários destinos possíveis e correções conflitantes exigem revisão em vez de aumento automático. Manter uma posição desconectada como manual materializa uma única vez a posição efetiva e preserva o histórico de resolução dos aportes.

Aplique a migração de quantidades de aportes antes de servir esta versão. O banco permite um lote ativo por posição e vários aportes dentro dele; a proteção anterior de um aporte pendente por ativo permanece para os outros fluxos. Registros e decisões compartilham a trava operacional do provedor e rejeitam revisões desatualizadas da posição. Mudanças na posição efetiva invalidam cálculos ainda não executados.

Quando uma mudança na quantidade da instituição não tem data de atualização, o UOVP solicita revisão explícita em vez de confirmar a compra automaticamente. Snapshots idênticos já reconhecidos não repetem o aviso. Excluir um ativo ou classe encerra os lotes ativos e remove somente a quantidade temporária do aporte antes de excluir a posição; uma nova integração começa pelos dados da instituição.

Ao encerrar uma quantidade temporária com preço do provedor, o saldo informado pela instituição volta a ser a referência, mesmo quando difere de quantidade × preço unitário.
