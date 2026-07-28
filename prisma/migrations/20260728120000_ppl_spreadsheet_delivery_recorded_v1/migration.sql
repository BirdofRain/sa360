-- Explicit manual spreadsheet delivery recording for PPL buyer CSV packages.
-- BuyerDeliveredIdentity is written only when this boundary is confirmed.

ALTER TABLE "LeadDeliveryExportPackage"
ADD COLUMN "spreadsheetDeliveredAt" TIMESTAMP(3),
ADD COLUMN "spreadsheetDeliveredBy" TEXT,
ADD COLUMN "spreadsheetDeliveryIdempotencyKey" TEXT,
ADD COLUMN "spreadsheetDeliveryEvidenceJson" JSONB;

CREATE UNIQUE INDEX "LeadDeliveryExportPackage_spreadsheetDeliveryIdempotencyKey_key"
ON "LeadDeliveryExportPackage"("spreadsheetDeliveryIdempotencyKey");

CREATE INDEX "LeadDeliveryExportPackage_spreadsheetDeliveredAt_idx"
ON "LeadDeliveryExportPackage"("spreadsheetDeliveredAt");
