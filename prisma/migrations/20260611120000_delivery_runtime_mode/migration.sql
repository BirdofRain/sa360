-- CreateTable
CREATE TABLE "DeliveryRuntimeModeSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "configuredRuntimeMode" TEXT NOT NULL DEFAULT 'simulate',
    "liveCanaryEnabledUntil" TIMESTAMP(3),
    "enabledBy" TEXT,
    "enabledAt" TIMESTAMP(3),
    "reason" TEXT,
    "lastChangedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRuntimeModeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRuntimeModeAuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "previousMode" TEXT,
    "newMode" TEXT,
    "effectiveMode" TEXT,
    "maxAllowedMode" TEXT,
    "reason" TEXT,
    "enabledBy" TEXT,
    "liveCanaryEnabledUntil" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryRuntimeModeAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryRuntimeModeAuditEvent_eventType_createdAt_idx" ON "DeliveryRuntimeModeAuditEvent"("eventType", "createdAt");

-- Seed default row
INSERT INTO "DeliveryRuntimeModeSetting" ("id", "configuredRuntimeMode", "lastChangedAt", "createdAt")
VALUES ('default', 'simulate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
