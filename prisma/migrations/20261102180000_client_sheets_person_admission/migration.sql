-- Client-scoped Sheets person admission.
--
-- Additive only. Does not alter InboundContactIndex, GHL outbox, LeadOrder,
-- LeadAllocation, LeadDeliveryExportPackage, spreadsheetDeliveredAt, tab
-- contracts, or CompanySheetsDeliveryJob. A tab change does not touch these rows.

CREATE TABLE "DuplicateRiskAssessmentFailure" (
    "routingDryRunDecisionId" TEXT NOT NULL,
    "errorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateRiskAssessmentFailure_pkey" PRIMARY KEY ("routingDryRunDecisionId")
);

CREATE TABLE "ClientSheetsPersonAdmission" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceLeadEventId" TEXT,
    "historicalImportKey" TEXT,
    "status" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSheetsPersonAdmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientSheetsPersonAdmission_client_identifier_key"
    ON "ClientSheetsPersonAdmission"("clientAccountId", "kind", "normalizedValue");

CREATE INDEX "ClientSheetsPersonAdmission_client_event_idx"
    ON "ClientSheetsPersonAdmission"("clientAccountId", "sourceLeadEventId");

CREATE INDEX "ClientSheetsPersonAdmission_import_key_idx"
    ON "ClientSheetsPersonAdmission"("historicalImportKey");

CREATE TABLE "ClientSheetsDedupeDecision" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "sourceLeadEventId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'sheets',
    "outcome" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "normalizedPhone" TEXT,
    "normalizedEmail" TEXT,
    "assessmentState" TEXT NOT NULL,
    "priorEvidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSheetsDedupeDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientSheetsDedupeDecision_idempotencyKey_key"
    ON "ClientSheetsDedupeDecision"("idempotencyKey");

CREATE INDEX "ClientSheetsDedupeDecision_client_outcome_idx"
    ON "ClientSheetsDedupeDecision"("clientAccountId", "outcome");

CREATE INDEX "ClientSheetsDedupeDecision_event_idx"
    ON "ClientSheetsDedupeDecision"("sourceLeadEventId");
