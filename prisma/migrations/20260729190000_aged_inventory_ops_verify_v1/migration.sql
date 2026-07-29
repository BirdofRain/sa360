-- Aged inventory operational verification / lot activation audit

CREATE TABLE "AgedInventoryOpsVerifyAction" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "inventoryLotId" TEXT NOT NULL,
    "lotKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionStatus" TEXT NOT NULL,
    "verificationKind" TEXT NOT NULL DEFAULT 'aged_operational_v1',
    "operator" TEXT,
    "operatorNote" TEXT,
    "requestedCount" INTEGER NOT NULL DEFAULT 0,
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "quarantinedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "activatedCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "nextCursor" TEXT,
    "summaryJson" JSONB NOT NULL DEFAULT '{}',
    "previewedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgedInventoryOpsVerifyAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgedInventoryOpsVerifyAction_requestId_key" ON "AgedInventoryOpsVerifyAction"("requestId");
CREATE INDEX "AgedInventoryOpsVerifyAction_inventoryLotId_createdAt_idx" ON "AgedInventoryOpsVerifyAction"("inventoryLotId", "createdAt");
CREATE INDEX "AgedInventoryOpsVerifyAction_lotKey_actionType_idx" ON "AgedInventoryOpsVerifyAction"("lotKey", "actionType");
CREATE INDEX "AgedInventoryOpsVerifyAction_actionStatus_createdAt_idx" ON "AgedInventoryOpsVerifyAction"("actionStatus", "createdAt");
