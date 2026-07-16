-- Lead Inventory Review & Activation v1 (additive, stacked on aged_lead_inventory_ingestion_v1)

ALTER TYPE "LeadInventoryItemStatus" ADD VALUE 'rejected';

ALTER TABLE "LeadInventoryItem" ADD COLUMN "rejectedAt" TIMESTAMP(3);

CREATE INDEX "LeadInventoryItem_rejectedAt_idx" ON "LeadInventoryItem"("rejectedAt");

CREATE TYPE "LeadInventoryReviewActionType" AS ENUM ('make_available', 'quarantine', 'reject');

CREATE TYPE "LeadInventoryReviewActionStatus" AS ENUM (
  'previewed',
  'applied',
  'partially_applied',
  'blocked',
  'idempotent_replay',
  'failed'
);

CREATE TABLE "LeadInventoryReviewAction" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actionType" "LeadInventoryReviewActionType" NOT NULL,
    "actionStatus" "LeadInventoryReviewActionStatus" NOT NULL DEFAULT 'previewed',
    "requestedBy" TEXT,
    "reasonCode" TEXT,
    "operatorNote" TEXT,
    "selectionFingerprint" TEXT NOT NULL,
    "requestedCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "resultSummaryJson" JSONB NOT NULL DEFAULT '{}',
    "previewedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadInventoryReviewAction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeadInventoryReviewAction_requestedCount_nonneg" CHECK ("requestedCount" >= 0),
    CONSTRAINT "LeadInventoryReviewAction_eligibleCount_nonneg" CHECK ("eligibleCount" >= 0),
    CONSTRAINT "LeadInventoryReviewAction_appliedCount_nonneg" CHECK ("appliedCount" >= 0),
    CONSTRAINT "LeadInventoryReviewAction_blockedCount_nonneg" CHECK ("blockedCount" >= 0)
);

CREATE UNIQUE INDEX "LeadInventoryReviewAction_requestId_key" ON "LeadInventoryReviewAction"("requestId");
CREATE INDEX "LeadInventoryReviewAction_actionStatus_createdAt_idx" ON "LeadInventoryReviewAction"("actionStatus", "createdAt");
CREATE INDEX "LeadInventoryReviewAction_actionType_createdAt_idx" ON "LeadInventoryReviewAction"("actionType", "createdAt");
CREATE INDEX "LeadInventoryReviewAction_selectionFingerprint_idx" ON "LeadInventoryReviewAction"("selectionFingerprint");

CREATE TABLE "LeadInventoryReviewItemResult" (
    "id" TEXT NOT NULL,
    "reviewActionId" TEXT NOT NULL,
    "leadInventoryItemId" TEXT NOT NULL,
    "priorStatus" "LeadInventoryItemStatus" NOT NULL,
    "resultingStatus" "LeadInventoryItemStatus",
    "reasonCode" TEXT,
    "blockerCodesJson" JSONB NOT NULL DEFAULT '[]',
    "eligibilitySnapshotJson" JSONB NOT NULL DEFAULT '{}',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadInventoryReviewItemResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadInventoryReviewItemResult_reviewActionId_leadInventoryItemId_key"
  ON "LeadInventoryReviewItemResult"("reviewActionId", "leadInventoryItemId");
CREATE INDEX "LeadInventoryReviewItemResult_leadInventoryItemId_createdAt_idx"
  ON "LeadInventoryReviewItemResult"("leadInventoryItemId", "createdAt");
CREATE INDEX "LeadInventoryReviewItemResult_reviewActionId_createdAt_idx"
  ON "LeadInventoryReviewItemResult"("reviewActionId", "createdAt");

ALTER TABLE "LeadInventoryReviewItemResult"
  ADD CONSTRAINT "LeadInventoryReviewItemResult_reviewActionId_fkey"
  FOREIGN KEY ("reviewActionId") REFERENCES "LeadInventoryReviewAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeadInventoryReviewItemResult"
  ADD CONSTRAINT "LeadInventoryReviewItemResult_leadInventoryItemId_fkey"
  FOREIGN KEY ("leadInventoryItemId") REFERENCES "LeadInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Soft invariants using only previously-committed enum values.
-- Note: PostgreSQL cannot reference a brand-new enum value ('rejected') in the
-- same transaction that adds it; rejectedAt pairing is enforced in the review
-- activation service (status=rejected always sets rejectedAt).
ALTER TABLE "LeadInventoryItem"
  ADD CONSTRAINT "LeadInventoryItem_available_requires_availableAt"
  CHECK ("status" <> 'available' OR "availableAt" IS NOT NULL);

ALTER TABLE "LeadInventoryItem"
  ADD CONSTRAINT "LeadInventoryItem_quarantined_requires_reason"
  CHECK ("status" <> 'quarantined' OR ("quarantineReason" IS NOT NULL AND length(trim("quarantineReason")) > 0));

ALTER TABLE "LeadInventoryItem"
  ADD CONSTRAINT "LeadInventoryItem_no_available_and_rejected_timestamps"
  CHECK ("availableAt" IS NULL OR "rejectedAt" IS NULL);
