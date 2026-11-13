-- Additive external-webhook destination, frozen delivery receipt, and unused
-- SMS preference columns.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. prisma migrate deploy (Prisma 6.19, sa360-migrate) sends the file
-- through simple_query and does not wrap it. SET LOCAL lock_timeout applies
-- only inside this transaction. PostgreSQL rolls every object in the file back
-- if a statement fails before COMMIT.
--
-- down.sql in this directory is the local reverse. Prisma does not run it.
-- Do not run down.sql against a remote database.
--
-- Empty tables only. No destination is inserted enabled. No attempt rows are
-- inserted. No Sheets job, GHL run, source lead, notification receipt, legacy
-- custom-webhook row, or DeliveryTarget is updated. ClientDeliveryNotificationChannel
-- stays ('email'). smsEnabled is false on existing preference rows.
--
-- Merging this file makes sa360-migrate apply it on the next API predeploy.
-- SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED stays unset. This change does not POST.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $channel$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ClientDeliveryNotificationChannel'
      AND e.enumlabel = 'sms'
  ) THEN
    RAISE EXCEPTION 'sms channel must not be added before a sender exists';
  END IF;
END
$channel$;

CREATE TYPE "ExternalWebhookDestinationKind" AS ENUM ('ghl_inbound', 'external_https');

CREATE TYPE "ExternalWebhookAuthMode" AS ENUM ('none', 'hmac_sha256');

CREATE TYPE "ExternalWebhookAttemptState" AS ENUM ('recorded', 'attempted');

CREATE TYPE "ExternalWebhookDeliveryOutcome" AS ENUM (
  'http_accepted',
  'retryable',
  'failed',
  'uncertain'
);

CREATE TYPE "ExternalWebhookMappingMode" AS ENUM ('v3_canonical', 'published_column_map');

CREATE TABLE "ClientExternalWebhookDestination" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "kind" "ExternalWebhookDestinationKind" NOT NULL,
    "crmRole" TEXT NOT NULL DEFAULT 'primary_crm',
    "authMode" "ExternalWebhookAuthMode" NOT NULL DEFAULT 'none',
    "endpointUrlCiphertext" TEXT NOT NULL,
    "endpointUrlFingerprint" TEXT NOT NULL,
    "endpointHost" TEXT NOT NULL,
    "signingSecretCiphertext" TEXT,
    "signingSecretFingerprint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientExternalWebhookDestination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientExternalWebhookDestination_clientAccountId_key"
  ON "ClientExternalWebhookDestination"("clientAccountId");

CREATE INDEX "ClientExternalWebhookDestination_enabled_idx"
  ON "ClientExternalWebhookDestination"("enabled");

ALTER TABLE "ClientExternalWebhookDestination"
  ADD CONSTRAINT "ClientExternalWebhookDestination_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientExternalWebhookDestination"
  ADD CONSTRAINT "ClientExternalWebhookDestination_crm_role_chk"
  CHECK ("crmRole" = 'primary_crm');

ALTER TABLE "ClientExternalWebhookDestination"
  ADD CONSTRAINT "ClientExternalWebhookDestination_revision_chk"
  CHECK ("revision" >= 1);

