-- PROPOSED SCHEMA. THIS IS NOT A PRISMA MIGRATION.
--
-- Do not copy this file under prisma/migrations unless a separate production
-- change approval names this statement and accepts that the sa360-migrate
-- PRE_DEPLOY job will run it on the next API deploy.
--
-- What this statement does:
--   * creates an empty historical-catalog read model
--   * creates triggers that maintain that read model
--   * leaves historical_catalog_projection_control.ready = false
--
-- What this statement does not do:
--   * it does not add columns or indexes to SourceLeadEvent
--   * it does not backfill existing inventory
--   * it does not change the catalog query, statement timeout, association
--     flag, inventory status, or fulfillment eligibility
--
-- Fulfillment, sellability, reservation, and buyer eligibility must never
-- read historical_catalog_projection. LeadInventoryItem and LeadAllocation
-- remain authoritative.

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
  label_agreement text NOT NULL
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
  'Empty read model. Catalog SQL must keep using SourceLeadEvent until a separate approved backfill sets ready.'
);

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
    label_agreement
  )
  SELECT
    i.id,
    COALESCE(NULLIF(btrim(l."lotKey"), ''), '(blank)'),
    COALESCE(
      NULLIF(btrim(e."rawPayloadJson"->>'importRequestId'), ''),
      NULLIF(btrim(e."bulkImportId"), ''),
      '(none)'
    ),
    COALESCE(NULLIF(btrim(i."nicheKey"), ''), '(blank)'),
    i.status::text,
    NULLIF(btrim(i."originClientAccountId"), ''),
    NULLIF(btrim(e."sourceCampaignName"), ''),
    historical_july_campaign_label_normalize(NULLIF(btrim(e."sourceCampaignName"), '')),
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
    END
  FROM "LeadInventoryItem" i
  JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
  JOIN "InventoryLot" l ON l.id = i."inventoryLotId"
  WHERE i.id = p_item_id
    AND (
      e."sourceSystem"::text = 'csv_import'
      OR e."sourceProvider"::text = 'manual_import'
      OR i."sourceProvider"::text = 'manual_import'
    );
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
  SET lot_key = COALESCE(NULLIF(btrim(NEW."lotKey"), ''), '(blank)')
  FROM "LeadInventoryItem" AS item
  WHERE item.id = projection.item_id
    AND item."inventoryLotId" = NEW.id
    AND projection.lot_key IS DISTINCT FROM COALESCE(NULLIF(btrim(NEW."lotKey"), ''), '(blank)');
  RETURN NEW;
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

-- The lot index is created by the backfill script with CONCURRENTLY after the
-- load. Creating it here would run inside the prisma migrate transaction,
-- where CONCURRENTLY is illegal, and would maintain a large index during the
-- initial load. Do not add CREATE INDEX on SourceLeadEvent to this statement.
