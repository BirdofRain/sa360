-- Gate 2 historical catalog projection.
--
-- Prisma Migrate runs this file in one transaction. SET LOCAL is the first
-- statement so lock_timeout covers every later lock, including CREATE TRIGGER.
-- Outside an explicit transaction PostgreSQL rejects SET LOCAL (SQLSTATE 25001)
-- before any object is created.
--
-- This statement creates an empty read model and the triggers that maintain it.
-- It does not backfill, create the lot index, set ready = true, alter
-- SourceLeadEvent, or modify inventory rows.
-- Merging the migration into master makes sa360-migrate apply it on the next
-- API predeploy. ready remains false, so the current catalog query is unchanged.

SET LOCAL lock_timeout = '3s';

CREATE TABLE historical_catalog_projection (
  item_id text PRIMARY KEY,
  lot_key text NOT NULL,
  import_request text NOT NULL,
  niche_key text NOT NULL,
  item_status text NOT NULL,
  origin_id text,
  july_label text,
  normalized_label text,
  label_agreement text NOT NULL,
  refreshed_at timestamptz NOT NULL
);

CREATE TABLE historical_catalog_projection_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  ready boolean NOT NULL DEFAULT false,
  source_row_count bigint,
  projection_row_count bigint,
  verified_at timestamptz,
  note text
);

INSERT INTO historical_catalog_projection_control (singleton, ready, note)
VALUES (
  true,
  false,
  'Empty read model. Catalog SQL keeps reading SourceLeadEvent until a separate approved backfill sets ready.'
);

