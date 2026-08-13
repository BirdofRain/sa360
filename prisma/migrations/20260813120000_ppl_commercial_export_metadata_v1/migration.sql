-- PPL commercial export contract: immutable pricing/export audit metadata.
-- Additive only — no backfill of historical inventory or packages.

ALTER TABLE "LeadOrderLine" ADD COLUMN "metadataJson" JSONB;

ALTER TABLE "LeadDeliveryExportPackage" ADD COLUMN "metadataJson" JSONB;
