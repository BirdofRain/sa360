-- CreateEnum
CREATE TYPE "LeadOrderStatus" AS ENUM ('draft', 'submitted', 'needs_setup', 'needs_compliance', 'ready', 'active', 'paused', 'completed', 'canceled');

-- CreateEnum
CREATE TYPE "LeadOrderCreatedByRole" AS ENUM ('admin', 'client', 'system');

-- CreateTable
CREATE TABLE "LeadOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "clientDisplayName" TEXT,
    "status" "LeadOrderStatus" NOT NULL DEFAULT 'submitted',
    "nicheKey" TEXT NOT NULL,
    "productType" TEXT,
    "statesJson" JSONB NOT NULL DEFAULT '[]',
    "leadVolume" INTEGER NOT NULL,
    "deliveryCadence" TEXT,
    "campaignType" TEXT NOT NULL,
    "crmPackage" TEXT NOT NULL,
    "aiVoiceAddon" BOOLEAN NOT NULL DEFAULT false,
    "requestedStartDate" TIMESTAMP(3),
    "deliveryDestinationType" TEXT,
    "deliveryDestinationLabel" TEXT,
    "notes" TEXT,
    "adminNotes" TEXT,
    "trustStatusSnapshotJson" JSONB,
    "routingRuleId" TEXT,
    "campaignId" TEXT,
    "createdByRole" "LeadOrderCreatedByRole" NOT NULL,
    "createdByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadOrder_orderNumber_key" ON "LeadOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "LeadOrder_clientAccountId_createdAt_idx" ON "LeadOrder"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadOrder_status_createdAt_idx" ON "LeadOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LeadOrder_nicheKey_idx" ON "LeadOrder"("nicheKey");
