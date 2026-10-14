-- Operator-confirmed historical delivery evidence, independent of inventory match.
-- Local-only. Production migrate remains a separate authorization.

ALTER TABLE "BuyerExternalDeliveryImportBatch"
    ADD COLUMN "confirmedUnmatchedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "sourceEvidence" TEXT,
    ADD COLUMN "unmatchedDeliveriesConfirmed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BuyerExternalDeliveryReceipt"
    ADD COLUMN "deliveryEvidenceStatus" TEXT NOT NULL DEFAULT 'unverified';
