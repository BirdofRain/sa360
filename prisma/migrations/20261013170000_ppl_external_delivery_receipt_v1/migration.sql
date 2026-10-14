-- Historical spreadsheet receipts for buyer-specific suppression.
-- Preview is the default. Applied rows never write BuyerDeliveredIdentity.

CREATE TABLE "BuyerExternalDeliveryImportBatch" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "occupiedRowCount" INTEGER NOT NULL,
    "uniqueLeadCount" INTEGER NOT NULL,
    "extraOccupiedRowCount" INTEGER NOT NULL,
    "blankRowCount" INTEGER NOT NULL,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "ambiguousCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedBeforeDeliveryCount" INTEGER NOT NULL DEFAULT 0,
    "applyMode" TEXT NOT NULL DEFAULT 'preview',
    "status" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerExternalDeliveryImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuyerExternalDeliveryImportBatch_requestId_key" ON "BuyerExternalDeliveryImportBatch"("requestId");

CREATE INDEX "BuyerExternalDeliveryImportBatch_clientAccountId_status_idx" ON "BuyerExternalDeliveryImportBatch"("clientAccountId", "status");

CREATE TABLE "BuyerExternalDeliveryReceipt" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'spreadsheet',
    "rowNumber" INTEGER NOT NULL,
    "occupancyStatus" TEXT NOT NULL,
    "phoneFingerprint" TEXT,
    "emailFingerprint" TEXT,
    "rawRowHash" TEXT NOT NULL,
    "matchStatus" TEXT NOT NULL,
    "matchedSourceLeadEventId" TEXT,
    "matchedInventoryItemId" TEXT,
    "applyStatus" TEXT NOT NULL,
    "applyNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerExternalDeliveryReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuyerExternalDeliveryReceipt_importBatchId_rowNumber_key" ON "BuyerExternalDeliveryReceipt"("importBatchId", "rowNumber");

CREATE INDEX "BuyerExternalDeliveryReceipt_clientAccountId_applyStatus_idx" ON "BuyerExternalDeliveryReceipt"("clientAccountId", "applyStatus");

CREATE INDEX "BuyerExternalDeliveryReceipt_clientAccountId_phoneFingerprint_idx" ON "BuyerExternalDeliveryReceipt"("clientAccountId", "phoneFingerprint");

CREATE INDEX "BuyerExternalDeliveryReceipt_clientAccountId_emailFingerprint_idx" ON "BuyerExternalDeliveryReceipt"("clientAccountId", "emailFingerprint");

CREATE INDEX "BuyerExternalDeliveryReceipt_importBatchId_idx" ON "BuyerExternalDeliveryReceipt"("importBatchId");

ALTER TABLE "BuyerExternalDeliveryReceipt" ADD CONSTRAINT "BuyerExternalDeliveryReceipt_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "BuyerExternalDeliveryImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
