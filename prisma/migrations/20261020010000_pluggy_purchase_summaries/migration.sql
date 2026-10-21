BEGIN;

-- Block both old and new application writers until the trigger and the complete
-- historical backfill are installed. Run the migration before deploying readers.
LOCK TABLE "PluggyInvestment", "PluggyInvestmentTransaction" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "PluggyInvestment"
  ADD COLUMN "purchaseQuantityTotal" DECIMAL(65,20) NOT NULL DEFAULT 0,
  ADD COLUMN "purchaseCostTotal" DECIMAL(65,20) NOT NULL DEFAULT 0,
  ADD COLUMN "purchaseSummaryVersion" INTEGER NOT NULL DEFAULT 1;

-- Not STRICT: a missing netAmount must still fall back to amount or value * qty.
-- Monetary amounts and quantities are absolute values; zero and non-finite
-- numerics are absent. Keep this formula aligned with summarizePurchaseTransactions.
CREATE FUNCTION uovp_purchase_summary_entry(
  movement_type TEXT,
  movement_quantity NUMERIC,
  movement_value NUMERIC,
  movement_amount NUMERIC,
  movement_net_amount NUMERIC
) RETURNS TABLE(purchase_quantity NUMERIC, purchase_cost NUMERIC)
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT
      CASE WHEN movement_quantity::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        AND ABS(movement_quantity) > 0 THEN ABS(movement_quantity) END AS quantity,
      CASE WHEN movement_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        AND ABS(movement_value) > 0 THEN ABS(movement_value) END AS value,
      CASE WHEN movement_amount::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        AND ABS(movement_amount) > 0 THEN ABS(movement_amount) END AS amount,
      CASE WHEN movement_net_amount::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        AND ABS(movement_net_amount) > 0 THEN ABS(movement_net_amount) END AS net_amount
  ), contribution AS (
    SELECT quantity, COALESCE(net_amount, amount, value * quantity) AS cost
    FROM normalized
    WHERE UPPER(movement_type) = 'BUY'
  )
  SELECT COALESCE(MAX(quantity) FILTER (WHERE cost > 0), 0),
         COALESCE(MAX(cost) FILTER (WHERE quantity > 0), 0)
  FROM contribution;
$$;

CREATE FUNCTION uovp_update_purchase_summary()
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
DECLARE
  old_investment_id TEXT;
  new_investment_id TEXT;
  old_quantity NUMERIC := 0;
  old_cost NUMERIC := 0;
  new_quantity NUMERIC := 0;
  new_cost NUMERIC := 0;
  parent_id TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_investment_id := OLD."pluggyInvestmentDbId";
    SELECT purchase_quantity, purchase_cost INTO old_quantity, old_cost
    FROM uovp_purchase_summary_entry(OLD."type", OLD."quantity", OLD."value", OLD."amount", OLD."netAmount");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_investment_id := NEW."pluggyInvestmentDbId";
    SELECT purchase_quantity, purchase_cost INTO new_quantity, new_cost
    FROM uovp_purchase_summary_entry(NEW."type", NEW."quantity", NEW."value", NEW."amount", NEW."netAmount");
  END IF;

  IF old_investment_id IS NOT DISTINCT FROM new_investment_id
     AND old_quantity = new_quantity AND old_cost = new_cost THEN
    RETURN NEW;
  END IF;

  -- NO KEY UPDATE remains compatible with the foreign key's KEY SHARE lock.
  -- Lock both parents in a stable order when an operation changes investment.
  -- A cascading parent deletion legitimately leaves no parent to update.
  FOR parent_id IN
    SELECT "id" FROM "PluggyInvestment"
    WHERE "id" IN (old_investment_id, new_investment_id)
    ORDER BY "id" FOR NO KEY UPDATE
  LOOP
    UPDATE "PluggyInvestment"
    SET "purchaseQuantityTotal" = "purchaseQuantityTotal"
          + CASE WHEN "id" = new_investment_id THEN new_quantity ELSE 0 END
          - CASE WHEN "id" = old_investment_id THEN old_quantity ELSE 0 END,
        "purchaseCostTotal" = "purchaseCostTotal"
          + CASE WHEN "id" = new_investment_id THEN new_cost ELSE 0 END
          - CASE WHEN "id" = old_investment_id THEN old_cost ELSE 0 END,
        "purchaseSummaryVersion" = 1
    WHERE "id" = parent_id;
    -- Deliberately do not change provider/position updatedAt timestamps.
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PluggyInvestmentTransaction_purchase_summary"
AFTER INSERT OR UPDATE OR DELETE ON "PluggyInvestmentTransaction"
FOR EACH ROW EXECUTE FUNCTION uovp_update_purchase_summary();

-- Include investments with no movements, so empty histories are versioned zeros.
WITH totals AS (
  SELECT investment."id",
         SUM(entry.purchase_quantity) AS quantity,
         SUM(entry.purchase_cost) AS cost
  FROM "PluggyInvestment" investment
  LEFT JOIN "PluggyInvestmentTransaction" movement
    ON movement."pluggyInvestmentDbId" = investment."id"
  CROSS JOIN LATERAL uovp_purchase_summary_entry(
    movement."type", movement."quantity", movement."value", movement."amount", movement."netAmount"
  ) entry
  GROUP BY investment."id"
)
UPDATE "PluggyInvestment" investment
SET "purchaseQuantityTotal" = totals.quantity,
    "purchaseCostTotal" = totals.cost,
    "purchaseSummaryVersion" = 1
FROM totals WHERE investment."id" = totals."id";

COMMIT;
