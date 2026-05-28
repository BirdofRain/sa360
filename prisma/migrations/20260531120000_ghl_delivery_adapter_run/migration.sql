-- Phase 4H: GHL delivery adapter simulation runs (no external writes)

CREATE TABLE "GhlDeliveryAdapterRun" (
    "id" TEXT NOT NULL,
    "leadDeliveryPlanId" TEXT NOT NULL,
    "routingDryRunDecisionId" TEXT,
    "masterClientAccountId" TEXT NOT NULL,
    "destinationClientAccountId" TEXT NOT NULL,
    "destinationSubaccountIdGhl" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "summary" TEXT,
    "warnings" JSONB,
    "errors" JSONB,
    "createdBy" TEXT NOT NULL DEFAULT 'sa360_ghl_adapter_test',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlDeliveryAdapterRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GhlDeliveryAdapterStepRun" (
    "id" TEXT NOT NULL,
    "adapterRunId" TEXT NOT NULL,
    "deliveryPlanStepId" TEXT,
    "stepOrder" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "targetSystem" TEXT NOT NULL DEFAULT 'ghl',
    "targetId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requestPreviewJson" JSONB,
    "responsePreviewJson" JSONB,
    "validationErrors" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlDeliveryAdapterStepRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GhlDeliveryAdapterRun_leadDeliveryPlanId_startedAt_idx" ON "GhlDeliveryAdapterRun"("leadDeliveryPlanId", "startedAt");
CREATE INDEX "GhlDeliveryAdapterRun_masterClientAccountId_startedAt_idx" ON "GhlDeliveryAdapterRun"("masterClientAccountId", "startedAt");
CREATE INDEX "GhlDeliveryAdapterRun_destinationClientAccountId_startedAt_idx" ON "GhlDeliveryAdapterRun"("destinationClientAccountId", "startedAt");
CREATE INDEX "GhlDeliveryAdapterRun_status_startedAt_idx" ON "GhlDeliveryAdapterRun"("status", "startedAt");
CREATE INDEX "GhlDeliveryAdapterStepRun_adapterRunId_stepOrder_idx" ON "GhlDeliveryAdapterStepRun"("adapterRunId", "stepOrder");

ALTER TABLE "GhlDeliveryAdapterRun" ADD CONSTRAINT "GhlDeliveryAdapterRun_leadDeliveryPlanId_fkey" FOREIGN KEY ("leadDeliveryPlanId") REFERENCES "LeadDeliveryPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GhlDeliveryAdapterStepRun" ADD CONSTRAINT "GhlDeliveryAdapterStepRun_adapterRunId_fkey" FOREIGN KEY ("adapterRunId") REFERENCES "GhlDeliveryAdapterRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