ALTER TABLE "ClientExternalWebhookDestination"
  ADD CONSTRAINT "ClientExternalWebhookDestination_url_ciphertext_chk"
  CHECK ("endpointUrlCiphertext" ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');

ALTER TABLE "ClientExternalWebhookDestination"
  ADD CONSTRAINT "ClientExternalWebhookDestination_url_fingerprint_chk"
  CHECK ("endpointUrlFingerprint" ~ '^[0-9a-f]{16}$');

ALTER TABLE "ClientExternalWebhookDestination"
  ADD CONSTRAINT "ClientExternalWebhookDestination_host_chk"
  CHECK (
    char_length(btrim("endpointHost")) > 0
    AND "endpointHost" = lower("endpointHost")
    AND position('/' IN "endpointHost") = 0
    AND position('?' IN "endpointHost") = 0
    AND position('@' IN "endpointHost") = 0
    AND position(' ' IN "endpointHost") = 0
  );

ALTER TABLE "ClientExternalWebhookDestination"
  ADD CONSTRAINT "ClientExternalWebhookDestination_auth_chk"
  CHECK (
    (
      "authMode" = 'none'
      AND "signingSecretCiphertext" IS NULL
      AND "signingSecretFingerprint" IS NULL
    )
    OR (
      "authMode" = 'hmac_sha256'
      AND "signingSecretCiphertext" ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
      AND "signingSecretFingerprint" ~ '^[0-9a-f]{16}$'
    )
  );

CREATE TABLE "ExternalWebhookDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "kind" "ExternalWebhookDestinationKind" NOT NULL,
    "destinationRevision" INTEGER NOT NULL,
    "endpointHost" TEXT NOT NULL,
    "endpointUrlFingerprint" TEXT NOT NULL,
    "mappingMode" "ExternalWebhookMappingMode" NOT NULL,
    "columnMapId" TEXT,
    "columnMapVersion" INTEGER,
    "columnMapContentKey" TEXT,
    "columnMapSourceScope" TEXT,
    "payloadCanonicalJson" TEXT NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "state" "ExternalWebhookAttemptState" NOT NULL DEFAULT 'recorded',
    "outcome" "ExternalWebhookDeliveryOutcome",
    "httpStatus" INTEGER,
    "requestLeftSa360" BOOLEAN NOT NULL DEFAULT false,
    "proves" JSONB NOT NULL DEFAULT '[]',
    "doesNotProve" JSONB NOT NULL DEFAULT '["ghl_contact","ghl_workflow","ghl_note","ghl_location_api_success","sheets_row_appended","sms_sent","email_sent"]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalWebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalWebhookDeliveryAttempt_idempotencyKey_key"
  ON "ExternalWebhookDeliveryAttempt"("idempotencyKey");

CREATE UNIQUE INDEX "ExternalWebhookDeliveryAttempt_client_event_key"
  ON "ExternalWebhookDeliveryAttempt"("clientAccountId", "sourceLeadEventId");

CREATE INDEX "ExternalWebhookDeliveryAttempt_state_createdAt_idx"
  ON "ExternalWebhookDeliveryAttempt"("state", "createdAt");

CREATE INDEX "ExternalWebhookDeliveryAttempt_destinationId_idx"
  ON "ExternalWebhookDeliveryAttempt"("destinationId");

-- Restrict: deleting a client or destination must not erase a receipt.
ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_destinationId_fkey"
  FOREIGN KEY ("destinationId") REFERENCES "ClientExternalWebhookDestination"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_idempotency_chk"
  CHECK (
    char_length(btrim("clientAccountId")) > 0
    AND char_length(btrim("sourceLeadEventId")) > 0
    AND "idempotencyKey" = 'external-webhook:' || "clientAccountId" || ':' || "sourceLeadEventId"
  );

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_revision_chk"
  CHECK ("destinationRevision" >= 1);

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_hash_chk"
  CHECK (
    char_length("payloadCanonicalJson") > 1
    AND "payloadSha256" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_map_chk"
  CHECK (
    (
      "mappingMode" = 'v3_canonical'
      AND "columnMapId" IS NULL
      AND "columnMapVersion" IS NULL
      AND "columnMapContentKey" IS NULL
    )
    OR (
      "mappingMode" = 'published_column_map'
      AND "columnMapId" IS NOT NULL
      AND "columnMapVersion" >= 1
      AND "columnMapContentKey" = 'column-map:' || "columnMapId" || ':v' || "columnMapVersion"::text
      AND "columnMapSourceScope" IS NOT NULL
      AND char_length(btrim("columnMapSourceScope")) > 0
    )
  );

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_state_chk"
  CHECK (
    (
      "state" = 'recorded'
      AND "outcome" IS NULL
      AND "httpStatus" IS NULL
      AND "requestLeftSa360" = false
      AND "proves" = '[]'::jsonb
    )
    OR (
      "state" = 'attempted'
      AND "outcome" IS NOT NULL
    )
  );

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_http_chk"
  CHECK ("httpStatus" IS NULL OR ("httpStatus" >= 100 AND "httpStatus" <= 599));

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_outcome_chk"
  CHECK (
    (
      "outcome" IS DISTINCT FROM 'http_accepted'
      AND "proves" = '[]'::jsonb
    )
    OR (
      "outcome" = 'http_accepted'
      AND "httpStatus" BETWEEN 200 AND 299
      AND "requestLeftSa360" = true
      AND "proves" = '["http_2xx"]'::jsonb
    )
  );

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_retryable_chk"
  CHECK ("outcome" IS DISTINCT FROM 'retryable' OR "requestLeftSa360" = false);

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_uncertain_chk"
  CHECK ("outcome" IS DISTINCT FROM 'uncertain' OR "requestLeftSa360" = true);

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_does_not_prove_chk"
  CHECK (
    "doesNotProve" = '["ghl_contact","ghl_workflow","ghl_note","ghl_location_api_success","sheets_row_appended","sms_sent","email_sent"]'::jsonb
  );

-- The live GHL location predicate below matches isPersistedLiveDestination:
-- deliveryEnabled, deliveryMode live, clientCutoverApproved, internalApprovalStatus
-- approved, and a non-blank saved location. Company Sheets and
-- ClientCustomWebhookDestination are not read.
CREATE FUNCTION external_webhook_primary_crm_conflict()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ghl_armed boolean;
BEGIN
  PERFORM 1
  FROM "ClientAccount"
  WHERE "clientAccountId" = NEW."clientAccountId"
  FOR UPDATE;

  IF TG_TABLE_NAME = 'ClientGhlDestination' THEN
    ghl_armed := NEW."deliveryEnabled" = true
      AND NEW."deliveryMode" = 'live'
      AND NEW."clientCutoverApproved" = true
      AND NEW."internalApprovalStatus" = 'approved'
      AND btrim(NEW."destinationSubaccountIdGhl") <> '';
    IF NOT ghl_armed THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "ClientExternalWebhookDestination" webhook
      WHERE webhook."clientAccountId" = NEW."clientAccountId"
        AND webhook."enabled" = true
    ) THEN
      RAISE EXCEPTION 'duplicate_primary_crm' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'ClientExternalWebhookDestination' THEN
    IF NEW."enabled" IS NOT TRUE THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "ClientGhlDestination" ghl
      WHERE ghl."clientAccountId" = NEW."clientAccountId"
        AND ghl."deliveryEnabled" = true
        AND ghl."deliveryMode" = 'live'
        AND ghl."clientCutoverApproved" = true
        AND ghl."internalApprovalStatus" = 'approved'
        AND btrim(ghl."destinationSubaccountIdGhl") <> ''
    ) THEN
      RAISE EXCEPTION 'duplicate_primary_crm' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'external_webhook_primary_crm_conflict attached to %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "ClientExternalWebhookDestination_primary_crm"
  BEFORE INSERT OR UPDATE ON "ClientExternalWebhookDestination"
  FOR EACH ROW
  EXECUTE FUNCTION external_webhook_primary_crm_conflict();

