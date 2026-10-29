-- Schedule association GHL delivery with intake.
-- Additive. Does not change Sheets intents, client destinations, or live runs.
-- An executing attempt is not given a second send by this table.

CREATE TABLE "GhlAssociationDispatchOutbox" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "routingDryRunDecisionId" TEXT,
    "destinationLocationIdGhl" TEXT NOT NULL,
    "liveRunId" TEXT,
    "outcome" TEXT,
    "externalCallExecuted" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "executingAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlAssociationDispatchOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GhlAssociationDispatchOutbox_idempotencyKey_key"
  ON "GhlAssociationDispatchOutbox"("idempotencyKey");

CREATE INDEX "GhlAssociationDispatch_status_available_idx"
  ON "GhlAssociationDispatchOutbox"("status", "availableAt");

CREATE INDEX "GhlAssociationDispatch_lead_idx"
  ON "GhlAssociationDispatchOutbox"("sourceLeadEventId");

-- Privileges for the runtime role when it already exists.
-- Loopback databases can migrate before that role exists. This block then
-- grants nothing. It does not issue a password, create a role, or enable delivery.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."GhlAssociationDispatchOutbox" TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'ghl association dispatch grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'ghl association dispatch grants refused: sa360_app is absent';
END
$grant$;
