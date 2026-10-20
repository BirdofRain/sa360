-- Durable company Sheets delivery jobs.
--
-- Additive only. Does not alter LeadOrder, LeadAllocation, LeadDeliveryExportPackage,
-- spreadsheetDeliveredAt, DeliveryTarget, inventory, billing, or intake tables.
-- Does not drop CompanyGoogleConnection_googleUserId_active_key or
-- DeliveryTarget_clientAccount_googleSheets_key.

ALTER TABLE "CompanySheetsDestination"
  ADD COLUMN "canaryApproved" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CompanySheetsDeliveryJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "companyConnectionId" TEXT NOT NULL,
    "destinationId" TEXT,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL,
    "worksheetId" INTEGER NOT NULL,
    "worksheetTitle" TEXT NOT NULL,
    "controlBasis" TEXT NOT NULL,
    "destinationUpdatedAt" TIMESTAMP(3) NOT NULL,
    "headerContract" JSONB NOT NULL,
    "sourceLeadEventId" TEXT,
    "leadOrderId" TEXT,
    "exportPackageId" TEXT,
    "contentSha256" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "uncertainReason" TEXT,
    "claimToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CompanySheetsDeliveryJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySheetsDeliveryJob_idempotencyKey_key"
  ON "CompanySheetsDeliveryJob"("idempotencyKey");

CREATE INDEX "CompanySheetsDeliveryJob_status_updatedAt_idx"
  ON "CompanySheetsDeliveryJob"("status", "updatedAt");

CREATE INDEX "CompanySheetsDeliveryJob_clientAccountId_createdAt_idx"
  ON "CompanySheetsDeliveryJob"("clientAccountId", "createdAt");

CREATE INDEX "CompanySheetsDeliveryJob_spreadsheetId_worksheetId_status_idx"
  ON "CompanySheetsDeliveryJob"("spreadsheetId", "worksheetId", "status");

CREATE INDEX "CompanySheetsDeliveryJob_leadOrderId_idx"
  ON "CompanySheetsDeliveryJob"("leadOrderId");

CREATE INDEX "CompanySheetsDeliveryJob_exportPackageId_idx"
  ON "CompanySheetsDeliveryJob"("exportPackageId");

CREATE TABLE "CompanySheetsDeliveryRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "worksheetId" INTEGER NOT NULL,
    "stableRowId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "valuesJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySheetsDeliveryRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySheetsDeliveryRow_jobId_ordinal_key"
  ON "CompanySheetsDeliveryRow"("jobId", "ordinal");

CREATE UNIQUE INDEX "CompanySheetsRow_sheet_stable_key"
  ON "CompanySheetsDeliveryRow"("spreadsheetId", "worksheetId", "stableRowId");

CREATE INDEX "CompanySheetsDeliveryRow_jobId_status_idx"
  ON "CompanySheetsDeliveryRow"("jobId", "status");

CREATE TABLE "CompanySheetsWorksheetLock" (
    "spreadsheetId" TEXT NOT NULL,
    "worksheetId" INTEGER NOT NULL,
    "ownerJobId" TEXT,
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "CompanySheetsWorksheetLock_pkey" PRIMARY KEY ("spreadsheetId", "worksheetId")
);

CREATE TABLE "CompanySheetsOrderDeliveryEvidence" (
    "id" TEXT NOT NULL,
    "leadOrderId" TEXT NOT NULL,
    "exportPackageId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL,
    "worksheetId" INTEGER NOT NULL,
    "worksheetTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySheetsOrderDeliveryEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySheetsOrderDeliveryEvidence_exportPackageId_key"
  ON "CompanySheetsOrderDeliveryEvidence"("exportPackageId");

CREATE UNIQUE INDEX "CompanySheetsOrderDeliveryEvidence_jobId_key"
  ON "CompanySheetsOrderDeliveryEvidence"("jobId");

CREATE INDEX "CompanySheetsEvidence_order_client_idx"
  ON "CompanySheetsOrderDeliveryEvidence"("leadOrderId", "clientAccountId");

ALTER TABLE "CompanySheetsDeliveryJob"
  ADD CONSTRAINT "CompanySheetsDeliveryJob_destinationId_fkey"
  FOREIGN KEY ("destinationId") REFERENCES "CompanySheetsDestination"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanySheetsDeliveryRow"
  ADD CONSTRAINT "CompanySheetsDeliveryRow_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "CompanySheetsDeliveryJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanySheetsOrderDeliveryEvidence"
  ADD CONSTRAINT "CompanySheetsOrderDeliveryEvidence_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "CompanySheetsDeliveryJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
