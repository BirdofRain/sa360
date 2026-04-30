-- CreateEnum
CREATE TYPE "WebhookRequestSource" AS ENUM ('ghl_lifecycle');

-- CreateTable
CREATE TABLE "WebhookRequestLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "source" "WebhookRequestSource" NOT NULL DEFAULT 'ghl_lifecycle',
    "route" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "processingStatus" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "clientAccountId" TEXT,
    "subaccountIdGhl" TEXT,
    "contactIdGhl" TEXT,
    "eventUuid" TEXT,
    "eventNameInternal" TEXT,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "requestBodyRedacted" JSONB,
    "responseBodyRedacted" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookRequestLog_receivedAt_idx" ON "WebhookRequestLog"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookRequestLog_clientAccountId_receivedAt_idx" ON "WebhookRequestLog"("clientAccountId", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookRequestLog_processingStatus_receivedAt_idx" ON "WebhookRequestLog"("processingStatus", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookRequestLog_source_receivedAt_idx" ON "WebhookRequestLog"("source", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookRequestLog_eventUuid_idx" ON "WebhookRequestLog"("eventUuid");
