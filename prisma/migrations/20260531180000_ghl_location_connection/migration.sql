-- CreateTable
CREATE TABLE "GhlLocationConnection" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT,
    "locationId" TEXT NOT NULL,
    "locationName" TEXT,
    "companyId" TEXT,
    "userId" TEXT,
    "appId" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" JSONB,
    "authMode" TEXT NOT NULL DEFAULT 'oauth',
    "connectionStatus" TEXT NOT NULL DEFAULT 'connected',
    "lastProbeAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlLocationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GhlLocationConnection_locationId_key" ON "GhlLocationConnection"("locationId");

-- CreateIndex
CREATE INDEX "GhlLocationConnection_clientAccountId_idx" ON "GhlLocationConnection"("clientAccountId");

-- CreateIndex
CREATE INDEX "GhlLocationConnection_connectionStatus_updatedAt_idx" ON "GhlLocationConnection"("connectionStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "GhlLocationConnection_companyId_idx" ON "GhlLocationConnection"("companyId");
