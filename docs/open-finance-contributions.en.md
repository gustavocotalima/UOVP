# Open Finance contributions

[Português](open-finance-contributions.pt-BR.md)

Recording an already completed purchase in a unit-based Open Finance investment updates UOVP's quantity immediately. It does not place an order or change provider data. Select the institution/holding when the asset has multiple positions. Paid prices record cost; current quotations and exchange rates still determine market value.

The batch starts from the quantity displayed in UOVP, including an existing manual correction. Contributions accumulate into an absolute expected quantity. Provider snapshots remain separate: they are never blindly increased again by the pending total.

With 100 units and purchases of 10 and 5, UOVP displays 115. An unchanged provider quantity of 100 leaves both purchases pending. A new quantity of 110 confirms the first purchase and leaves 115 displayed with 5 pending. A quantity of 115 confirms the remainder and restores autosync. A later provider quantity such as 112 instead requires review.

“Usar quantidade da instituição” adopts the provider position and closes remaining records with a user-resolution reason, preserving original quantities and paid prices. “Manter quantidade manual” keeps the expected position temporarily. Identical snapshots do not repeat the notice; a later match restores autosync and another unexplained quantity change requests review again. Resolve an existing conflict before registering another purchase in that position.

Only comparable, newer quantity observations count, at ten-decimal precision. Price, FX and timestamp changes alone do not confirm purchases. Missing quantities and unavailable connections do not confirm them either. Cost uses the captured known starting cost plus recorded purchases throughout an active batch, preventing provider transactions arriving midway from duplicating costs. An unknown starting cost remains unknown.

Fixed-income ETFs such as AUPO11 use this quantity flow even when their allocation class is fixed income. Actual fixed-income products/groups such as CDBs keep their existing awaiting-sync behavior without temporary balance increases. Binance and bank balances also retain their existing flows.

Unambiguous historical pending records are initialized during reconciliation. Missing baselines, multiple possible destinations and existing conflicting corrections require review instead of an automatic increase. Keeping a disconnected investment manual materializes the effective position once and preserves the contribution resolution history.

Apply the contribution-quantity migration before serving this version. The database permits one active batch per holding and multiple contributions inside it; the previous one-pending-per-asset protection remains for the other flows. Registration and decisions share the provider operation lease and reject stale position revisions. Effective position changes invalidate unexecuted calculations.

When a changed provider quantity has no update timestamp, UOVP requests an explicit quantity review instead of automatically confirming the purchase. Identical acknowledged snapshots do not repeat the prompt. Deleting an asset or class resolves its active batches and removes only the contribution quantity override before the holding is removed, so remapping starts from provider data.
