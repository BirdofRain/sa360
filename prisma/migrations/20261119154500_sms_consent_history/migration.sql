-- History for an affirmative move from webhook SMS consent to ghl-lead-sms-v1.
--
-- This script creates an empty archive table. It does not insert, update, or
-- delete ClientDeliveryNotificationPreference. It does not clear STOP, enable
-- SMS, set a feature flag, call Twilio, or send a message.
--
-- The script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. SET LOCAL lock_timeout applies only inside this transaction.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE "ClientDeliverySmsConsentHistory" (
  "id" TEXT NOT NULL,
  "clientAccountId" TEXT NOT NULL,
  "smsConsentVersion" TEXT NOT NULL,
  "smsConsentText" TEXT NOT NULL,
  "smsConsentRecordedAt" TIMESTAMP(3) NOT NULL,
  "smsConsentCollection" TEXT,
  "smsVerbalAffirmation" TEXT,
  "smsVerbalDisclosureVersion" TEXT,
  "smsVerbalRecordedAt" TIMESTAMP(3),
  "smsVerbalOperatorId" TEXT,
  "smsVerbalEvidence" TEXT,
  "recipientPhoneE164" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersedingVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientDeliverySmsConsentHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ClientDeliverySmsConsentHistory"
  ADD CONSTRAINT "ClientDeliverySmsConsentHistory_preference_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientDeliveryNotificationPreference"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientDeliverySmsConsentHistory"
  ADD CONSTRAINT "ClientDeliverySmsConsentHistory_version_chk"
  CHECK (
    "smsConsentVersion" IN ('external-webhook-sms-v1', 'external-webhook-sms-v2')
    AND "supersedingVersion" = 'ghl-lead-sms-v1'
    AND char_length("smsConsentText") BETWEEN 20 AND 500
    AND strpos("smsConsentText", '@') = 0
    AND "smsConsentText" !~ '\+[0-9]{8,}'
    AND "recipientPhoneE164" ~ '^\+[1-9][0-9]{7,14}$'
  );

CREATE INDEX "ClientDeliverySmsConsentHistory_client_archived_idx"
  ON "ClientDeliverySmsConsentHistory"("clientAccountId", "archivedAt");

COMMIT;