CREATE TRIGGER "ClientGhlDestination_external_webhook_primary_crm"
  BEFORE INSERT OR UPDATE ON "ClientGhlDestination"
  FOR EACH ROW
  EXECUTE FUNCTION external_webhook_primary_crm_conflict();

CREATE FUNCTION external_webhook_destination_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."clientAccountId" IS DISTINCT FROM OLD."clientAccountId" THEN
      RAISE EXCEPTION 'external_webhook_client_immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW."revision" < OLD."revision" THEN
      RAISE EXCEPTION 'external_webhook_revision_regression' USING ERRCODE = '23514';
    END IF;
    IF NEW."revision" = OLD."revision" AND (
      NEW."endpointUrlCiphertext" IS DISTINCT FROM OLD."endpointUrlCiphertext"
      OR NEW."endpointUrlFingerprint" IS DISTINCT FROM OLD."endpointUrlFingerprint"
      OR NEW."endpointHost" IS DISTINCT FROM OLD."endpointHost"
      OR NEW."signingSecretCiphertext" IS DISTINCT FROM OLD."signingSecretCiphertext"
      OR NEW."signingSecretFingerprint" IS DISTINCT FROM OLD."signingSecretFingerprint"
      OR NEW."kind" IS DISTINCT FROM OLD."kind"
      OR NEW."authMode" IS DISTINCT FROM OLD."authMode"
    ) THEN
      RAISE EXCEPTION 'external_webhook_url_revision_required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ClientExternalWebhookDestination_revision"
  BEFORE UPDATE ON "ClientExternalWebhookDestination"
  FOR EACH ROW
  EXECUTE FUNCTION external_webhook_destination_revision();

