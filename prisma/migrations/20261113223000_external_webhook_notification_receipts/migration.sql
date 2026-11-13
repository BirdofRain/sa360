-- Consent, STOP suppression, acceptance time, and channel-specific notice receipts.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. prisma migrate deploy sends the file through simple_query and does
-- not wrap it. SET LOCAL lock_timeout applies only inside this transaction.
--
-- Additive only. ClientDeliveryNotificationChannel stays ('email'). No SMS flag
-- is set. No Twilio, Resend, or webhook call is made. No attempt payload,
-- outcome, or sender column is rewritten. httpAcceptedAt is null until a later
-- update first sets outcome to http_accepted, and then a trigger stamps it once.
--
-- Existing preference rows gain smsSuppressionState 'unknown' and stay
-- smsEnabled false. Unknown suppression cannot send.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "ExternalWebhookSmsSuppression" AS ENUM ('unknown', 'clear', 'suppressed');

CREATE TYPE "ExternalWebhookNoticeChannel" AS ENUM ('email', 'sms');

CREATE TYPE "ExternalWebhookNoticeStatus" AS ENUM (
  'pending',
  'sending',
  'provider_accepted',
  'sent',
  'failed',
  'uncertain',
  'suppressed'
);

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD COLUMN "smsConsentVersion" TEXT,
  ADD COLUMN "smsConsentText" TEXT,
  ADD COLUMN "smsConsentRecordedAt" TIMESTAMP(3),
  ADD COLUMN "smsEnabledAt" TIMESTAMP(3),
  ADD COLUMN "smsDisabledAt" TIMESTAMP(3),
  ADD COLUMN "smsSuppressedAt" TIMESTAMP(3),
  ADD COLUMN "smsSuppressionState" "ExternalWebhookSmsSuppression" NOT NULL DEFAULT 'unknown';

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD CONSTRAINT "ClientDeliveryNotifyPref_sms_consent_chk"
  CHECK (
    "smsEnabled" = false
    OR (
      "smsSuppressionState" = 'clear'
      AND "smsEnabledAt" IS NOT NULL
      AND "smsConsentRecordedAt" IS NOT NULL
      AND "smsConsentVersion" = 'external-webhook-sms-v1'
      AND "smsConsentText" = 'SA360 may text this number when a delivery webhook is accepted. Reply STOP to opt out.'
      AND "recipientPhoneE164" IS NOT NULL
      AND "recipientPhoneVerifiedAt" IS NOT NULL
    )
  );

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD CONSTRAINT "ClientDeliveryNotifyPref_sms_suppression_chk"
  CHECK (
    (
      "smsSuppressionState" = 'unknown'
      AND "smsEnabled" = false
      AND "smsConsentRecordedAt" IS NULL
      AND "smsConsentText" IS NULL
      AND "smsConsentVersion" IS NULL
      AND "smsSuppressedAt" IS NULL
    )
    OR (
      "smsSuppressionState" = 'clear'
      AND "smsSuppressedAt" IS NULL
      AND "smsConsentVersion" = 'external-webhook-sms-v1'
      AND "smsConsentText" = 'SA360 may text this number when a delivery webhook is accepted. Reply STOP to opt out.'
      AND "smsConsentRecordedAt" IS NOT NULL
      AND "recipientPhoneE164" IS NOT NULL
      AND "recipientPhoneVerifiedAt" IS NOT NULL
      AND ("smsEnabled" = false OR "smsEnabledAt" IS NOT NULL)
    )
    OR (
      "smsSuppressionState" = 'suppressed'
      AND "smsEnabled" = false
      AND "smsSuppressedAt" IS NOT NULL
    )
  );

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD COLUMN "httpAcceptedAt" TIMESTAMP(3);

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_accepted_at_chk"
  CHECK ("httpAcceptedAt" IS NULL OR "outcome" = 'http_accepted');

CREATE FUNCTION external_webhook_attempt_accepted_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."httpAcceptedAt" IS NOT NULL THEN
    NEW."httpAcceptedAt" := OLD."httpAcceptedAt";
    RETURN NEW;
  END IF;
  IF NEW."outcome" = 'http_accepted'
    AND (TG_OP = 'INSERT' OR OLD."outcome" IS DISTINCT FROM 'http_accepted') THEN
    NEW."httpAcceptedAt" := transaction_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ExternalWebhookDeliveryAttempt_accepted_at"
  BEFORE INSERT OR UPDATE ON "ExternalWebhookDeliveryAttempt"
  FOR EACH ROW
  EXECUTE FUNCTION external_webhook_attempt_accepted_at();

CREATE TABLE "ExternalWebhookNotificationReceipt" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "acceptanceId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "channel" "ExternalWebhookNoticeChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "ExternalWebhookNoticeStatus" NOT NULL DEFAULT 'pending',
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "templateId" TEXT NOT NULL,
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "provider" TEXT,
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "providerCode" INTEGER,
    "deliveryEvidence" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalWebhookNotificationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalWebhookNotificationReceipt_idempotencyKey_key"
  ON "ExternalWebhookNotificationReceipt"("idempotencyKey");

CREATE INDEX "ExternalWebhookNotificationReceipt_status_claimedAt_idx"
  ON "ExternalWebhookNotificationReceipt"("status", "claimedAt");

CREATE INDEX "ExternalWebhookNotificationReceipt_attemptId_idx"
  ON "ExternalWebhookNotificationReceipt"("attemptId");

CREATE INDEX "ExternalWebhookNotificationReceipt_client_channel_idx"
  ON "ExternalWebhookNotificationReceipt"("clientAccountId", "channel");

