-- Historical campaign summary maintenance, boundary B.
--
-- Inert candidate. Do not copy this file into prisma/migrations.
-- Do not apply it in the same automatic migration as functions.sql.
--
-- Attaching these three triggers changes live write behavior on the next
-- inventory, source-event, or lot-key statement. Functions must already
-- exist. This file does not create functions, does not grant privileges,
-- and does not attach anything to historical_catalog_projection.
-- Backfill, reconciliation, and read-path authorization are later boundaries.
-- They are not part of attaching these triggers.
--
-- Name order on each table places the existing projection trigger first:
-- historical_catalog_projection_* sorts before historical_catalog_summary_*.
-- The summary trigger therefore reads the projection after refresh_item has
-- deleted and reinserted that item. The event trigger calls refresh_item
-- itself, so the event summary trigger applies the item. The lot summary
-- trigger only clears readiness.

CREATE TRIGGER historical_catalog_summary_item_apply
AFTER INSERT OR DELETE OR UPDATE OF
  status,
  "nicheKey",
  "originClientAccountId",
  "inventoryLotId",
  "sourceProvider",
  "sourceLeadEventId"
ON "LeadInventoryItem"
FOR EACH ROW
EXECUTE FUNCTION historical_catalog_summary_item_trg();

CREATE TRIGGER historical_catalog_summary_event_apply
AFTER UPDATE OF
  "sourceCampaignName",
  "rawPayloadJson",
  "normalizedPayloadJson",
  "bulkImportId",
  "sourceSystem",
  "sourceProvider"
ON "SourceLeadEvent"
FOR EACH ROW
EXECUTE FUNCTION historical_catalog_summary_event_trg();

CREATE TRIGGER historical_catalog_summary_lot_invalidate
AFTER UPDATE OF "lotKey" ON "InventoryLot"
FOR EACH ROW
EXECUTE FUNCTION historical_catalog_summary_lot_trg();
