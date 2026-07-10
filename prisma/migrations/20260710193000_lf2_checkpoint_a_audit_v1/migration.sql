-- CreateEnum
CREATE TYPE "Lf2CheckpointAActionType" AS ENUM ('CREATE_CONFIG', 'REVOKE_CONFIG');

-- CreateEnum
CREATE TYPE "Lf2CheckpointAStatus" AS ENUM ('applied', 'rejected', 'idempotent_replay');

-- CreateTable
CREATE TABLE "Lf2CheckpointAAuditEvent" (
    "id" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "sourceLeadUidMasked" TEXT,
    "clientAccountId" TEXT NOT NULL,
    "destinationSubaccountIdGhl" TEXT NOT NULL,
    "leadOrderId" TEXT,
    "deliveryTargetId" TEXT,
    "actionType" "Lf2CheckpointAActionType" NOT NULL,
    "checkpointAStatus" "Lf2CheckpointAStatus" NOT NULL,
    "reasonsJson" JSONB,
    "metadataJson" JSONB,
    "requestedBy" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lf2CheckpointAAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lf2CheckpointAAuditEvent_sourceLeadEventId_createdAt_idx" ON "Lf2CheckpointAAuditEvent"("sourceLeadEventId", "createdAt");

-- CreateIndex
CREATE INDEX "Lf2CheckpointAAuditEvent_clientAccountId_createdAt_idx" ON "Lf2CheckpointAAuditEvent"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "Lf2CheckpointAAuditEvent_leadOrderId_createdAt_idx" ON "Lf2CheckpointAAuditEvent"("leadOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "Lf2CheckpointAAuditEvent_deliveryTargetId_createdAt_idx" ON "Lf2CheckpointAAuditEvent"("deliveryTargetId", "createdAt");

-- CreateIndex
CREATE INDEX "Lf2CheckpointAAuditEvent_requestId_idx" ON "Lf2CheckpointAAuditEvent"("requestId");
