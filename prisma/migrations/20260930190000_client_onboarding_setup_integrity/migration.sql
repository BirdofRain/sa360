-- Retain onboarding audit history independently from the mutable setup document,
-- and add the metadata required for idempotent, optimistic-concurrency-safe saves.
ALTER TABLE "ClientOnboardingSetup"
    ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ClientOnboardingSetupAuditEvent"
    ADD COLUMN "historicalClientAccountId" TEXT,
    ADD COLUMN "requestIntent" TEXT,
    ADD COLUMN "requestPayloadHash" TEXT,
    ADD COLUMN "requestExpectedRevision" INTEGER,
    ADD COLUMN "resultJson" JSONB;

UPDATE "ClientOnboardingSetupAuditEvent"
SET
    "historicalClientAccountId" = "clientAccountId",
    "requestIntent" = "action";

ALTER TABLE "ClientOnboardingSetupAuditEvent"
    ALTER COLUMN "historicalClientAccountId" SET NOT NULL,
    ALTER COLUMN "setupId" DROP NOT NULL;

ALTER TABLE "ClientOnboardingSetupAuditEvent"
    DROP CONSTRAINT "ClientOnboardingSetupAuditEvent_setupId_fkey";

ALTER TABLE "ClientOnboardingSetupAuditEvent"
    ADD CONSTRAINT "ClientOnboardingSetupAuditEvent_setupId_fkey"
    FOREIGN KEY ("setupId") REFERENCES "ClientOnboardingSetup"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ClientOnboardingSetupAuditEvent_historicalClientAccountId_createdAt_idx"
    ON "ClientOnboardingSetupAuditEvent"("historicalClientAccountId", "createdAt");
