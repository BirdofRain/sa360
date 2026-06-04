-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticketNumber" SERIAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'admin_coc',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "subject" TEXT,
    "description" TEXT NOT NULL,
    "requesterName" TEXT,
    "requesterEmail" TEXT,
    "requesterUserId" TEXT,
    "assignedToName" TEXT,
    "assignedToUserId" TEXT,
    "clientAccountId" TEXT,
    "masterClientAccountId" TEXT,
    "subaccountIdGhl" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "pagePath" TEXT,
    "pageUrl" TEXT,
    "queryJson" JSONB,
    "contextJson" JSONB,
    "userAgent" TEXT,
    "internalNotes" JSONB,
    "resolutionSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_priority_createdAt_idx" ON "SupportTicket"("priority", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_category_createdAt_idx" ON "SupportTicket"("category", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_clientAccountId_idx" ON "SupportTicket"("clientAccountId");

-- CreateIndex
CREATE INDEX "SupportTicket_masterClientAccountId_idx" ON "SupportTicket"("masterClientAccountId");

-- CreateIndex
CREATE INDEX "SupportTicket_subaccountIdGhl_idx" ON "SupportTicket"("subaccountIdGhl");

-- CreateIndex
CREATE INDEX "SupportTicket_relatedEntityType_relatedEntityId_idx" ON "SupportTicket"("relatedEntityType", "relatedEntityId");
