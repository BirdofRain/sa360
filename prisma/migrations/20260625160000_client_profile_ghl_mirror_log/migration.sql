-- CreateTable
CREATE TABLE "ClientProfileGhlMirrorLog" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL DEFAULT 'CLIENT_PROFILE_GHL_MIRROR',
    "clientAccountId" TEXT NOT NULL,
    "subaccountIdGhl" TEXT,
    "locationId" TEXT,
    "requestedBy" TEXT,
    "writeMode" TEXT NOT NULL,
    "resultStatus" TEXT NOT NULL,
    "valuesAttempted" INTEGER NOT NULL DEFAULT 0,
    "valuesWritten" INTEGER NOT NULL DEFAULT 0,
    "valuesSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "planJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientProfileGhlMirrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientProfileGhlMirrorLog_clientAccountId_createdAt_idx" ON "ClientProfileGhlMirrorLog"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientProfileGhlMirrorLog_actionType_createdAt_idx" ON "ClientProfileGhlMirrorLog"("actionType", "createdAt");

-- CreateIndex
CREATE INDEX "ClientProfileGhlMirrorLog_locationId_createdAt_idx" ON "ClientProfileGhlMirrorLog"("locationId", "createdAt");
