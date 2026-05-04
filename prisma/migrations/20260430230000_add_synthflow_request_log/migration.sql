-- CreateTable
CREATE TABLE "SynthflowRequestLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'synthflow_inbound_lookup',
    "route" TEXT NOT NULL DEFAULT '/voice/synthflow/inbound-lookup',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "httpStatus" INTEGER,
    "processingStatus" TEXT NOT NULL,
    "clientAccountId" TEXT,
    "subaccountIdGhl" TEXT,
    "fromNumber" TEXT,
    "toNumber" TEXT,
    "phoneE164" TEXT,
    "modelId" TEXT,
    "knownCaller" TEXT,
    "matchedBy" TEXT,
    "lookupStatus" TEXT,
    "overrideModelId" TEXT,
    "contactIdGhl" TEXT,
    "assignedAgentName" TEXT,
    "customerName" TEXT,
    "requestBodyRedacted" JSONB,
    "responseBodyRedacted" JSONB,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SynthflowRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SynthflowRequestLog_receivedAt_idx" ON "SynthflowRequestLog"("receivedAt");

-- CreateIndex
CREATE INDEX "SynthflowRequestLog_source_receivedAt_idx" ON "SynthflowRequestLog"("source", "receivedAt");

-- CreateIndex
CREATE INDEX "SynthflowRequestLog_lookupStatus_receivedAt_idx" ON "SynthflowRequestLog"("lookupStatus", "receivedAt");

-- CreateIndex
CREATE INDEX "SynthflowRequestLog_knownCaller_receivedAt_idx" ON "SynthflowRequestLog"("knownCaller", "receivedAt");

-- CreateIndex
CREATE INDEX "SynthflowRequestLog_clientAccountId_receivedAt_idx" ON "SynthflowRequestLog"("clientAccountId", "receivedAt");

-- CreateIndex
CREATE INDEX "SynthflowRequestLog_subaccountIdGhl_receivedAt_idx" ON "SynthflowRequestLog"("subaccountIdGhl", "receivedAt");
