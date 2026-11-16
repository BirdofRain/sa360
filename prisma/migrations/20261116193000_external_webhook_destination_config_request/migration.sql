-- Idempotency rows for admin external-webhook destination writes.
--
-- Empty table only. No destination is inserted or enabled. No attempt, Sheets
-- row, GHL run, or notification receipt is written. The delivery flag is not set.
-- Timestamp follows 20261116183000_external_webhook_attempt_send_count and the
-- merged notification-receipt migration 20261113223000.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE "ExternalWebhookDestinationConfigRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalWebhookDestinationConfigRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalWebhookDestinationConfigRequest_requestId_key"
  ON "ExternalWebhookDestinationConfigRequest"("requestId");

CREATE INDEX "ExternalWebhookDestinationConfigRequest_clientAccountId_createdAt_idx"
  ON "ExternalWebhookDestinationConfigRequest"("clientAccountId", "createdAt");

ALTER TABLE "ExternalWebhookDestinationConfigRequest"
  ADD CONSTRAINT "ExternalWebhookDestinationConfigRequest_action_chk"
  CHECK ("action" IN ('save', 'activation'));

ALTER TABLE "ExternalWebhookDestinationConfigRequest"
  ADD CONSTRAINT "ExternalWebhookDestinationConfigRequest_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."ExternalWebhookDestinationConfigRequest"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'external webhook config grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'external webhook config grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
