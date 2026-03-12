-- CreateTable
CREATE TABLE "ClientConfig" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "clientName" TEXT,
    "metaPixelId" TEXT,
    "metaDatasetId" TEXT,
    "metaAccessToken" TEXT,
    "metaSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAttribution" (
    "id" TEXT NOT NULL,
    "leadUid" TEXT NOT NULL,
    "contactIdGhl" TEXT,
    "sourcePlatform" TEXT,
    "sourceType" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adsetId" TEXT,
    "adsetName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "fbclid" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "firstTouchAt" TIMESTAMP(3),
    "latestTouchAt" TIMESTAMP(3),

    CONSTRAINT "LeadAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifecycleEvent" (
    "id" TEXT NOT NULL,
    "eventUuid" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "subaccountIdGhl" TEXT,
    "leadUid" TEXT NOT NULL,
    "contactIdGhl" TEXT,
    "eventNameInternal" TEXT NOT NULL,
    "eventNameMeta" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "LifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaDispatchAttempt" (
    "id" TEXT NOT NULL,
    "eventUuid" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "requestJson" JSONB,
    "responseJson" JSONB,
    "httpStatus" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaDispatchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailedDispatch" (
    "id" TEXT NOT NULL,
    "eventUuid" TEXT NOT NULL,
    "failureReason" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailedDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientConfig_clientAccountId_key" ON "ClientConfig"("clientAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAttribution_leadUid_key" ON "LeadAttribution"("leadUid");

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleEvent_eventUuid_key" ON "LifecycleEvent"("eventUuid");

-- CreateIndex
CREATE UNIQUE INDEX "FailedDispatch_eventUuid_key" ON "FailedDispatch"("eventUuid");
