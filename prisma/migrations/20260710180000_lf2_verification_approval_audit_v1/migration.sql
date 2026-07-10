-- CreateEnum
CREATE TYPE "LeadVerificationApprovalActionType" AS ENUM ('APPROVE_UNIQUE', 'REVOKE_TO_REVIEW');

-- CreateEnum
CREATE TYPE "LeadVerificationApprovalStatus" AS ENUM ('applied', 'rejected', 'idempotent_replay');

-- CreateTable
CREATE TABLE "LeadVerificationApprovalAuditEvent" (
    "id" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "sourceLeadUidMasked" TEXT,
    "leadUid" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "destinationSubaccountIdGhl" TEXT NOT NULL,
    "actionType" "LeadVerificationApprovalActionType" NOT NULL,
    "previousVerificationStatus" "LeadVerificationStatus",
    "previousDuplicateStatus" "LeadDuplicateStatus",
    "newVerificationStatus" "LeadVerificationStatus",
    "newDuplicateStatus" "LeadDuplicateStatus",
    "phoneFingerprint" TEXT,
    "emailFingerprint" TEXT,
    "duplicateSearchClassification" TEXT,
    "duplicateSearchReasonCode" TEXT,
    "phoneSearchOutcome" TEXT,
    "emailSearchOutcome" TEXT,
    "matchedContactIdGhl" TEXT,
    "approvalStatus" "LeadVerificationApprovalStatus" NOT NULL,
    "reasonsJson" JSONB,
    "metadataJson" JSONB,
    "requestedBy" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadVerificationApprovalAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadVerificationApprovalAuditEvent_sourceLeadEventId_created_idx" ON "LeadVerificationApprovalAuditEvent"("sourceLeadEventId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadVerificationApprovalAuditEvent_leadUid_createdAt_idx" ON "LeadVerificationApprovalAuditEvent"("leadUid", "createdAt");

-- CreateIndex
CREATE INDEX "LeadVerificationApprovalAuditEvent_clientAccountId_createdAt_idx" ON "LeadVerificationApprovalAuditEvent"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadVerificationApprovalAuditEvent_destinationSubaccountIdG_idx" ON "LeadVerificationApprovalAuditEvent"("destinationSubaccountIdGhl", "createdAt");

-- CreateIndex
CREATE INDEX "LeadVerificationApprovalAuditEvent_requestId_idx" ON "LeadVerificationApprovalAuditEvent"("requestId");
