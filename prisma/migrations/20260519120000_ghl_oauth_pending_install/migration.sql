-- CreateTable
CREATE TABLE "GhlOAuthPendingInstall" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT,
    "companyId" TEXT,
    "userId" TEXT,
    "userType" TEXT,
    "appId" TEXT,
    "versionId" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending_location',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlOAuthPendingInstall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GhlOAuthPendingInstall_status_updatedAt_idx" ON "GhlOAuthPendingInstall"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "GhlOAuthPendingInstall_companyId_status_idx" ON "GhlOAuthPendingInstall"("companyId", "status");

-- CreateIndex
CREATE INDEX "GhlOAuthPendingInstall_userId_status_idx" ON "GhlOAuthPendingInstall"("userId", "status");

-- CreateIndex
CREATE INDEX "GhlOAuthPendingInstall_appId_status_idx" ON "GhlOAuthPendingInstall"("appId", "status");
