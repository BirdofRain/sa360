-- CreateEnum
CREATE TYPE "InboundContactSourceOrigin" AS ENUM ('lifecycle_webhook', 'ghl_backfill', 'merged');

-- CreateEnum
CREATE TYPE "InboundContactClientStatus" AS ENUM ('LEAD', 'EXISTING_CLIENT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "InboundContactIndex" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "subaccountIdGhl" TEXT NOT NULL DEFAULT '',
    "phoneE164" TEXT NOT NULL,
    "leadUid" TEXT,
    "contactIdGhl" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT,
    "email" TEXT,
    "state" TEXT,
    "assignedAgentId" TEXT,
    "assignedAgentName" TEXT,
    "lifecycleStage" TEXT,
    "appointmentStatus" TEXT,
    "policyStatus" TEXT,
    "leadType" TEXT,
    "sourceOrigin" "InboundContactSourceOrigin" NOT NULL,
    "clientStatus" "InboundContactClientStatus",
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundContactIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundContactIndex_clientAccountId_subaccountIdGhl_phoneE164_key" ON "InboundContactIndex"("clientAccountId", "subaccountIdGhl", "phoneE164");

-- CreateIndex
CREATE INDEX "InboundContactIndex_clientAccountId_phoneE164_idx" ON "InboundContactIndex"("clientAccountId", "phoneE164");

-- CreateIndex
CREATE INDEX "InboundContactIndex_contactIdGhl_idx" ON "InboundContactIndex"("contactIdGhl");

-- CreateIndex
CREATE INDEX "InboundContactIndex_clientAccountId_idx" ON "InboundContactIndex"("clientAccountId");
