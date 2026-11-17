-- Toll-free SMS consent v2 and handset-ownership proof.
--
-- v1 rows stay valid. v2 can be stored with the Life Agent Launch disclosure.
-- Handset proof is optional evidence. A pending verbal note cannot enable SMS.
-- This script does not enable SMS,
-- set a feature flag, call Twilio, or send a message.
--
-- The script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. SET LOCAL lock_timeout applies only inside this transaction.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD COLUMN "smsHandsetChallengeHash" TEXT,
  ADD COLUMN "smsHandsetDisclosureHash" TEXT,
  ADD COLUMN "smsHandsetChallengeExpiresAt" TIMESTAMP(3),
  ADD COLUMN "smsHandsetProvenAt" TIMESTAMP(3),
  ADD COLUMN "smsConsentCollection" TEXT,
  ADD COLUMN "smsVerbalAffirmation" TEXT,
  ADD COLUMN "smsVerbalDisclosureVersion" TEXT,
  ADD COLUMN "smsVerbalRecordedAt" TIMESTAMP(3),
  ADD COLUMN "smsVerbalOperatorId" TEXT,
  ADD COLUMN "smsVerbalEvidence" TEXT,
  ADD COLUMN "smsConfirmationEmail" TEXT,
  ADD COLUMN "smsOptInTokenHash" TEXT,
  ADD COLUMN "smsOptInTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ClientDeliveryNotificationPreference_smsOptInTokenHash_key"
  ON "ClientDeliveryNotificationPreference" ("smsOptInTokenHash");

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
      "smsSuppressionState" = 'suppressed'
      AND "smsEnabled" = false
      AND "smsSuppressedAt" IS NOT NULL
    )
  );

ALTER TABLE "ClientDeliveryNotificationPreference"
  ADD CONSTRAINT "ClientDeliveryNotifyPref_sms_collection_chk"
  CHECK (
    "smsConsentCollection" IS NULL
    OR (
      "smsConsentCollection" = 'pending_confirmation'
      AND "smsEnabled" = false
      AND "smsConsentRecordedAt" IS NULL
      AND "smsConsentText" IS NULL
      AND "smsConsentVersion" IS NULL
    )
    OR "smsConsentCollection" = 'recipient_link'
  );

COMMIT;
