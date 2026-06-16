-- AlterTable
ALTER TABLE "SourceLeadEvent" ADD COLUMN "webhookRequestLogId" TEXT;

-- AlterTable
ALTER TABLE "WebhookRequestLog" ADD COLUMN "sourceLeadEventId" TEXT,
ADD COLUMN "normalizedLeadUid" TEXT,
ADD COLUMN "routingDryRunDecisionId" TEXT;

-- CreateIndex
CREATE INDEX "SourceLeadEvent_webhookRequestLogId_idx" ON "SourceLeadEvent"("webhookRequestLogId");

-- CreateIndex
CREATE INDEX "WebhookRequestLog_sourceLeadEventId_idx" ON "WebhookRequestLog"("sourceLeadEventId");

-- CreateIndex
CREATE INDEX "WebhookRequestLog_normalizedLeadUid_idx" ON "WebhookRequestLog"("normalizedLeadUid");
