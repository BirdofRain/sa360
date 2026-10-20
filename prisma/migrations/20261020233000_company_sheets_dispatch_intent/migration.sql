-- Durable company Sheets dispatch intents.
--
-- Additive only. Does not alter LeadOrder, LeadAllocation, LeadDeliveryExportPackage,
-- spreadsheetDeliveredAt, DeliveryTarget, inventory, billing, or intake tables.
-- Does not drop CompanyGoogleConnection_googleUserId_active_key or
-- DeliveryTarget_clientAccount_googleSheets_key.

ALTER TABLE "CompanySheetsDestination"
  ADD COLUMN "campaignDispatchEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "campaignDispatchNotBefore" TIMESTAMP(3),
  ADD COLUMN "agedDispatchEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "agedDispatchNotBefore" TIMESTAMP(3);

CREATE TABLE "CompanySheetsDispatchIntent" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "sourceLeadEventId" TEXT,
    "exportPackageId" TEXT,
    "leadOrderId" TEXT,
    "jobId" TEXT,
    "reason" TEXT,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "actor" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySheetsDispatchIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySheetsDispatchIntent_idempotencyKey_key"
  ON "CompanySheetsDispatchIntent"("idempotencyKey");

CREATE INDEX "CompanySheetsDispatch_status_available_idx"
  ON "CompanySheetsDispatchIntent"("status", "availableAt");

CREATE INDEX "CompanySheetsDispatch_client_kind_idx"
  ON "CompanySheetsDispatchIntent"("clientAccountId", "kind");

CREATE INDEX "CompanySheetsDispatch_export_idx"
  ON "CompanySheetsDispatchIntent"("exportPackageId");

CREATE INDEX "CompanySheetsDispatch_lead_idx"
  ON "CompanySheetsDispatchIntent"("sourceLeadEventId");
