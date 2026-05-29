-- CreateTable
CREATE TABLE "GhlLiveDeliveryRun" (
    "id" TEXT NOT NULL,
    "leadDeliveryPlanId" TEXT NOT NULL,
    "routingDryRunDecisionId" TEXT,
    "campaignRoutingRuleId" TEXT,
    "masterClientAccountId" TEXT NOT NULL,
    "destinationClientAccountId" TEXT NOT NULL,
    "destinationSubaccountIdGhl" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operatorConfirmationText" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "executedBy" TEXT,
    "summary" TEXT,
    "warnings" JSONB,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlLiveDeliveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GhlLiveDeliveryStepRun" (
    "id" TEXT NOT NULL,
    "liveRunId" TEXT NOT NULL,
    "deliveryPlanStepId" TEXT,
    "stepOrder" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "targetSystem" TEXT NOT NULL DEFAULT 'ghl',
    "targetId" TEXT,
    "status" TEXT NOT NULL,
    "requestRedactedJson" JSONB,
    "responseRedactedJson" JSONB,
    "externalId" TEXT,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "warnings" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlLiveDeliveryStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GhlLiveDeliveryRun_idempotencyKey_key" ON "GhlLiveDeliveryRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GhlLiveDeliveryRun_leadDeliveryPlanId_startedAt_idx" ON "GhlLiveDeliveryRun"("leadDeliveryPlanId", "startedAt");

-- CreateIndex
CREATE INDEX "GhlLiveDeliveryRun_masterClientAccountId_startedAt_idx" ON "GhlLiveDeliveryRun"("masterClientAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "GhlLiveDeliveryRun_destinationClientAccountId_startedAt_idx" ON "GhlLiveDeliveryRun"("destinationClientAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "GhlLiveDeliveryRun_status_startedAt_idx" ON "GhlLiveDeliveryRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "GhlLiveDeliveryRun_idempotencyKey_idx" ON "GhlLiveDeliveryRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GhlLiveDeliveryStepRun_liveRunId_stepOrder_idx" ON "GhlLiveDeliveryStepRun"("liveRunId", "stepOrder");

-- AddForeignKey
ALTER TABLE "GhlLiveDeliveryRun" ADD CONSTRAINT "GhlLiveDeliveryRun_leadDeliveryPlanId_fkey" FOREIGN KEY ("leadDeliveryPlanId") REFERENCES "LeadDeliveryPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GhlLiveDeliveryStepRun" ADD CONSTRAINT "GhlLiveDeliveryStepRun_liveRunId_fkey" FOREIGN KEY ("liveRunId") REFERENCES "GhlLiveDeliveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
