-- PPL aged inventory beta: duplicate-only replacement requests

CREATE TABLE "LeadReplacementRequest" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "leadOrderId" TEXT NOT NULL,
    "originalAllocationId" TEXT NOT NULL,
    "originalInventoryItemId" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL DEFAULT 'duplicate',
    "replacementAllocationId" TEXT,
    "replacementInventoryItemId" TEXT,
    "decisionNote" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "requestId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadReplacementRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadReplacementRequest_requestId_key" ON "LeadReplacementRequest"("requestId");

CREATE INDEX "LeadReplacementRequest_leadOrderId_status_idx" ON "LeadReplacementRequest"("leadOrderId", "status");

CREATE INDEX "LeadReplacementRequest_clientAccountId_status_idx" ON "LeadReplacementRequest"("clientAccountId", "status");

CREATE INDEX "LeadReplacementRequest_originalAllocationId_idx" ON "LeadReplacementRequest"("originalAllocationId");

CREATE INDEX "LeadReplacementRequest_status_createdAt_idx" ON "LeadReplacementRequest"("status", "createdAt");

ALTER TABLE "LeadReplacementRequest" ADD CONSTRAINT "LeadReplacementRequest_leadOrderId_fkey" FOREIGN KEY ("leadOrderId") REFERENCES "LeadOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