ALTER TABLE "ExternalWebhookNotificationReceipt"
  ADD CONSTRAINT "ExternalWebhookNotificationReceipt_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ExternalWebhookDeliveryAttempt"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExternalWebhookNotificationReceipt"
  ADD CONSTRAINT "ExternalWebhookNotificationReceipt_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExternalWebhookNotificationReceipt"
  ADD CONSTRAINT "ExternalWebhookNotificationReceipt_key_chk"
  CHECK (
    char_length("idempotencyKey") <= 256
    AND "idempotencyKey" = 'external_webhook:' || "acceptanceId" || ':' || "channel"::text || ':' || "recipient"
    AND "acceptanceId" = "attemptId"
    AND "templateId" = 'delivery_accepted'
  );

ALTER TABLE "ExternalWebhookNotificationReceipt"
  ADD CONSTRAINT "ExternalWebhookNotificationReceipt_recipient_chk"
  CHECK (
    (
      "channel" = 'email'
      AND "recipient" = lower("recipient")
      AND "recipient" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND position(',' IN "recipient") = 0
    )
    OR (
      "channel" = 'sms'
      AND "recipient" ~ '^\+[1-9][0-9]{7,14}$'
    )
  );

ALTER TABLE "ExternalWebhookNotificationReceipt"
  ADD CONSTRAINT "ExternalWebhookNotificationReceipt_evidence_chk"
  CHECK (
    ("status" <> 'sent' OR ("deliveryEvidence" = true AND "providerMessageId" IS NOT NULL))
    AND ("status" <> 'provider_accepted' OR ("deliveryEvidence" = false AND "providerMessageId" IS NOT NULL))
    AND ("providerMessageId" IS NULL OR "providerMessageId" ~ '^[A-Za-z0-9_-]{1,64}$')
    AND ("provider" IS NULL OR "provider" IN ('twilio', 'resend'))
    AND ("providerStatus" IS NULL OR "providerStatus" ~ '^[a-z_]{1,40}$')
    AND ("skipReason" IS NULL OR "skipReason" ~ '^[a-z0-9_]{1,80}$')
    AND ("lastError" IS NULL OR "lastError" ~ '^[a-z0-9_]{1,80}$')
    AND ("status" <> 'suppressed' OR "skipReason" IS NOT NULL)
  );

CREATE FUNCTION external_webhook_notice_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  attempt "ExternalWebhookDeliveryAttempt"%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM "ExternalWebhookDeliveryAttempt" WHERE "id" = NEW."attemptId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'external_webhook_notice_attempt_missing' USING ERRCODE = '23503';
  END IF;
  IF attempt."outcome" IS DISTINCT FROM 'http_accepted' OR attempt."httpAcceptedAt" IS NULL THEN
    RAISE EXCEPTION 'external_webhook_notice_not_accepted' USING ERRCODE = '23514';
  END IF;
  IF NEW."acceptanceId" IS DISTINCT FROM attempt."id"
    OR NEW."clientAccountId" IS DISTINCT FROM attempt."clientAccountId"
    OR NEW."sourceLeadEventId" IS DISTINCT FROM attempt."sourceLeadEventId"
    OR NEW."destinationId" IS DISTINCT FROM attempt."destinationId"
    OR NEW."acceptedAt" IS DISTINCT FROM attempt."httpAcceptedAt"
  THEN
    RAISE EXCEPTION 'external_webhook_notice_attempt_mismatch' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" NOT IN ('pending', 'suppressed')
      OR NEW."deliveryEvidence" = true
      OR NEW."providerMessageId" IS NOT NULL
    THEN
      RAISE EXCEPTION 'external_webhook_notice_insert_status' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."acceptanceId" IS DISTINCT FROM OLD."acceptanceId"
    OR NEW."attemptId" IS DISTINCT FROM OLD."attemptId"
    OR NEW."channel" IS DISTINCT FROM OLD."channel"
    OR NEW."recipient" IS DISTINCT FROM OLD."recipient"
    OR NEW."clientAccountId" IS DISTINCT FROM OLD."clientAccountId"
    OR NEW."sourceLeadEventId" IS DISTINCT FROM OLD."sourceLeadEventId"
    OR NEW."destinationId" IS DISTINCT FROM OLD."destinationId"
    OR NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt"
    OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
  THEN
    RAISE EXCEPTION 'external_webhook_notice_frozen' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = NEW."status" THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'pending' AND NEW."status" IN ('sending', 'suppressed') THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'sending' AND NEW."status" IN ('provider_accepted', 'failed', 'uncertain', 'suppressed') THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'provider_accepted' AND NEW."status" IN ('sent', 'failed', 'suppressed') THEN
    IF NEW."status" = 'sent' AND NEW."deliveryEvidence" IS NOT TRUE THEN
      RAISE EXCEPTION 'external_webhook_notice_delivery_evidence' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'uncertain' AND NEW."status" IN ('provider_accepted', 'failed', 'suppressed') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'external_webhook_notice_transition' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "ExternalWebhookNotificationReceipt_guard"
  BEFORE INSERT OR UPDATE ON "ExternalWebhookNotificationReceipt"
  FOR EACH ROW
  EXECUTE FUNCTION external_webhook_notice_guard();

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."ExternalWebhookNotificationReceipt"
    TO sa360_app;
    RETURN;
  END IF;
  IF local_database THEN
    RAISE NOTICE 'external webhook notice grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;
  RAISE EXCEPTION 'external webhook notice grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
