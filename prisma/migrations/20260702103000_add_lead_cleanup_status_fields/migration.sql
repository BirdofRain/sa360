-- Additive cleanup-status columns for safe lead record triage.
ALTER TABLE "SourceLeadEvent"
ADD COLUMN "cleanupStatus" TEXT,
ADD COLUMN "cleanupReason" TEXT,
ADD COLUMN "cleanupMarkedAt" TIMESTAMP(3);

ALTER TABLE "RoutingDryRunDecision"
ADD COLUMN "cleanupStatus" TEXT,
ADD COLUMN "cleanupReason" TEXT,
ADD COLUMN "cleanupMarkedAt" TIMESTAMP(3);

CREATE INDEX "SourceLeadEvent_cleanupStatus_receivedAt_idx"
ON "SourceLeadEvent"("cleanupStatus", "receivedAt");

CREATE INDEX "RoutingDryRunDecision_cleanupStatus_createdAt_idx"
ON "RoutingDryRunDecision"("cleanupStatus", "createdAt");
