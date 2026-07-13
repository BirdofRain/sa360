-- CreateEnum
CREATE TYPE "LeadProofReviewActionType" AS ENUM ('APPROVE_PROOF', 'REJECT_PROOF', 'REVOKE_TO_REVIEW');

-- CreateEnum
CREATE TYPE "LeadProofReviewStatus" AS ENUM ('applied', 'rejected', 'idempotent_replay');

-- CreateTable
CREATE TABLE "LeadProofReviewAuditEvent" (
    "id" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "leadProofId" TEXT,
    "sourceLeadUidMasked" TEXT,
    "leadUidFingerprint" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "canonicalSourceLane" TEXT NOT NULL,
    "proofPolicyKey" TEXT NOT NULL,
    "actionType" "LeadProofReviewActionType" NOT NULL,
    "previousProofStatus" "LeadProofStatus",
    "extractedProofStatus" "LeadProofStatus",
    "newProofStatus" "LeadProofStatus",
    "previousVerificationStatus" "LeadVerificationStatus",
    "previousDuplicateStatus" "LeadDuplicateStatus",
    "reviewStatus" "LeadProofReviewStatus" NOT NULL,
    "evidenceSummaryJson" JSONB,
    "reasonsJson" JSONB,
    "metadataJson" JSONB,
    "requestedBy" TEXT,
    "operatorNote" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadProofReviewAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadProofReviewAuditEvent_sourceLeadEventId_requestId_key" ON "LeadProofReviewAuditEvent"("sourceLeadEventId", "requestId");

-- CreateIndex
CREATE INDEX "LeadProofReviewAuditEvent_sourceLeadEventId_createdAt_idx" ON "LeadProofReviewAuditEvent"("sourceLeadEventId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadProofReviewAuditEvent_clientAccountId_createdAt_idx" ON "LeadProofReviewAuditEvent"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadProofReviewAuditEvent_leadProofId_idx" ON "LeadProofReviewAuditEvent"("leadProofId");

-- CreateIndex
CREATE INDEX "LeadProofReviewAuditEvent_actionType_createdAt_idx" ON "LeadProofReviewAuditEvent"("actionType", "createdAt");

-- CreateIndex
CREATE INDEX "LeadProofReviewAuditEvent_createdAt_idx" ON "LeadProofReviewAuditEvent"("createdAt");
