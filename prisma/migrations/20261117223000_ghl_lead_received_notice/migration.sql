-- GHL lead-received SMS notice and a separate consent version.
--
-- ghl-lead-sms-v1 can be stored beside v1 and v2. Those earlier versions and
-- their text stay valid. This script does not rewrite a stored consent row,
-- enable SMS, set a feature flag, call Twilio, or send a message.
--
-- The script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. SET LOCAL lock_timeout applies only inside this transaction.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE "GhlLeadReceivedNotice" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "event" TEXT NOT NULL DEFAULT 'ghl_lead_received',
  "clientAccountId" TEXT NOT NULL,
  "sourceLeadEventId" TEXT NOT NULL,
  "destinationLocationIdGhl" TEXT NOT NULL,
  "liveRunId" TEXT NOT NULL,
  "contactExternalId" TEXT NOT NULL,
  "channel" "ExternalWebhookNoticeChannel" NOT NULL DEFAULT 'sms',
  "recipient" TEXT NOT NULL,
  "status" "ExternalWebhookNoticeStatus" NOT NULL DEFAULT 'pending',
  "consentVersion" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "templateId" TEXT NOT NULL DEFAULT 'ghl_lead_received',
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

  CONSTRAINT "GhlLeadReceivedNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GhlLeadReceivedNotice_idempotencyKey_key"
  ON "GhlLeadReceivedNotice" ("idempotencyKey");

CREATE UNIQUE INDEX "GhlLeadReceivedNotice_lead_location_key"
  ON "GhlLeadReceivedNotice" ("clientAccountId", "sourceLeadEventId", "destinationLocationIdGhl");

CREATE INDEX "GhlLeadReceivedNotice_status_claimed_idx"
  ON "GhlLeadReceivedNotice" ("status", "claimedAt");

CREATE INDEX "GhlLeadReceivedNotice_provider_message_idx"
  ON "GhlLeadReceivedNotice" ("providerMessageId");

CREATE INDEX "GhlLeadReceivedNotice_client_idx"
  ON "GhlLeadReceivedNotice" ("clientAccountId");

ALTER TABLE "GhlLeadReceivedNotice"
  ADD CONSTRAINT "GhlLeadReceivedNotice_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GhlLeadReceivedNotice"
  ADD CONSTRAINT "GhlLeadReceivedNotice_event_chk"
  CHECK ("event" = 'ghl_lead_received' AND "templateId" = 'ghl_lead_received' AND "channel" = 'sms');

ALTER TABLE "GhlLeadReceivedNotice"
  ADD CONSTRAINT "GhlLeadReceivedNotice_no_consumer_pii_chk"
  CHECK (
    strpos("contactExternalId", '@') = 0
    AND "contactExternalId" !~ '\+[0-9]{8,}'
    AND "recipient" !~* '@'
  );

