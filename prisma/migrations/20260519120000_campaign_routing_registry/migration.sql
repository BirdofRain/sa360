-- CreateEnum
CREATE TYPE "CampaignRoutingMatchType" AS ENUM ('campaign_id', 'adset_id', 'ad_id', 'form_id_utm_campaign', 'utm_campaign', 'keyword_fallback');

-- CreateTable
CREATE TABLE "CampaignRoutingRule" (
    "id" TEXT NOT NULL,
    "masterClientAccountId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "destinationSubaccountIdGhl" TEXT NOT NULL DEFAULT '',
    "clientDisplayName" TEXT,
    "nicheKey" TEXT,
    "productType" TEXT,
    "sourcePlatform" TEXT,
    "sourceType" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adsetId" TEXT,
    "adId" TEXT,
    "formId" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "masterDatasetId" TEXT,
    "matchType" "CampaignRoutingMatchType" NOT NULL,
    "keywordPattern" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveStart" TIMESTAMP(3),
    "effectiveEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingDryRunDecision" (
    "id" TEXT NOT NULL,
    "masterClientAccountId" TEXT NOT NULL,
    "sourceEventUuid" TEXT,
    "sourceLeadUid" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "confidence" TEXT NOT NULL,
    "matchedRuleId" TEXT,
    "destinationClientAccountId" TEXT,
    "destinationSubaccountIdGhl" TEXT,
    "matchReason" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL DEFAULT 'dry_run',
    "routingEventNameInternal" TEXT NOT NULL,
    "attributionSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingDryRunDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignRoutingRule_masterClientAccountId_active_priority_idx" ON "CampaignRoutingRule"("masterClientAccountId", "active", "priority");

-- CreateIndex
CREATE INDEX "CampaignRoutingRule_masterClientAccountId_matchType_active_idx" ON "CampaignRoutingRule"("masterClientAccountId", "matchType", "active");

-- CreateIndex
CREATE INDEX "CampaignRoutingRule_masterClientAccountId_campaignId_idx" ON "CampaignRoutingRule"("masterClientAccountId", "campaignId");

-- CreateIndex
CREATE INDEX "CampaignRoutingRule_masterClientAccountId_adsetId_idx" ON "CampaignRoutingRule"("masterClientAccountId", "adsetId");

-- CreateIndex
CREATE INDEX "CampaignRoutingRule_masterClientAccountId_adId_idx" ON "CampaignRoutingRule"("masterClientAccountId", "adId");

-- CreateIndex
CREATE INDEX "CampaignRoutingRule_clientAccountId_idx" ON "CampaignRoutingRule"("clientAccountId");

-- CreateIndex
CREATE INDEX "RoutingDryRunDecision_masterClientAccountId_createdAt_idx" ON "RoutingDryRunDecision"("masterClientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutingDryRunDecision_sourceLeadUid_idx" ON "RoutingDryRunDecision"("sourceLeadUid");

-- CreateIndex
CREATE INDEX "RoutingDryRunDecision_sourceEventUuid_idx" ON "RoutingDryRunDecision"("sourceEventUuid");

-- CreateIndex
CREATE INDEX "RoutingDryRunDecision_matched_createdAt_idx" ON "RoutingDryRunDecision"("matched", "createdAt");
