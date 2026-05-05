-- CreateTable
CREATE TABLE "SynthflowOutboundResultLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "callId" TEXT NOT NULL,
    "modelId" TEXT,
    "fromNumber" TEXT,
    "toNumber" TEXT,
    "fromNumberE164" TEXT,
    "toNumberE164" TEXT,
    "contactIdGhl" TEXT,
    "clientAccountId" TEXT,
    "subaccountIdGhl" TEXT,
    "outcome" TEXT NOT NULL,
    "booked" BOOLEAN NOT NULL DEFAULT false,
    "appointmentTime" TIMESTAMP(3),
    "transcriptSummary" TEXT,
    "payloadRedacted" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SynthflowOutboundResultLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SynthflowOutboundResultLog_receivedAt_idx" ON "SynthflowOutboundResultLog"("receivedAt");

-- CreateIndex
CREATE INDEX "SynthflowOutboundResultLog_callId_receivedAt_idx" ON "SynthflowOutboundResultLog"("callId", "receivedAt");

-- CreateIndex
CREATE INDEX "SynthflowOutboundResultLog_outcome_receivedAt_idx" ON "SynthflowOutboundResultLog"("outcome", "receivedAt");

-- CreateIndex
CREATE INDEX "SynthflowOutboundResultLog_clientAccountId_receivedAt_idx" ON "SynthflowOutboundResultLog"("clientAccountId", "receivedAt");

-- CreateIndex
CREATE INDEX "SynthflowOutboundResultLog_contactIdGhl_receivedAt_idx" ON "SynthflowOutboundResultLog"("contactIdGhl", "receivedAt");
