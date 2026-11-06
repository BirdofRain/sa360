-- Additive custom-webhook destination and successful-delivery notification primitives.
-- New empty tables + enums only. Does not alter CompanySheetsDeliveryJob,
-- GhlLiveDeliveryRun, SourceLeadEvent, MetaPageCaptureGrant, ClientOnboardingSetup,
-- LeadDeliveryExportPackage, or DeliveryTarget.enabled.
-- Does not backfill an enabled webhook.generic.v1 row and does not send anything.
--
-- The signing secret is stored only as AES-256-GCM ciphertext. There is no
-- plaintext secret column. ClientCustomWebhookDestination.enabled defaults to false.
-- DeliverySuccessNotificationCursor is inserted unarmed (armedAt null) so the
-- first enabled scan cannot treat older receipts as eligible.

CREATE TYPE "DeliverySuccessChannel" AS ENUM (
  'company_sheets',
  'ghl_location_api',
  'custom_webhook'
);

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

-- SetNull: dropping the optional target removes the pointer only. It does not
-- delete the secret row and it does not send a webhook.
ALTER TABLE "ClientCustomWebhookDestination"
  ADD CONSTRAINT "ClientCustomWebhookDestination_deliveryTargetId_fkey"
  FOREIGN KEY ("deliveryTargetId") REFERENCES "DeliveryTarget"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DeliverySuccessNotification" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "channel" "DeliverySuccessChannel" NOT NULL,
    "receiptId" TEXT NOT NULL,
    "sourceLeadEventId" TEXT,
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

CREATE INDEX "DeliverySuccessNotification_status_claimedAt_idx"
  ON "DeliverySuccessNotification"("status", "claimedAt");

CREATE INDEX "DeliverySuccessNotification_clientAccountId_createdAt_idx"
  ON "DeliverySuccessNotification"("clientAccountId", "createdAt");

-- Restrict: deleting a client must not erase the exactly-once send record.
ALTER TABLE "DeliverySuccessNotification"
  ADD CONSTRAINT "DeliverySuccessNotification_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DeliverySuccessNotificationCursor" (
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "armedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySuccessNotificationCursor_pkey" PRIMARY KEY ("singleton")
);

ALTER TABLE "DeliverySuccessNotificationCursor"
  ADD CONSTRAINT "DeliverySuccessNotificationCursor_singleton_true"
  CHECK ("singleton");

INSERT INTO "DeliverySuccessNotificationCursor" (
  "singleton",
  "armedAt",
  "createdAt",
  "updatedAt"
) VALUES (
  true,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Runtime grants. There is no ALTER DEFAULT PRIVILEGES grant to sa360_app.
-- A table created by the migrate login is not visible to sa360_app until granted.
-- The migrate login remains the table owner. This block does not SET ROLE,
-- create a role, issue a password, or change default privileges.
-- Loopback databases can migrate before sa360_app exists. This block then
-- grants nothing. A non-loopback session without sa360_app fails.

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
      public."DeliverySuccessNotification",
      public."DeliverySuccessNotificationCursor"
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
