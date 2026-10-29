# Open Finance contributions

[Português](open-finance-contributions.pt-BR.md)

Recording an already-completed purchase in a unit-based Open Finance investment immediately updates its quantity in UOVP. Recording does not place orders or change provider data. Select the holding/institution when several exist. The paid price records cost; current market prices and exchange rates continue determining market value.

A batch starts from the displayed quantity, including an existing manual correction. With 100 units and purchases of 10 and 5, UOVP displays 115. A provider quantity of 100 keeps both pending. A quantity of 110 confirms the first purchase, folds its cost into the batch baseline and removes its pending entry; 115 confirms the remainder and removes the batch too. Another quantity, such as 112, requires review.

“Use institution quantity” adopts the provider position and removes resolved pending entries. “Keep my quantity” temporarily retains the expected position. Identical acknowledged snapshots do not prompt again; a later match restores automatic synchronization, while another unexplained change requires review.

Only comparable quantities from valid snapshots count, with ten-decimal precision. Price, FX or timestamp changes alone never confirm purchases. Missing quantities and unavailable connections do not confirm them either. Snapshots without an update timestamp require explicit review. Projected cost uses the baseline plus remaining pending purchases without duplicating imported movements; unknown cost remains unknown.

ETFs such as AUPO11 use the unit flow even when allocated to fixed income. Products such as CDBs await synchronization without temporarily increasing their balance. Binance and bank-account balances retain their existing confirmation flows.

Manual purchases update only position quantity and cost, without a local operation history. Only pending contributions and active reconciliation batches are persisted. Keeping a disconnected position manual materializes its effective quantity once and removes its pending entries. Deleting an asset or class resolves its projection before removing the position.

Calculation results stay in browser memory until Calculate is clicked again. Integration updates and recorded purchases do not invalidate or recalculate the list. Recording and decisions remain coordinated by the existing operation lease; stale conflict decisions are rejected.

Migrated pending entries without a safe batch require explicit review. Apply the [pending-contribution migration](pending-contributions-migration.md) with the previous application version stopped.
