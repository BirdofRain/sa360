-- PPL aged inventory selection v1 (additive)

CREATE TABLE "BuyerDeliveredIdentity" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "phoneFingerprint" TEXT,
    "emailFingerprint" TEXT,
    "sourceLeadEventId" TEXT NOT NULL,
    "leadAllocationId" TEXT NOT NULL,
    "leadInventoryItemId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerDeliveredIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProtectedAgentExclusion" (
    "id" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "matchValue" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtectedAgentExclusion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuyerDeliveredIdentity_clientAccountId_sourceLeadEventId_key" ON "BuyerDeliveredIdentity"("clientAccountId", "sourceLeadEventId");

CREATE INDEX "BuyerDeliveredIdentity_clientAccountId_phoneFingerprint_idx" ON "BuyerDeliveredIdentity"("clientAccountId", "phoneFingerprint");

CREATE INDEX "BuyerDeliveredIdentity_clientAccountId_emailFingerprint_idx" ON "BuyerDeliveredIdentity"("clientAccountId", "emailFingerprint");

CREATE INDEX "BuyerDeliveredIdentity_leadAllocationId_idx" ON "BuyerDeliveredIdentity"("leadAllocationId");

CREATE UNIQUE INDEX "ProtectedAgentExclusion_matchType_matchValue_key" ON "ProtectedAgentExclusion"("matchType", "matchValue");

CREATE INDEX "ProtectedAgentExclusion_active_matchType_idx" ON "ProtectedAgentExclusion"("active", "matchType");
