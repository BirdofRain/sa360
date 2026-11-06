-- Additive custom-webhook destination, per-client notification preference,
-- and one delivery-success notification per client and source lead.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. prisma migrate deploy (Prisma 6.19, sa360-migrate) sends the file
-- through simple_query and does not wrap it. SET LOCAL lock_timeout applies
-- only inside this transaction. PostgreSQL rolls every object in the file back
-- if a statement fails before COMMIT. Prisma can still record that failed
-- attempt in _prisma_migrations from a later transaction; recovery is
-- prisma migrate resolve --rolled-back followed by another deploy. This file
-- does not authorize that recovery in production.
--
-- Empty tables only. No preference is inserted enabled. No notification rows
-- are inserted. There is no global cursor. No Sheets job, GHL run, source
-- lead, Meta grant, onboarding setup, or export package is altered.
-- DeliveryTarget.enabled is not backfilled.
--
-- Merging this file into master makes sa360-migrate apply it on the next API
-- predeploy. The notify flag stays unset. This change does not send mail.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "ClientDeliveryNotificationChannel" AS ENUM ('email');

CREATE TYPE "DeliverySuccessNotificationStatus" AS ENUM (
  'pending',
  'sending',
  'sent',
  'skipped',
  'failed'
);

CREATE TABLE "ClientCustomWebhookDestination" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "deliveryTargetId" TEXT,
    "endpointUrl" TEXT NOT NULL,
    "signingSecretCiphertext" TEXT NOT NULL,
    "signingSecretFingerprint" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCustomWebhookDestination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientCustomWebhookDestination_clientAccountId_key"
  ON "ClientCustomWebhookDestination"("clientAccountId");

CREATE UNIQUE INDEX "ClientCustomWebhookDestination_deliveryTargetId_key"
  ON "ClientCustomWebhookDestination"("deliveryTargetId");

ALTER TABLE "ClientCustomWebhookDestination"
  ADD CONSTRAINT "ClientCustomWebhookDestination_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull: dropping the optional target removes the pointer only.
-- It does not delete the secret row and it does not send a webhook.
ALTER TABLE "ClientCustomWebhookDestination"
  ADD CONSTRAINT "ClientCustomWebhookDestination_deliveryTargetId_fkey"
  FOREIGN KEY ("deliveryTargetId") REFERENCES "DeliveryTarget"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ClientDeliveryNotificationPreference" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channel" "ClientDeliveryNotificationChannel" NOT NULL DEFAULT 'email',
    "recipientEmail" TEXT,
    "recipientEmailVerifiedAt" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDeliveryNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientDeliveryNotificationPreference_clientAccountId_key"
  ON "ClientDeliveryNotificationPreference"("clientAccountId");

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD CONSTRAINT "ClientDeliveryNotificationPreference_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD CONSTRAINT "ClientDeliveryNotifyPref_recipient_lowercase_chk"
  CHECK (
    "recipientEmail" IS NULL
    OR "recipientEmail" = lower(btrim("recipientEmail"))
  );

-- enabled cannot be stored without a verified email recipient and an activation time.
ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD CONSTRAINT "ClientDeliveryNotifyPref_enabled_verified_chk"
  CHECK (
    "enabled" = false
    OR (
      "recipientEmail" IS NOT NULL
      AND btrim("recipientEmail") <> ''
      AND "recipientEmailVerifiedAt" IS NOT NULL
      AND "enabledAt" IS NOT NULL
      AND "channel" = 'email'
    )
  );

CREATE TABLE "DeliverySuccessNotification" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "sheetsJobId" TEXT,
    "ghlLiveRunId" TEXT,
    "customWebhookAttemptId" TEXT,
    "status" "DeliverySuccessNotificationStatus" NOT NULL DEFAULT 'pending',
    "claimedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySuccessNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliverySuccessNotification_idempotencyKey_key"
  ON "DeliverySuccessNotification"("idempotencyKey");

CREATE UNIQUE INDEX "DeliverySuccessNotification_client_lead_key"
  ON "DeliverySuccessNotification"("clientAccountId", "sourceLeadEventId");

CREATE INDEX "DeliverySuccessNotification_status_claimedAt_idx"
  ON "DeliverySuccessNotification"("status", "claimedAt");

ALTER TABLE "DeliverySuccessNotification"
  ADD CONSTRAINT "DeliverySuccessNotification_idempotency_matches_lead"
  CHECK (
    "idempotencyKey" = 'client_lead:' || "clientAccountId" || ':' || "sourceLeadEventId"
  );

-- Restrict: deleting a client must not erase the exactly-once send record.
ALTER TABLE "DeliverySuccessNotification"
  ADD CONSTRAINT "DeliverySuccessNotification_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Runtime grants. There is no ALTER DEFAULT PRIVILEGES grant to sa360_app.
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
      public."ClientCustomWebhookDestination",
      public."ClientDeliveryNotificationPreference",
      public."DeliverySuccessNotification"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'delivery notification grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'delivery notification grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
