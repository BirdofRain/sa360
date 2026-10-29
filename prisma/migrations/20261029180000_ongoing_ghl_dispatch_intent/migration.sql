-- Durable ongoing GHL dispatch intents, recorded with intake.
--
-- Additive only. Does not alter Sheets intents, lead rows, routing decisions,
-- or existing delivery runs. New columns on ClientGhlDestination are nullable
-- and default to off, so existing destinations stay inactive.

ALTER TABLE "ClientGhlDestination"
  ADD COLUMN "ongoingDeliveryNotBefore" TIMESTAMP(3),
  ADD COLUMN "activationLocationIdGhl" TEXT,
  ADD COLUMN "activationWorkflowIdGhl" TEXT,
  ADD COLUMN "activationPipelineIdGhl" TEXT,
  ADD COLUMN "activationStageIdGhl" TEXT;

CREATE TABLE "OngoingGhlDispatchIntent" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "routingDryRunDecisionId" TEXT,
    "destinationLocationIdGhl" TEXT NOT NULL,
    "activationLocationIdGhl" TEXT NOT NULL,
    "activationWorkflowIdGhl" TEXT,
    "activationPipelineIdGhl" TEXT,
    "activationStageIdGhl" TEXT,
    "leadDeliveryPlanId" TEXT,
    "liveRunId" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "outcomeClass" TEXT,
    "processingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OngoingGhlDispatchIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OngoingGhlDispatchIntent_idempotencyKey_key"
  ON "OngoingGhlDispatchIntent"("idempotencyKey");

CREATE INDEX "OngoingGhlDispatch_status_available_idx"
  ON "OngoingGhlDispatchIntent"("status", "availableAt");

CREATE INDEX "OngoingGhlDispatch_lead_idx"
  ON "OngoingGhlDispatchIntent"("sourceLeadEventId");

CREATE INDEX "OngoingGhlDispatch_client_created_idx"
  ON "OngoingGhlDispatchIntent"("clientAccountId", "createdAt");

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
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."OngoingGhlDispatchIntent" TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'ongoing ghl dispatch grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'ongoing ghl dispatch grants refused: sa360_app is absent';
END
$grant$;
