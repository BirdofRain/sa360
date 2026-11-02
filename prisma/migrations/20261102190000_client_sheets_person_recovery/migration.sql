-- Sheets person recovery: history coverage, dead-reservation audit, assessment class.
-- Additive. Does not import history, replay jobs, or enable delivery.

ALTER TABLE "DuplicateRiskAssessmentFailure"
    ADD COLUMN "failureClass" TEXT NOT NULL DEFAULT 'review',
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "ClientSheetsHistoryCoverage" (
    "clientAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "completenessProof" TEXT NOT NULL,
    "cursorCreatedAt" TIMESTAMP(3),
    "cursorJobId" TEXT,
    "indexedCount" INTEGER NOT NULL DEFAULT 0,
    "observedJobCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSheetsHistoryCoverage_pkey" PRIMARY KEY ("clientAccountId")
);

CREATE TABLE "ClientSheetsPersonRelease" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceLeadEventId" TEXT,
    "admissionId" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT,
    "evidenceJson" JSONB,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientSheetsPersonRelease_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientSheetsPersonRelease_client_value_idx"
    ON "ClientSheetsPersonRelease"("clientAccountId", "normalizedValue");

CREATE INDEX "ClientSheetsPersonRelease_event_idx"
    ON "ClientSheetsPersonRelease"("sourceLeadEventId");
