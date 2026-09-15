-- Additive Google account OAuth persistence foundation (Phase 1A).
-- New empty tables + enum only. No rewrites of existing rows.
-- Does not touch: ClientAccount data, GHL credential tables, DeliveryTarget,
-- LeadInventoryItem, SourceLeadEvent, or legacy backupSheet* columns.
--
-- SQL behavior:
--   CREATE TYPE  GoogleAccountConnectionStatus  — catalog lock only
--   CREATE TABLE GoogleAccountConnection       — empty
--   CREATE TABLE GoogleOAuthPendingAuth       — empty
--   UNIQUE (clientAccountId)                   — one row per tenant
--   Partial UNIQUE (googleUserId) WHERE status IN (connected, reconnect_required, error)
--     AND googleUserId IS NOT NULL
--     — same Google identity cannot be an active connection on two tenants
--   FK ON DELETE CASCADE to ClientAccount
--
-- Tokens are stored only as AES-256-GCM ciphertext columns (nullable so disconnect
-- can wipe them). No plaintext token columns.

CREATE TYPE "GoogleAccountConnectionStatus" AS ENUM (
  'connected',
  'reconnect_required',
  'disconnected',
  'error'
);

CREATE TABLE "GoogleAccountConnection" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "googleUserId" TEXT,
    "googleEmail" TEXT,
    "googleDisplayName" TEXT,
    "status" "GoogleAccountConnectionStatus" NOT NULL DEFAULT 'connected',
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAccountConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAccountConnection_clientAccountId_key"
  ON "GoogleAccountConnection"("clientAccountId");

CREATE INDEX "GoogleAccountConnection_status_updatedAt_idx"
  ON "GoogleAccountConnection"("status", "updatedAt");

CREATE INDEX "GoogleAccountConnection_googleUserId_idx"
  ON "GoogleAccountConnection"("googleUserId");

-- Active Google identities cannot span ClientAccounts. Disconnected rows keep
-- googleUserId for audit and are excluded so another tenant may connect later.
CREATE UNIQUE INDEX "GoogleAccountConnection_googleUserId_active_key"
  ON "GoogleAccountConnection"("googleUserId")
  WHERE "googleUserId" IS NOT NULL
    AND "status" IN ('connected', 'reconnect_required', 'error');

ALTER TABLE "GoogleAccountConnection"
  ADD CONSTRAINT "GoogleAccountConnection_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GoogleOAuthPendingAuth" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "pkceVerifierEncrypted" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleOAuthPendingAuth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleOAuthPendingAuth_stateHash_key"
  ON "GoogleOAuthPendingAuth"("stateHash");

CREATE INDEX "GoogleOAuthPendingAuth_clientAccountId_expiresAt_idx"
  ON "GoogleOAuthPendingAuth"("clientAccountId", "expiresAt");

CREATE INDEX "GoogleOAuthPendingAuth_consumedAt_expiresAt_idx"
  ON "GoogleOAuthPendingAuth"("consumedAt", "expiresAt");

ALTER TABLE "GoogleOAuthPendingAuth"
  ADD CONSTRAINT "GoogleOAuthPendingAuth_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;
