-- Idempotency rows for the Admin C.O.C. notification recipient and on/off writes.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. prisma migrate deploy (Prisma 6.19, sa360-migrate) sends the file
-- through simple_query and does not wrap it. SET LOCAL lock_timeout applies
-- only inside this transaction.
--
-- Empty table only. No preference is updated. No notification row is inserted.
-- No Sheets job, GHL run, routing row, or delivery flag is altered.
-- Merging this file into master makes sa360-migrate apply it on the next API
-- predeploy. This change does not send mail and does not enable a flag.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE "ClientDeliveryNotificationConfigRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDeliveryNotificationConfigRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientDeliveryNotificationConfigRequest_requestId_key"
  ON "ClientDeliveryNotificationConfigRequest"("requestId");

CREATE INDEX "ClientDeliveryNotificationConfigRequest_clientAccountId_createdAt_idx"
  ON "ClientDeliveryNotificationConfigRequest"("clientAccountId", "createdAt");

ALTER TABLE "ClientDeliveryNotificationConfigRequest"
  ADD CONSTRAINT "ClientDeliveryNotificationConfigRequest_action_chk"
  CHECK ("action" IN ('recipient', 'preference'));

ALTER TABLE "ClientDeliveryNotificationConfigRequest"
  ADD CONSTRAINT "ClientDeliveryNotificationConfigRequest_result_object_chk"
  CHECK (jsonb_typeof("resultJson") = 'object');

-- Cascade: these rows are the write receipt for configuration, not send history.
ALTER TABLE "ClientDeliveryNotificationConfigRequest"
  ADD CONSTRAINT "ClientDeliveryNotificationConfigRequest_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Runtime grant for the new table only. There is no ALTER DEFAULT PRIVILEGES.
-- The migrate login remains the table owner. This block does not SET ROLE,
-- create a role, issue a password, or change default privileges.
-- Loopback databases can migrate before sa360_app exists. This block then
-- grants nothing. A non-loopback session without sa360_app fails and rolls back.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."ClientDeliveryNotificationConfigRequest"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'notification config request grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'notification config request grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
