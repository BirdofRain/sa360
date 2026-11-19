-- PROPOSED OPERATOR SCRIPT. NEVER A PRISMA MIGRATION.
--
-- prisma migrate deploy must not run this file. The sa360-migrate PRE_DEPLOY
-- job applies only files under prisma/migrations. Keep this script outside
-- that directory.
--
-- Run one chunk per transaction, after the schema statement has committed and
-- its triggers are enabled. Do not set session_replication_role = replica.
-- Do not DISABLE TRIGGER. Do not raise statement_timeout above 20 seconds.
-- Leave historical_catalog_projection_control.ready false until the chunk
-- counts match. Fulfillment must not read the projection.

CREATE PROCEDURE historical_catalog_projection_backfill_chunk(
  p_after text,
  p_until text
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_locked bigint;
  v_upserted bigint;
BEGIN
  PERFORM set_config('statement_timeout', '20s', true);

  PERFORM item.id
  FROM "LeadInventoryItem" AS item
  WHERE item.id > p_after
    AND item.id <= p_until
  ORDER BY item.id
  FOR UPDATE;

  GET DIAGNOSTICS v_locked = ROW_COUNT;

  DELETE FROM historical_catalog_projection AS projection
  WHERE projection.item_id > p_after
    AND projection.item_id <= p_until
    AND NOT EXISTS (
      SELECT 1
      FROM "LeadInventoryItem" AS item
      JOIN "SourceLeadEvent" AS event ON event.id = item."sourceLeadEventId"
      WHERE item.id = projection.item_id
        AND (
          event."sourceSystem"::text = 'csv_import'
          OR event."sourceProvider"::text = 'manual_import'
          OR item."sourceProvider"::text = 'manual_import'
        )
    );

  INSERT INTO historical_catalog_projection (
    item_id,
    lot_key,
    import_request,
    niche_key,
    item_status,
    origin_id,
    july_label,
    normalized_label,
    label_agreement
  )
  SELECT
    item.id,
    COALESCE(NULLIF(btrim(lot."lotKey"), ''), '(blank)'),
    COALESCE(
      NULLIF(btrim(event."rawPayloadJson"->>'importRequestId'), ''),
      NULLIF(btrim(event."bulkImportId"), ''),
      '(none)'
    ),
    COALESCE(NULLIF(btrim(item."nicheKey"), ''), '(blank)'),
    item.status::text,
    NULLIF(btrim(item."originClientAccountId"), ''),
    NULLIF(btrim(event."sourceCampaignName"), ''),
    historical_july_campaign_label_normalize(NULLIF(btrim(event."sourceCampaignName"), '')),
    CASE
      WHEN NULLIF(btrim(event."sourceCampaignName"), '') IS NULL
        AND NULLIF(btrim(event."normalizedPayloadJson"->>'campaign_name'), '') IS NULL
        AND NULLIF(btrim(event."rawPayloadJson"#>>'{master,lead_type}'), '') IS NULL
        THEN 'all_missing'
      WHEN NULLIF(btrim(event."sourceCampaignName"), '') IS NULL
        THEN 'post_july_label_without_column'
      WHEN (
          NULLIF(btrim(event."normalizedPayloadJson"->>'campaign_name'), '') IS NOT NULL
          AND NULLIF(btrim(event."normalizedPayloadJson"->>'campaign_name'), '')
            IS DISTINCT FROM NULLIF(btrim(event."sourceCampaignName"), '')
        ) OR (
          NULLIF(btrim(event."rawPayloadJson"#>>'{master,lead_type}'), '') IS NOT NULL
          AND NULLIF(btrim(event."rawPayloadJson"#>>'{master,lead_type}'), '')
            IS DISTINCT FROM NULLIF(btrim(event."sourceCampaignName"), '')
        )
        THEN 'july_column_conflicts'
      WHEN NULLIF(btrim(event."normalizedPayloadJson"->>'campaign_name'), '') IS NULL
        AND NULLIF(btrim(event."rawPayloadJson"#>>'{master,lead_type}'), '') IS NULL
        THEN 'july_column_only'
      ELSE 'july_column_agrees'
    END
  FROM "LeadInventoryItem" AS item
  JOIN "SourceLeadEvent" AS event ON event.id = item."sourceLeadEventId"
  JOIN "InventoryLot" AS lot ON lot.id = item."inventoryLotId"
  WHERE item.id > p_after
    AND item.id <= p_until
    AND (
      event."sourceSystem"::text = 'csv_import'
      OR event."sourceProvider"::text = 'manual_import'
      OR item."sourceProvider"::text = 'manual_import'
    )
  ON CONFLICT (item_id) DO UPDATE
  SET
    lot_key = EXCLUDED.lot_key,
    import_request = EXCLUDED.import_request,
    niche_key = EXCLUDED.niche_key,
    item_status = EXCLUDED.item_status,
    origin_id = EXCLUDED.origin_id,
    july_label = EXCLUDED.july_label,
    normalized_label = EXCLUDED.normalized_label,
    label_agreement = EXCLUDED.label_agreement;

  GET DIAGNOSTICS v_upserted = ROW_COUNT;
  RAISE NOTICE 'historical catalog backfill chunk locked % upserted %', v_locked, v_upserted;
END;
$fn$;

-- After every chunk has been applied and recounted, build the covering index
-- outside a transaction:
--
-- CREATE INDEX CONCURRENTLY historical_catalog_projection_lot_idx
--   ON historical_catalog_projection (lot_key)
--   INCLUDE (
--     import_request,
--     niche_key,
--     item_status,
--     origin_id,
--     july_label,
--     normalized_label,
--     label_agreement
--   );
--
-- VACUUM (ANALYZE) historical_catalog_projection;
--
-- Do not set historical_catalog_projection_control.ready in this file.
-- That update is a separate approved statement, issued only after the
-- projection count equals the sum of the historical source counts recorded
-- by the chunks. Do not verify by re-running the production Vet catalog scan.
