-- Company-managed Google Sheets foundation.
--
-- Additive empty tables only. Does not alter ClientAccount data, GoogleAccountConnection,
-- DeliveryTarget, LeadOrder, LeadAllocation, LeadDeliveryExportPackage, inventory,
-- billing, or intake rows.
--
-- CompanyGoogleConnection is the Life Agent Launch Google account (not a client OAuth row).
-- Tokens are AES-256-GCM ciphertext columns only.
--
-- Partial UNIQUE (googleUserId) WHERE status IN (connected, reconnect_required, error)
-- AND googleUserId IS NOT NULL. Prisma 6 cannot model this as @@unique. Do not DROP
-- this index in a later generated migrate diff.
--
-- CompanySheetsDestination is configuration only:
--   one destination per clientAccountId
--   one client per spreadsheetId
--   enabled defaults false
--   writeReadiness defaults not_verified
--   deliveryExecution defaults disabled

CREATE TABLE "CompanyGoogleConnection" (
    "id" TEXT NOT NULL,
    "connectionKey" TEXT NOT NULL DEFAULT 'life_agent_launch',
    "googleUserId" TEXT,
    "googleEmail" TEXT,
    "googleDisplayName" TEXT,
    "status" "GoogleAccountConnectionStatus" NOT NULL DEFAULT 'disconnected',
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" JSONB,
    "tokenType" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "connectedAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "reconnectRequiredAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "destinationFolderId" TEXT,
    "destinationFolderTitle" TEXT,
    "destinationFolderVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyGoogleConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyGoogleConnection_connectionKey_key"
  ON "CompanyGoogleConnection"("connectionKey");

CREATE INDEX "CompanyGoogleConnection_status_updatedAt_idx"
  ON "CompanyGoogleConnection"("status", "updatedAt");

CREATE INDEX "CompanyGoogleConnection_googleUserId_idx"
  ON "CompanyGoogleConnection"("googleUserId");

CREATE UNIQUE INDEX "CompanyGoogleConnection_googleUserId_active_key"
  ON "CompanyGoogleConnection"("googleUserId")
  WHERE "googleUserId" IS NOT NULL
    AND "status" IN ('connected', 'reconnect_required', 'error');

CREATE TABLE "CompanyGoogleOAuthPendingAuth" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "pkceVerifierEncrypted" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "initiatedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyGoogleOAuthPendingAuth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyGoogleOAuthPendingAuth_stateHash_key"
  ON "CompanyGoogleOAuthPendingAuth"("stateHash");

CREATE INDEX "CompanyGoogleOAuthPendingAuth_consumedAt_expiresAt_idx"
  ON "CompanyGoogleOAuthPendingAuth"("consumedAt", "expiresAt");

CREATE TABLE "CompanySpreadsheetCreation" (
    "id" TEXT NOT NULL,
    "companyConnectionId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetTitle" TEXT NOT NULL,
    "spreadsheetUrl" TEXT NOT NULL,
    "worksheetId" INTEGER NOT NULL,
    "worksheetTitle" TEXT NOT NULL,
    "folderId" TEXT,
    "folderPlacement" TEXT NOT NULL,
    "createdByActor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanySpreadsheetCreation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySpreadsheetCreation_spreadsheetId_key"
  ON "CompanySpreadsheetCreation"("spreadsheetId");

CREATE INDEX "CompanySpreadsheetCreation_companyConnectionId_createdAt_idx"
  ON "CompanySpreadsheetCreation"("companyConnectionId", "createdAt");

CREATE TABLE "CompanySheetsDestination" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "companyConnectionId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "spreadsheetTitle" TEXT,
    "spreadsheetUrl" TEXT NOT NULL,
    "worksheetId" INTEGER NOT NULL,
    "worksheetTitle" TEXT NOT NULL,
    "controlBasis" TEXT NOT NULL,
    "companySpreadsheetCreationId" TEXT,
    "accessStatus" TEXT NOT NULL DEFAULT 'not_checked',
    "accessCheckedAt" TIMESTAMP(3),
    "writeReadiness" TEXT NOT NULL DEFAULT 'not_verified',
    "deliveryExecution" TEXT NOT NULL DEFAULT 'disabled',
    "sharingStatus" TEXT NOT NULL,
    "intendedRecipientEmail" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdByActor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySheetsDestination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySheetsDestination_clientAccountId_key"
  ON "CompanySheetsDestination"("clientAccountId");

CREATE UNIQUE INDEX "CompanySheetsDestination_spreadsheetId_key"
  ON "CompanySheetsDestination"("spreadsheetId");

CREATE UNIQUE INDEX "CompanySheetsDestination_companySpreadsheetCreationId_key"
  ON "CompanySheetsDestination"("companySpreadsheetCreationId");

CREATE INDEX "CompanySheetsDestination_companyConnectionId_idx"
  ON "CompanySheetsDestination"("companyConnectionId");

CREATE INDEX "CompanySheetsDestination_accessStatus_idx"
  ON "CompanySheetsDestination"("accessStatus");

ALTER TABLE "CompanySpreadsheetCreation"
  ADD CONSTRAINT "CompanySpreadsheetCreation_companyConnectionId_fkey"
  FOREIGN KEY ("companyConnectionId") REFERENCES "CompanyGoogleConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanySheetsDestination"
  ADD CONSTRAINT "CompanySheetsDestination_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanySheetsDestination"
  ADD CONSTRAINT "CompanySheetsDestination_companyConnectionId_fkey"
  FOREIGN KEY ("companyConnectionId") REFERENCES "CompanyGoogleConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanySheetsDestination"
  ADD CONSTRAINT "CompanySheetsDestination_companySpreadsheetCreationId_fkey"
  FOREIGN KEY ("companySpreadsheetCreationId") REFERENCES "CompanySpreadsheetCreation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
