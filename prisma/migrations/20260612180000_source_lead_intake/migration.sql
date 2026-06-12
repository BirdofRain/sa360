-- CreateEnum
CREATE TYPE "SourceLeadProvider" AS ENUM ('leadcapture_io', 'facebook', 'goat_leads', 'manual_import', 'google_sheets', 'unknown');

-- CreateEnum
CREATE TYPE "SourceLeadSystem" AS ENUM ('leadcapture_io_legacy', 'leadcapture_io_nextgen', 'meta_lead_ads', 'external_vendor', 'csv_import', 'google_sheet_import');

-- CreateEnum
CREATE TYPE "SourceLeadType" AS ENUM ('webhook', 'lead_form', 'bulk_import', 'api_import', 'manual_entry');

-- CreateEnum
CREATE TYPE "SourceLeadEventStatus" AS ENUM ('received', 'normalized', 'routing_matched', 'routing_unmatched', 'duplicate_blocked', 'needs_review', 'approved', 'delivered', 'delivery_failed', 'rejected');

-- AlterEnum
ALTER TYPE "WebhookRequestSource" ADD VALUE 'leadcapture_io';

-- CreateTable
CREATE TABLE "SourceLeadEvent" (
    "id" TEXT NOT NULL,
    "sourceProvider" "SourceLeadProvider" NOT NULL,
    "sourceSystem" "SourceLeadSystem" NOT NULL,
    "sourceType" "SourceLeadType" NOT NULL,
    "sourceRouteKey" TEXT,
    "sourceCampaignId" TEXT,
    "sourceCampaignName" TEXT,
    "sourceFunnelName" TEXT,
    "sourceLeadId" TEXT,
    "sourceLeadUid" TEXT,
    "clientAccountIdResolved" TEXT,
    "destinationLocationIdResolved" TEXT,
    "routingRuleIdResolved" TEXT,
    "status" "SourceLeadEventStatus" NOT NULL DEFAULT 'received',
    "rawPayloadJson" JSONB NOT NULL,
    "normalizedPayloadJson" JSONB,
    "routingResultJson" JSONB,
    "duplicateRiskJson" JSONB,
    "deliveryResultJson" JSONB,
    "routingDryRunDecisionId" TEXT,
    "errorSummary" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedAt" TIMESTAMP(3),
    "routedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceLeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceLeadEvent_receivedAt_idx" ON "SourceLeadEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "SourceLeadEvent_status_receivedAt_idx" ON "SourceLeadEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "SourceLeadEvent_sourceProvider_receivedAt_idx" ON "SourceLeadEvent"("sourceProvider", "receivedAt");

-- CreateIndex
CREATE INDEX "SourceLeadEvent_sourceSystem_receivedAt_idx" ON "SourceLeadEvent"("sourceSystem", "receivedAt");

-- CreateIndex
CREATE INDEX "SourceLeadEvent_sourceRouteKey_idx" ON "SourceLeadEvent"("sourceRouteKey");

-- CreateIndex
CREATE INDEX "SourceLeadEvent_clientAccountIdResolved_idx" ON "SourceLeadEvent"("clientAccountIdResolved");
