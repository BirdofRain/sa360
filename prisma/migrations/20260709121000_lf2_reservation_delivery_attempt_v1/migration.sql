-- LF2 Phase 2 PR A (step 2): reservation metadata, DeliveryAttempt, partial unique indexes.

ALTER TABLE "LeadAllocation"
  ADD COLUMN "reservationIdempotencyKey" TEXT,
  ADD COLUMN "reservationPolicyVersion" TEXT,
  ADD COLUMN "releaseReasonJson" JSONB,
  ADD COLUMN "reviewReasonJson" JSONB;

CREATE UNIQUE INDEX "LeadAllocation_reservationIdempotencyKey_key"
  ON "LeadAllocation"("reservationIdempotencyKey");

CREATE INDEX "LeadAllocation_sourceLeadEventId_status_idx"
  ON "LeadAllocation"("sourceLeadEventId", "status");

CREATE UNIQUE INDEX "LeadAllocation_sourceLeadEventId_active_exclusivity_key"
  ON "LeadAllocation"("sourceLeadEventId")
  WHERE status IN ('reserved', 'delivering', 'committed', 'review_required');

CREATE TABLE "DeliveryAttempt" (
  "id" TEXT NOT NULL,
  "deliveryInstructionId" TEXT NOT NULL,
  "adapterKey" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "DeliveryAttemptStatus" NOT NULL DEFAULT 'planned',
  "requestFingerprint" TEXT,
  "sanitizedRequestJson" JSONB,
  "sanitizedResponseJson" JSONB,
  "externalReference" TEXT,
  "errorCode" TEXT,
  "errorSummary" TEXT,
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryAttempt_idempotencyKey_key" ON "DeliveryAttempt"("idempotencyKey");
CREATE UNIQUE INDEX "DeliveryAttempt_deliveryInstructionId_attemptNumber_key"
  ON "DeliveryAttempt"("deliveryInstructionId", "attemptNumber");
CREATE INDEX "DeliveryAttempt_deliveryInstructionId_status_idx"
  ON "DeliveryAttempt"("deliveryInstructionId", "status");
CREATE INDEX "DeliveryAttempt_status_createdAt_idx" ON "DeliveryAttempt"("status", "createdAt");

CREATE UNIQUE INDEX "DeliveryAttempt_deliveryInstructionId_active_claim_key"
  ON "DeliveryAttempt"("deliveryInstructionId")
  WHERE status IN ('claimed', 'in_progress');

ALTER TABLE "DeliveryAttempt"
  ADD CONSTRAINT "DeliveryAttempt_deliveryInstructionId_fkey"
  FOREIGN KEY ("deliveryInstructionId") REFERENCES "DeliveryInstruction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
