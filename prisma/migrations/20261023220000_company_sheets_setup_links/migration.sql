-- Additive setup records for client folder links and spreadsheet destination history.
-- Empty tables. No backfill. Existing destinations and Drive folders are unchanged.

CREATE TABLE "CompanySheetsClientFolder" (
    "clientAccountId" TEXT NOT NULL,
    "folderId" TEXT,
    "folderTitle" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'creating',
    "operationToken" TEXT,
    "linkedAt" TIMESTAMP(3),
    "unlinkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySheetsClientFolder_pkey" PRIMARY KEY ("clientAccountId")
);

CREATE TABLE "CompanySheetsFolderEvent" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "folderTitle" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanySheetsFolderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanySheetsSpreadsheetLink" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetTitle" TEXT,
    "spreadsheetUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "CompanySheetsSpreadsheetLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanySheetsClientFolder_folderId_idx" ON "CompanySheetsClientFolder"("folderId");

CREATE INDEX "CompanySheetsClientFolder_status_updatedAt_idx" ON "CompanySheetsClientFolder"("status", "updatedAt");

CREATE INDEX "CompanySheetsFolderEvent_clientAccountId_createdAt_idx" ON "CompanySheetsFolderEvent"("clientAccountId", "createdAt");

CREATE INDEX "CompanySheetsSpreadsheetLink_clientAccountId_recordedAt_idx" ON "CompanySheetsSpreadsheetLink"("clientAccountId", "recordedAt");

CREATE INDEX "CompanySheetsSpreadsheetLink_spreadsheetId_idx" ON "CompanySheetsSpreadsheetLink"("spreadsheetId");

ALTER TABLE "CompanySheetsClientFolder" ADD CONSTRAINT "CompanySheetsClientFolder_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanySheetsFolderEvent" ADD CONSTRAINT "CompanySheetsFolderEvent_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanySheetsSpreadsheetLink" ADD CONSTRAINT "CompanySheetsSpreadsheetLink_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;
