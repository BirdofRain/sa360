-- CreateEnum
CREATE TYPE "LeadCaptureTrustSyncAction" AS ENUM ('PREVIEW', 'ATTACH', 'RECONCILE_PREVIEW');

-- CreateEnum
CREATE TYPE "LeadCaptureTrustSyncReviewStatus" AS ENUM ('applied', 'idempotent_replay', 'blocked', 'preview_only');

-- CreateEnum
CREATE TYPE "LeadCaptureTrustCorrelationClassification" AS ENUM (
  'exact_match',
  'preview_identity_match',
  'ambiguous',
  'no_match',
  'campaign_mismatch',
  'client_mismatch',
  'source_lane_mismatch'
);

-- CreateTable
CREATE TABLE "LeadCaptureTrustSyncAuditEvent" (
    "id" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "leadProofId" TEXT,
    "providerLeadIdFingerprint" TEXT NOT NULL,
    "maskedProviderLeadId" TEXT,
    "campaignId" TEXT NOT NULL,
    "formId" TEXT,
    "clientAccountId" TEXT NOT NULL,
    "action" "LeadCaptureTrustSyncAction" NOT NULL,
    "priorContentHash" TEXT,
    "newContentHash" TEXT,
    "correlationClassification" "LeadCaptureTrustCorrelationClassification" NOT NULL,
    "previousProofStatus" "LeadProofStatus",
    "newProofStatus" "LeadProofStatus",
    "reviewStatus" "LeadCaptureTrustSyncReviewStatus" NOT NULL,
    "completenessStatus" TEXT,
    "missingFieldsJson" JSONB,
    "warningsJson" JSONB,
    "requestId" TEXT NOT NULL,
    "requestedBy" TEXT,
    "operatorNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadCaptureTrustSyncAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadCaptureTrustSyncAuditEvent_sourceLeadEventId_requestId_key" ON "LeadCaptureTrustSyncAuditEvent"("sourceLeadEventId", "requestId");

-- CreateIndex
CREATE INDEX "LeadCaptureTrustSyncAuditEvent_sourceLeadEventId_createdAt_idx" ON "LeadCaptureTrustSyncAuditEvent"("sourceLeadEventId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadCaptureTrustSyncAuditEvent_providerLeadIdFingerprint_new_idx" ON "LeadCaptureTrustSyncAuditEvent"("providerLeadIdFingerprint", "newContentHash");

-- CreateIndex
CREATE INDEX "LeadCaptureTrustSyncAuditEvent_campaignId_createdAt_idx" ON "LeadCaptureTrustSyncAuditEvent"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadCaptureTrustSyncAuditEvent_clientAccountId_createdAt_idx" ON "LeadCaptureTrustSyncAuditEvent"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadCaptureTrustSyncAuditEvent_action_createdAt_idx" ON "LeadCaptureTrustSyncAuditEvent"("action", "createdAt");
