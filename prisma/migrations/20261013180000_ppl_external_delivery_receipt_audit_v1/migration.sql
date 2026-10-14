-- Audit + content-bound idempotency fields for external receipt batches.
-- Local-only. Production migrate/import is a separate authorization.

ALTER TABLE "BuyerExternalDeliveryImportBatch"
    ADD COLUMN "sourceFilename" TEXT,
    ADD COLUMN "contentChecksum" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "headerRowCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "malformedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "appliedBy" TEXT,
    ADD COLUMN "appliedAt" TIMESTAMP(3);

CREATE INDEX "BuyerExternalDeliveryImportBatch_contentChecksum_idx"
    ON "BuyerExternalDeliveryImportBatch"("contentChecksum");
