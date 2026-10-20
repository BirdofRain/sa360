-- Tab contracts for one company spreadsheet per client.
--
-- Additive only. Does not alter LeadOrder, LeadAllocation, LeadDeliveryExportPackage,
-- spreadsheetDeliveredAt, DeliveryTarget, inventory, billing, or intake tables.
-- Does not drop CompanyGoogleConnection_googleUserId_active_key or
-- DeliveryTarget_clientAccount_googleSheets_key.

ALTER TABLE "CompanySheetsDestination"
  ADD COLUMN "destinationRevision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "CompanySheetsDeliveryJob"
  ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "destinationRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "appendStartedAt" TIMESTAMP(3);

CREATE TABLE "CompanySheetsTabContract" (
    "id" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "setupState" TEXT NOT NULL DEFAULT 'missing',
    "setupReason" TEXT,
    "worksheetId" INTEGER,
    "worksheetTitle" TEXT,
    "schemaVersion" TEXT,
    "headerContract" JSONB,
    "inspectedAt" TIMESTAMP(3),
    "boundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySheetsTabContract_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySheetsTab_destination_role_key"
  ON "CompanySheetsTabContract"("destinationId", "role");

CREATE INDEX "CompanySheetsTab_destination_state_idx"
  ON "CompanySheetsTabContract"("destinationId", "setupState");

ALTER TABLE "CompanySheetsTabContract"
  ADD CONSTRAINT "CompanySheetsTabContract_destinationId_fkey"
  FOREIGN KEY ("destinationId") REFERENCES "CompanySheetsDestination"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
