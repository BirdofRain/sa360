-- LF2 channel-neutral fulfillment shadow core (additive, backward compatible)

-- CreateEnum
CREATE TYPE "LeadOrderKind" AS ENUM ('retainer_allocation', 'pay_per_lead');
CREATE TYPE "LeadFulfillmentMode" AS ENUM ('campaign_bound', 'pooled_matching');
CREATE TYPE "LeadEligibilityStatus" AS ENUM ('eligible', 'review_required', 'ineligible');
CREATE TYPE "LeadAllocationStatus" AS ENUM ('shadow', 'reserved', 'committed', 'released');
CREATE TYPE "DeliveryInstructionStatus" AS ENUM ('planned', 'queued', 'completed', 'failed', 'canceled');
CREATE TYPE "FulfillmentOutboxStatus" AS ENUM ('pending', 'enqueued', 'processing', 'completed', 'retryable_failure', 'terminal_failure');

-- AlterTable LeadOrder (nullable fulfillment fields; legacy rows unchanged)
ALTER TABLE "LeadOrder"
  ADD COLUMN "orderKind" "LeadOrderKind",
  ADD COLUMN "fulfillmentMode" "LeadFulfillmentMode",
  ADD COLUMN "requestedQuantity" INTEGER,
  ADD COLUMN "fulfillmentCycleStart" TIMESTAMP(3),
  ADD COLUMN "fulfillmentCycleEnd" TIMESTAMP(3),
  ADD COLUMN "allowedSourceLanesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "proofPolicyKey" TEXT,
  ADD COLUMN "exclusivityRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fulfillmentPriority" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "proposedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "fulfilledQuantity" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "LeadOrder_orderKind_status_fulfillmentMode_idx" ON "LeadOrder"("orderKind", "status", "fulfillmentMode");
CREATE INDEX "LeadOrder_fulfillmentPriority_activatedAt_idx" ON "LeadOrder"("fulfillmentPriority", "activatedAt");

-- CreateTable DeliveryTarget
CREATE TABLE "DeliveryTarget" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "configMetadataJson" JSONB NOT NULL DEFAULT '{}',
    "readinessStatus" TEXT NOT NULL DEFAULT 'not_configured',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryTarget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryTarget_clientAccountId_enabled_idx" ON "DeliveryTarget"("clientAccountId", "enabled");
CREATE INDEX "DeliveryTarget_adapterKey_idx" ON "DeliveryTarget"("adapterKey");

ALTER TABLE "DeliveryTarget" ADD CONSTRAINT "DeliveryTarget_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable LeadEligibilityAssessment
CREATE TABLE "LeadEligibilityAssessment" (
    "id" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "status" "LeadEligibilityStatus" NOT NULL,
    "reasonCodesJson" JSONB NOT NULL DEFAULT '[]',
    "proofResultJson" JSONB,
    "duplicateResultJson" JSONB,
    "requiredFieldResultJson" JSONB,
    "geographyResultJson" JSONB,
    "consentResultJson" JSONB,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadEligibilityAssessment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadEligibilityAssessment_sourceLeadEventId_policyKey_policyVersion_key" ON "LeadEligibilityAssessment"("sourceLeadEventId", "policyKey", "policyVersion");
CREATE INDEX "LeadEligibilityAssessment_status_evaluatedAt_idx" ON "LeadEligibilityAssessment"("status", "evaluatedAt");
CREATE INDEX "LeadEligibilityAssessment_policyKey_policyVersion_idx" ON "LeadEligibilityAssessment"("policyKey", "policyVersion");

ALTER TABLE "LeadEligibilityAssessment" ADD CONSTRAINT "LeadEligibilityAssessment_sourceLeadEventId_fkey" FOREIGN KEY ("sourceLeadEventId") REFERENCES "SourceLeadEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable LeadAllocation
CREATE TABLE "LeadAllocation" (
    "id" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "leadOrderId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "status" "LeadAllocationStatus" NOT NULL DEFAULT 'shadow',
    "allocationPolicyVersion" TEXT NOT NULL,
    "decisionReasonsJson" JSONB NOT NULL DEFAULT '[]',
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadAllocation_idempotencyKey_key" ON "LeadAllocation"("idempotencyKey");
CREATE INDEX "LeadAllocation_sourceLeadEventId_idx" ON "LeadAllocation"("sourceLeadEventId");
CREATE INDEX "LeadAllocation_leadOrderId_status_idx" ON "LeadAllocation"("leadOrderId", "status");
CREATE INDEX "LeadAllocation_clientAccountId_status_idx" ON "LeadAllocation"("clientAccountId", "status");

ALTER TABLE "LeadAllocation" ADD CONSTRAINT "LeadAllocation_sourceLeadEventId_fkey" FOREIGN KEY ("sourceLeadEventId") REFERENCES "SourceLeadEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAllocation" ADD CONSTRAINT "LeadAllocation_leadOrderId_fkey" FOREIGN KEY ("leadOrderId") REFERENCES "LeadOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable DeliveryInstruction
CREATE TABLE "DeliveryInstruction" (
    "id" TEXT NOT NULL,
    "leadAllocationId" TEXT NOT NULL,
    "deliveryTargetId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "status" "DeliveryInstructionStatus" NOT NULL DEFAULT 'planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryInstruction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryInstruction_leadAllocationId_deliveryTargetId_key" ON "DeliveryInstruction"("leadAllocationId", "deliveryTargetId");
CREATE INDEX "DeliveryInstruction_leadAllocationId_sequence_idx" ON "DeliveryInstruction"("leadAllocationId", "sequence");

ALTER TABLE "DeliveryInstruction" ADD CONSTRAINT "DeliveryInstruction_leadAllocationId_fkey" FOREIGN KEY ("leadAllocationId") REFERENCES "LeadAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryInstruction" ADD CONSTRAINT "DeliveryInstruction_deliveryTargetId_fkey" FOREIGN KEY ("deliveryTargetId") REFERENCES "DeliveryTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable FulfillmentOutbox
CREATE TABLE "FulfillmentOutbox" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "workType" TEXT NOT NULL,
    "status" "FulfillmentOutboxStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enqueuedAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FulfillmentOutbox_idempotencyKey_key" ON "FulfillmentOutbox"("idempotencyKey");
CREATE INDEX "FulfillmentOutbox_status_availableAt_idx" ON "FulfillmentOutbox"("status", "availableAt");
CREATE INDEX "FulfillmentOutbox_sourceLeadEventId_idx" ON "FulfillmentOutbox"("sourceLeadEventId");
CREATE INDEX "FulfillmentOutbox_workType_status_idx" ON "FulfillmentOutbox"("workType", "status");

ALTER TABLE "FulfillmentOutbox" ADD CONSTRAINT "FulfillmentOutbox_sourceLeadEventId_fkey" FOREIGN KEY ("sourceLeadEventId") REFERENCES "SourceLeadEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
