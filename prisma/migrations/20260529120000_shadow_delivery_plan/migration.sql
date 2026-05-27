-- AlterTable
ALTER TABLE "CampaignRoutingRule" ADD COLUMN     "destinationWorkflowIdGhl" TEXT,
ADD COLUMN     "destinationPipelineIdGhl" TEXT,
ADD COLUMN     "destinationPipelineStageIdGhl" TEXT,
ADD COLUMN     "backupSheetEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "backupSheetId" TEXT,
ADD COLUMN     "defaultAssignedUserIdGhl" TEXT,
ADD COLUMN     "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shadowDeliveryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "LeadDeliveryPlan" (
    "id" TEXT NOT NULL,
    "routingDryRunDecisionId" TEXT,
    "lifecycleEventId" TEXT,
    "masterClientAccountId" TEXT NOT NULL,
    "sourceLeadUid" TEXT,
    "sourceContactIdGhl" TEXT,
    "sourcePhoneE164" TEXT,
    "sourceEmail" TEXT,
    "destinationClientAccountId" TEXT NOT NULL,
    "destinationSubaccountIdGhl" TEXT NOT NULL DEFAULT '',
    "destinationClientDisplayName" TEXT,
    "nicheKey" TEXT,
    "productType" TEXT,
    "deliveryMode" TEXT NOT NULL DEFAULT 'shadow',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "planVersion" TEXT NOT NULL DEFAULT '1.0',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL DEFAULT 'sa360_shadow_delivery',
    "summary" TEXT,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDeliveryPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDeliveryPlanStep" (
    "id" TEXT NOT NULL,
    "deliveryPlanId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetSystem" TEXT,
    "targetId" TEXT,
    "requestPreviewJson" JSONB,
    "resultPreviewJson" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDeliveryPlanStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadDeliveryPlan_routingDryRunDecisionId_key" ON "LeadDeliveryPlan"("routingDryRunDecisionId");

-- CreateIndex
CREATE INDEX "LeadDeliveryPlan_masterClientAccountId_generatedAt_idx" ON "LeadDeliveryPlan"("masterClientAccountId", "generatedAt");

-- CreateIndex
CREATE INDEX "LeadDeliveryPlan_destinationClientAccountId_generatedAt_idx" ON "LeadDeliveryPlan"("destinationClientAccountId", "generatedAt");

-- CreateIndex
CREATE INDEX "LeadDeliveryPlan_status_generatedAt_idx" ON "LeadDeliveryPlan"("status", "generatedAt");

-- CreateIndex
CREATE INDEX "LeadDeliveryPlanStep_deliveryPlanId_idx" ON "LeadDeliveryPlanStep"("deliveryPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDeliveryPlanStep_deliveryPlanId_stepOrder_key" ON "LeadDeliveryPlanStep"("deliveryPlanId", "stepOrder");

-- AddForeignKey
ALTER TABLE "LeadDeliveryPlan" ADD CONSTRAINT "LeadDeliveryPlan_routingDryRunDecisionId_fkey" FOREIGN KEY ("routingDryRunDecisionId") REFERENCES "RoutingDryRunDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDeliveryPlanStep" ADD CONSTRAINT "LeadDeliveryPlanStep_deliveryPlanId_fkey" FOREIGN KEY ("deliveryPlanId") REFERENCES "LeadDeliveryPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
