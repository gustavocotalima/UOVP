# Migração para pendências de aporte

Os cálculos não são persistidos. Compras manuais atualizam apenas quantidade e custo da posição. `PendingContribution` guarda somente compras que ainda dependem do provedor; confirmação ou resolução remove a pendência. Lotes de quantidade também são removidos quando deixam de ter pendências.

A migração `20261029040000_pending_contributions_cleanup` remove as tabelas de simulação, snapshots auxiliares e estruturas sem uso do orçamento antigo, FAQ e presets. Os perfis da interface continuam definidos pelas constantes do aplicativo. O histórico local de aportes concluídos é descartado; operações importadas dos provedores e dados atuais das posições são preservados.

Antes de aplicar a migração em um ambiente existente:

1. Faça e verifique um backup lógico do banco.
2. Prepare a nova imagem e reserve uma janela de manutenção. Pare as instâncias e processos de sincronização da versão anterior antes de executar a migração; eles consultam as tabelas removidas.
3. Execute `pnpm exec prisma migrate deploy` e inicie somente a nova versão.
4. Verifique saúde, posições, pendências, revisão de quantidades e um cálculo de aporte. Restaurar apenas a imagem antiga não é um rollback válido após a remoção das tabelas; use o backup se precisar retornar.

A validação local usa uma cópia descartável do banco e testa a migração de pendências ambíguas e de lotes parcialmente sincronizados. A migração não modifica quantidades, saldos, custos das posições ou conteúdo bruto dos provedores. Custos já confirmados são incorporados ao custo-base do lote antes da remoção dos registros concluídos.