-- Single definition of the projected fields. Not a fulfillment relation.
CREATE VIEW historical_catalog_projection_source
WITH (security_invoker = true) AS
SELECT
  i.id AS item_id,
  COALESCE(NULLIF(btrim(l."lotKey"), ''), '(blank)') AS lot_key,
  COALESCE(
    NULLIF(btrim(e."rawPayloadJson"->>'importRequestId'), ''),
    NULLIF(btrim(e."bulkImportId"), ''),
    '(none)'
  ) AS import_request,
  COALESCE(NULLIF(btrim(i."nicheKey"), ''), '(blank)') AS niche_key,
  i.status::text AS item_status,
  NULLIF(btrim(i."originClientAccountId"), '') AS origin_id,
  NULLIF(btrim(e."sourceCampaignName"), '') AS july_label,
  historical_july_campaign_label_normalize(NULLIF(btrim(e."sourceCampaignName"), '')) AS normalized_label,
  CASE
    WHEN NULLIF(btrim(e."sourceCampaignName"), '') IS NULL
      AND NULLIF(btrim(e."normalizedPayloadJson"->>'campaign_name'), '') IS NULL
      AND NULLIF(btrim(e."rawPayloadJson"#>>'{master,lead_type}'), '') IS NULL
      THEN 'all_missing'
    WHEN NULLIF(btrim(e."sourceCampaignName"), '') IS NULL
      THEN 'post_july_label_without_column'
    WHEN (
        NULLIF(btrim(e."normalizedPayloadJson"->>'campaign_name'), '') IS NOT NULL
        AND NULLIF(btrim(e."normalizedPayloadJson"->>'campaign_name'), '')
          IS DISTINCT FROM NULLIF(btrim(e."sourceCampaignName"), '')
      ) OR (
        NULLIF(btrim(e."rawPayloadJson"#>>'{master,lead_type}'), '') IS NOT NULL
        AND NULLIF(btrim(e."rawPayloadJson"#>>'{master,lead_type}'), '')
          IS DISTINCT FROM NULLIF(btrim(e."sourceCampaignName"), '')
      )
      THEN 'july_column_conflicts'
    WHEN NULLIF(btrim(e."normalizedPayloadJson"->>'campaign_name'), '') IS NULL
      AND NULLIF(btrim(e."rawPayloadJson"#>>'{master,lead_type}'), '') IS NULL
      THEN 'july_column_only'
    ELSE 'july_column_agrees'
  END AS label_agreement
FROM "LeadInventoryItem" i
JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
WHERE e."sourceSystem"::text = 'csv_import'
   OR e."sourceProvider"::text = 'manual_import'
   OR i."sourceProvider"::text = 'manual_import';

CREATE FUNCTION historical_catalog_projection_refresh_item(p_item_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  DELETE FROM historical_catalog_projection WHERE item_id = p_item_id;

  INSERT INTO historical_catalog_projection (
    item_id,
    lot_key,
    import_request,
    niche_key,
    item_status,
    origin_id,
    july_label,
    normalized_label,
    label_agreement,
    refreshed_at
  )
  SELECT
    source.item_id,
    source.lot_key,
    source.import_request,
    source.niche_key,
    source.item_status,
    source.origin_id,
    source.july_label,
    source.normalized_label,
    source.label_agreement,
    clock_timestamp()
  FROM historical_catalog_projection_source AS source
  WHERE source.item_id = p_item_id;
END;
$fn$;

CREATE FUNCTION historical_catalog_projection_item_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM historical_catalog_projection_refresh_item(OLD.id);
    RETURN OLD;
  END IF;
  PERFORM historical_catalog_projection_refresh_item(NEW.id);
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION historical_catalog_projection_event_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_item_id text;
BEGIN
  SELECT i.id
  INTO v_item_id
  FROM "LeadInventoryItem" i
  WHERE i."sourceLeadEventId" = NEW.id;

  IF v_item_id IS NOT NULL THEN
    PERFORM historical_catalog_projection_refresh_item(v_item_id);
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION historical_catalog_projection_lot_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW."lotKey" IS NOT DISTINCT FROM OLD."lotKey" THEN
    RETURN NEW;
  END IF;

  UPDATE historical_catalog_projection AS projection
  SET
    lot_key = COALESCE(NULLIF(btrim(NEW."lotKey"), ''), '(blank)'),
    refreshed_at = clock_timestamp()
  FROM "LeadInventoryItem" AS item
  WHERE item.id = projection.item_id
    AND item."inventoryLotId" = NEW.id
    AND projection.lot_key IS DISTINCT FROM COALESCE(NULLIF(btrim(NEW."lotKey"), ''), '(blank)');
  RETURN NEW;
END;
$fn$;

-- Bounded field comparison. A matching row count is not acceptance.
-- p_limit stops the result, and the id range stops the scan. statement_timeout
-- stays at the catalog limit of 20 seconds.
CREATE FUNCTION historical_catalog_projection_diff(
  p_after text,
  p_until text,
  p_limit integer
)
RETURNS TABLE (
  item_id text,
  discrepancy text,
  source_value text,
  projection_value text
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF p_after IS NULL OR p_until IS NULL OR p_after >= p_until THEN
    RAISE EXCEPTION 'historical catalog projection diff requires a non-empty id range';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'historical catalog projection diff limit must be between 1 and 200';
  END IF;

  PERFORM set_config('statement_timeout', '20s', true);

  RETURN QUERY
  SELECT diffs.item_id, diffs.discrepancy, diffs.source_value, diffs.projection_value
  FROM (
    SELECT
      source.item_id,
      'missing_projection'::text AS discrepancy,
      source.item_id AS source_value,
      NULL::text AS projection_value
    FROM historical_catalog_projection_source AS source
    WHERE source.item_id > p_after
      AND source.item_id <= p_until
      AND NOT EXISTS (
        SELECT 1
        FROM historical_catalog_projection AS projection
        WHERE projection.item_id = source.item_id
      )
    UNION ALL
    SELECT
      projection.item_id,
      'not_historical'::text,
      NULL::text,
      projection.item_id
    FROM historical_catalog_projection AS projection
    WHERE projection.item_id > p_after
      AND projection.item_id <= p_until
      AND NOT EXISTS (
        SELECT 1
        FROM historical_catalog_projection_source AS source
        WHERE source.item_id = projection.item_id
      )
    UNION ALL
    SELECT source.item_id, 'lot_key'::text, source.lot_key, projection.lot_key
    FROM historical_catalog_projection_source AS source
    JOIN historical_catalog_projection AS projection ON projection.item_id = source.item_id
    WHERE source.item_id > p_after
      AND source.item_id <= p_until
      AND source.lot_key IS DISTINCT FROM projection.lot_key
    UNION ALL
    SELECT source.item_id, 'import_request'::text, source.import_request, projection.import_request
    FROM historical_catalog_projection_source AS source
    JOIN historical_catalog_projection AS projection ON projection.item_id = source.item_id
    WHERE source.item_id > p_after
      AND source.item_id <= p_until
      AND source.import_request IS DISTINCT FROM projection.import_request
    UNION ALL
    SELECT source.item_id, 'july_label'::text, source.july_label, projection.july_label
    FROM historical_catalog_projection_source AS source
    JOIN historical_catalog_projection AS projection ON projection.item_id = source.item_id
    WHERE source.item_id > p_after
      AND source.item_id <= p_until
      AND source.july_label IS DISTINCT FROM projection.july_label
    UNION ALL
    SELECT source.item_id, 'normalized_label'::text, source.normalized_label, projection.normalized_label
    FROM historical_catalog_projection_source AS source
    JOIN historical_catalog_projection AS projection ON projection.item_id = source.item_id
    WHERE source.item_id > p_after
      AND source.item_id <= p_until
      AND source.normalized_label IS DISTINCT FROM projection.normalized_label
    UNION ALL
    SELECT source.item_id, 'label_agreement'::text, source.label_agreement, projection.label_agreement
    FROM historical_catalog_projection_source AS source
    JOIN historical_catalog_projection AS projection ON projection.item_id = source.item_id
    WHERE source.item_id > p_after
      AND source.item_id <= p_until
      AND source.label_agreement IS DISTINCT FROM projection.label_agreement
    UNION ALL
    SELECT source.item_id, 'item_status'::text, source.item_status, projection.item_status
    FROM historical_catalog_projection_source AS source
    JOIN historical_catalog_projection AS projection ON projection.item_id = source.item_id
    WHERE source.item_id > p_after
      AND source.item_id <= p_until
      AND source.item_status IS DISTINCT FROM projection.item_status
    UNION ALL
    SELECT source.item_id, 'origin_id'::text, source.origin_id, projection.origin_id
    FROM historical_catalog_projection_source AS source
    JOIN historical_catalog_projection AS projection ON projection.item_id = source.item_id
    WHERE source.item_id > p_after
      AND source.item_id <= p_until
      AND source.origin_id IS DISTINCT FROM projection.origin_id
    UNION ALL
    SELECT source.item_id, 'niche_key'::text, source.niche_key, projection.niche_key
    FROM historical_catalog_projection_source AS source
    JOIN historical_catalog_projection AS projection ON projection.item_id = source.item_id
    WHERE source.item_id > p_after
      AND source.item_id <= p_until
      AND source.niche_key IS DISTINCT FROM projection.niche_key
  ) AS diffs
  LIMIT p_limit;
END;
$fn$;

-- Installed for a later approved backfill. This migration does not CALL it.
-- A trigger write stores clock_timestamp(). The upsert may replace a row only
-- when that timestamp is strictly older than this transaction's
-- transaction_timestamp(), so a trigger that commits during the chunk is kept
-- even when the two timestamps are equal. The chunk does not lock or update
-- source rows.
CREATE PROCEDURE historical_catalog_projection_backfill_chunk(
  p_after text,
  p_until text
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_upserted bigint;
  v_removed bigint;
BEGIN
  IF p_after IS NULL OR p_until IS NULL OR p_after >= p_until THEN
    RAISE EXCEPTION 'historical catalog backfill requires a non-empty id range';
  END IF;

  PERFORM set_config('statement_timeout', '20s', true);

  INSERT INTO historical_catalog_projection (
    item_id,
    lot_key,
    import_request,
    niche_key,
    item_status,
    origin_id,
    july_label,
    normalized_label,
    label_agreement,
    refreshed_at
  )
  SELECT
    source.item_id,
    source.lot_key,
    source.import_request,
    source.niche_key,
    source.item_status,
    source.origin_id,
    source.july_label,
    source.normalized_label,
    source.label_agreement,
    transaction_timestamp()
  FROM historical_catalog_projection_source AS source
  WHERE source.item_id > p_after
    AND source.item_id <= p_until
  ON CONFLICT (item_id) DO UPDATE
  SET
    lot_key = EXCLUDED.lot_key,
    import_request = EXCLUDED.import_request,
    niche_key = EXCLUDED.niche_key,
    item_status = EXCLUDED.item_status,
    origin_id = EXCLUDED.origin_id,
    july_label = EXCLUDED.july_label,
    normalized_label = EXCLUDED.normalized_label,
    label_agreement = EXCLUDED.label_agreement,
    refreshed_at = EXCLUDED.refreshed_at
  WHERE historical_catalog_projection.refreshed_at < EXCLUDED.refreshed_at;

  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  DELETE FROM historical_catalog_projection AS projection
  WHERE projection.item_id > p_after
    AND projection.item_id <= p_until
    AND projection.refreshed_at <= transaction_timestamp()
    AND NOT EXISTS (
      SELECT 1
      FROM historical_catalog_projection_source AS source
      WHERE source.item_id = projection.item_id
    );

  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RAISE NOTICE 'historical catalog backfill chunk upserted % removed %', v_upserted, v_removed;
END;
$fn$;

CREATE TRIGGER historical_catalog_projection_item_refresh
AFTER INSERT OR DELETE OR UPDATE OF
  status,
  "nicheKey",
  "originClientAccountId",
  "inventoryLotId",
  "sourceProvider",
  "sourceLeadEventId"
ON "LeadInventoryItem"
FOR EACH ROW
EXECUTE FUNCTION historical_catalog_projection_item_trg();

CREATE TRIGGER historical_catalog_projection_event_refresh
AFTER UPDATE OF
  "sourceCampaignName",
  "rawPayloadJson",
  "normalizedPayloadJson",
  "bulkImportId",
  "sourceSystem",
  "sourceProvider"
ON "SourceLeadEvent"
FOR EACH ROW
EXECUTE FUNCTION historical_catalog_projection_event_trg();

CREATE TRIGGER historical_catalog_projection_lot_refresh
AFTER UPDATE OF "lotKey" ON "InventoryLot"
FOR EACH ROW
EXECUTE FUNCTION historical_catalog_projection_lot_trg();

-- The lot index is an operator step after backfill approval.
-- Do not CREATE INDEX here: a covering index that includes july_label fails
-- with SQLSTATE 54000 when that label is incompressible and about 2704 bytes.
