-- Administrative setup state only. This migration does not backfill existing
-- clients and does not alter intake, routing, or delivery configuration.
CREATE TYPE "ClientSetupStatus" AS ENUM (
    'draft',
    'submitted',
    'needs_information',
    'setup_reviewed'
);

CREATE TABLE "ClientOnboardingSetup" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "status" "ClientSetupStatus" NOT NULL DEFAULT 'draft',
    "setupDataJson" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingSetup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientOnboardingSetupAuditEvent" (
    "id" TEXT NOT NULL,
    "setupId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "changesJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOnboardingSetupAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientOnboardingSetup_clientAccountId_key"
    ON "ClientOnboardingSetup"("clientAccountId");
CREATE INDEX "ClientOnboardingSetup_status_updatedAt_idx"
    ON "ClientOnboardingSetup"("status", "updatedAt");
CREATE UNIQUE INDEX "ClientOnboardingSetupAuditEvent_requestId_key"
    ON "ClientOnboardingSetupAuditEvent"("requestId");
CREATE INDEX "ClientOnboardingSetupAuditEvent_clientAccountId_createdAt_idx"
    ON "ClientOnboardingSetupAuditEvent"("clientAccountId", "createdAt");
CREATE INDEX "ClientOnboardingSetupAuditEvent_setupId_createdAt_idx"
    ON "ClientOnboardingSetupAuditEvent"("setupId", "createdAt");

ALTER TABLE "ClientOnboardingSetup"
    ADD CONSTRAINT "ClientOnboardingSetup_clientAccountId_fkey"
    FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientOnboardingSetupAuditEvent"
    ADD CONSTRAINT "ClientOnboardingSetupAuditEvent_setupId_fkey"
    FOREIGN KEY ("setupId") REFERENCES "ClientOnboardingSetup"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