CREATE FUNCTION external_webhook_attempt_freeze()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."clientAccountId" IS DISTINCT FROM OLD."clientAccountId"
    OR NEW."destinationId" IS DISTINCT FROM OLD."destinationId"
    OR NEW."sourceLeadEventId" IS DISTINCT FROM OLD."sourceLeadEventId"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."destinationRevision" IS DISTINCT FROM OLD."destinationRevision"
    OR NEW."endpointHost" IS DISTINCT FROM OLD."endpointHost"
    OR NEW."endpointUrlFingerprint" IS DISTINCT FROM OLD."endpointUrlFingerprint"
    OR NEW."mappingMode" IS DISTINCT FROM OLD."mappingMode"
    OR NEW."columnMapId" IS DISTINCT FROM OLD."columnMapId"
    OR NEW."columnMapVersion" IS DISTINCT FROM OLD."columnMapVersion"
    OR NEW."columnMapContentKey" IS DISTINCT FROM OLD."columnMapContentKey"
    OR NEW."columnMapSourceScope" IS DISTINCT FROM OLD."columnMapSourceScope"
    OR NEW."payloadCanonicalJson" IS DISTINCT FROM OLD."payloadCanonicalJson"
    OR NEW."payloadSha256" IS DISTINCT FROM OLD."payloadSha256"
  THEN
    RAISE EXCEPTION 'external_webhook_attempt_frozen' USING ERRCODE = '23514';
  END IF;

  IF OLD."outcome" IS NOT NULL AND OLD."outcome" IS DISTINCT FROM 'retryable' THEN
    IF NEW."outcome" IS DISTINCT FROM OLD."outcome"
      OR NEW."httpStatus" IS DISTINCT FROM OLD."httpStatus"
      OR NEW."requestLeftSa360" IS DISTINCT FROM OLD."requestLeftSa360"
      OR NEW."state" IS DISTINCT FROM OLD."state"
      OR NEW."proves" IS DISTINCT FROM OLD."proves"
      OR NEW."doesNotProve" IS DISTINCT FROM OLD."doesNotProve"
    THEN
      RAISE EXCEPTION 'external_webhook_receipt_terminal' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ExternalWebhookDeliveryAttempt_freeze"
  BEFORE UPDATE ON "ExternalWebhookDeliveryAttempt"
  FOR EACH ROW
  EXECUTE FUNCTION external_webhook_attempt_freeze();

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD COLUMN "recipientPhoneE164" TEXT,
  ADD COLUMN "recipientPhoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "smsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD CONSTRAINT "ClientDeliveryNotifyPref_phone_e164_chk"
  CHECK (
    "recipientPhoneE164" IS NULL
    OR "recipientPhoneE164" ~ '^\+[1-9][0-9]{7,14}$'
  );

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD CONSTRAINT "ClientDeliveryNotifyPref_sms_verified_chk"
  CHECK (
    "smsEnabled" = false
    OR (
      "recipientPhoneE164" IS NOT NULL
      AND "recipientPhoneVerifiedAt" IS NOT NULL
    )
  );

-- Runtime grants. There is no ALTER DEFAULT PRIVILEGES grant to sa360_app.
-- The migrate login remains the table owner. This block does not SET ROLE,
-- create a role, issue a password, or change default privileges.
-- New columns on ClientDeliveryNotificationPreference are covered by the
-- existing table grant. Loopback databases can migrate before sa360_app exists.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."ClientExternalWebhookDestination",
      public."ExternalWebhookDeliveryAttempt"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'external webhook grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'external webhook grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