CREATE TABLE "GhlLeadNoticeDiscoveryCursor" (
  "id" TEXT NOT NULL,
  "lastCompletedAt" TIMESTAMP(3),
  "lastRunId" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GhlLeadNoticeDiscoveryCursor_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ClientDeliveryNotificationPreference"
  DROP CONSTRAINT "ClientDeliveryNotifyPref_sms_consent_chk";

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
    OR (
      "smsSuppressionState" = 'clear'
      AND "smsEnabledAt" IS NOT NULL
      AND "smsConsentRecordedAt" IS NOT NULL
      AND "smsConsentVersion" = 'external-webhook-sms-v2'
      AND "smsConsentText" LIKE 'Life Agent Launch may text this number with operational SA360 delivery notifications.%'
      AND "smsConsentText" LIKE '%Message frequency varies.%'
      AND "smsConsentText" LIKE '%Message and data rates may apply.%'
      AND "smsConsentText" LIKE '%Reply STOP to opt out.%'
      AND "smsConsentText" LIKE '%Reply HELP for help.%'
      AND "smsConsentText" LIKE '%Privacy Policy: https://%'
      AND "smsConsentText" LIKE '%Terms: https://%'
      AND char_length("smsConsentText") BETWEEN 160 AND 500
      AND strpos("smsConsentText", '@') = 0
      AND "smsConsentText" !~ '\+[0-9]{8,}'
      AND "recipientPhoneE164" IS NOT NULL
      AND "recipientPhoneVerifiedAt" IS NOT NULL
    )
    OR (
      "smsSuppressionState" = 'clear'
      AND "smsEnabledAt" IS NOT NULL
      AND "smsConsentRecordedAt" IS NOT NULL
      AND "smsConsentVersion" = 'ghl-lead-sms-v1'
      AND "smsConsentText" LIKE 'Life Agent Launch may text this number when a lead is received in your GoHighLevel account.%'
      AND "smsConsentText" LIKE '%Message frequency varies.%'
      AND "smsConsentText" LIKE '%Message and data rates may apply.%'
      AND "smsConsentText" LIKE '%Reply STOP to opt out.%'
      AND "smsConsentText" LIKE '%Reply HELP for help.%'
      AND "smsConsentText" LIKE '%Privacy Policy: https://%'
      AND "smsConsentText" LIKE '%Terms: https://%'
      AND char_length("smsConsentText") BETWEEN 160 AND 500
      AND strpos("smsConsentText", '@') = 0
      AND "smsConsentText" !~ '\+[0-9]{8,}'
      AND "recipientPhoneE164" IS NOT NULL
      AND "recipientPhoneVerifiedAt" IS NOT NULL
    )
  );

ALTER TABLE "ClientDeliveryNotificationPreference"
  DROP CONSTRAINT "ClientDeliveryNotifyPref_sms_suppression_chk";

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
      "smsSuppressionState" = 'clear'
      AND "smsSuppressedAt" IS NULL
      AND "smsConsentVersion" = 'external-webhook-sms-v2'
      AND "smsConsentText" LIKE 'Life Agent Launch may text this number with operational SA360 delivery notifications.%'
      AND "smsConsentText" LIKE '%Message frequency varies.%'
      AND "smsConsentText" LIKE '%Message and data rates may apply.%'
      AND "smsConsentText" LIKE '%Reply STOP to opt out.%'
      AND "smsConsentText" LIKE '%Reply HELP for help.%'
      AND "smsConsentText" LIKE '%Privacy Policy: https://%'
      AND "smsConsentText" LIKE '%Terms: https://%'
      AND char_length("smsConsentText") BETWEEN 160 AND 500
      AND strpos("smsConsentText", '@') = 0
      AND "smsConsentText" !~ '\+[0-9]{8,}'
      AND "smsConsentRecordedAt" IS NOT NULL
      AND "recipientPhoneE164" IS NOT NULL
      AND "recipientPhoneVerifiedAt" IS NOT NULL
      AND ("smsEnabled" = false OR "smsEnabledAt" IS NOT NULL)
    )
    OR (
      "smsSuppressionState" = 'clear'
      AND "smsSuppressedAt" IS NULL
      AND "smsConsentVersion" = 'ghl-lead-sms-v1'
      AND "smsConsentText" LIKE 'Life Agent Launch may text this number when a lead is received in your GoHighLevel account.%'
      AND "smsConsentText" LIKE '%Message frequency varies.%'
      AND "smsConsentText" LIKE '%Message and data rates may apply.%'
      AND "smsConsentText" LIKE '%Reply STOP to opt out.%'
      AND "smsConsentText" LIKE '%Reply HELP for help.%'
      AND "smsConsentText" LIKE '%Privacy Policy: https://%'
      AND "smsConsentText" LIKE '%Terms: https://%'
      AND char_length("smsConsentText") BETWEEN 160 AND 500
      AND strpos("smsConsentText", '@') = 0
      AND "smsConsentText" !~ '\+[0-9]{8,}'
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

COMMIT;
