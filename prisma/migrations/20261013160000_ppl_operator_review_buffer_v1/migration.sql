-- Pre-delivery operator review buffers and unbilled supplemental fills.
-- reviewCapacityAllowance is never purchased/billed quantity.

ALTER TABLE "LeadOrder"
ADD COLUMN "reviewCapacityAllowance" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PplOperatorReviewBatch" (
    "id" TEXT NOT NULL,
    "leadOrderId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "purchasedQuantity" INTEGER NOT NULL,
    "bufferQuantity" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "unusedBufferCount" INTEGER NOT NULL DEFAULT 0,
    "shortfallCount" INTEGER NOT NULL DEFAULT 0,
    "billedQuantity" INTEGER,
    "requestId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PplOperatorReviewBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PplOperatorReviewBatch_requestId_key" ON "PplOperatorReviewBatch"("requestId");

-- Concurrent Open Review must not create two open batches for one order.
CREATE UNIQUE INDEX "PplOperatorReviewBatch_one_open_per_order"
ON "PplOperatorReviewBatch"("leadOrderId")
WHERE status = 'open';

CREATE INDEX "PplOperatorReviewBatch_leadOrderId_status_idx" ON "PplOperatorReviewBatch"("leadOrderId", "status");

CREATE INDEX "PplOperatorReviewBatch_clientAccountId_status_idx" ON "PplOperatorReviewBatch"("clientAccountId", "status");

CREATE TABLE "PplOperatorReviewItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "sourceLeadEventId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "reviewFlagsJson" JSONB,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PplOperatorReviewItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PplOperatorReviewItem_batchId_allocationId_key" ON "PplOperatorReviewItem"("batchId", "allocationId");

CREATE INDEX "PplOperatorReviewItem_batchId_status_idx" ON "PplOperatorReviewItem"("batchId", "status");

CREATE INDEX "PplOperatorReviewItem_allocationId_idx" ON "PplOperatorReviewItem"("allocationId");

CREATE TABLE "PplSupplementalExport" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "leadOrderId" TEXT NOT NULL,
    "exportPackageId" TEXT,
    "shortfallQuantity" INTEGER NOT NULL,
    "selectedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "billingStatus" TEXT NOT NULL DEFAULT 'not_billed',
    "allocationIdsJson" JSONB NOT NULL DEFAULT '[]',
    "requestId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PplSupplementalExport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PplSupplementalExport_requestId_key" ON "PplSupplementalExport"("requestId");

CREATE INDEX "PplSupplementalExport_batchId_status_idx" ON "PplSupplementalExport"("batchId", "status");

CREATE INDEX "PplSupplementalExport_leadOrderId_idx" ON "PplSupplementalExport"("leadOrderId");

ALTER TABLE "PplOperatorReviewBatch" ADD CONSTRAINT "PplOperatorReviewBatch_leadOrderId_fkey" FOREIGN KEY ("leadOrderId") REFERENCES "LeadOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PplOperatorReviewItem" ADD CONSTRAINT "PplOperatorReviewItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PplOperatorReviewBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PplSupplementalExport" ADD CONSTRAINT "PplSupplementalExport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PplOperatorReviewBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
