-- Phase 4G: delivery readiness / guarded live delivery config on CampaignRoutingRule

ALTER TABLE "CampaignRoutingRule" ADD COLUMN "locationName" TEXT;
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "ghlConnectionStatus" TEXT;
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "snapshotInstalled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "requiredFieldsInstalled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "deliveryMode" TEXT NOT NULL DEFAULT 'shadow';
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "clientCutoverApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "internalApprovalStatus" TEXT NOT NULL DEFAULT 'not_reviewed';
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "lastReadinessCheckAt" TIMESTAMP(3);
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "readinessStatus" TEXT NOT NULL DEFAULT 'not_ready';
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "readinessWarnings" JSONB;
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "opportunityCreationEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "CampaignRoutingRule_readinessStatus_idx" ON "CampaignRoutingRule"("readinessStatus");
CREATE INDEX "CampaignRoutingRule_clientAccountId_readinessStatus_idx" ON "CampaignRoutingRule"("clientAccountId", "readinessStatus");
