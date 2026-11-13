-- Local reverse of 20261113194500_external_webhook_destination_foundation.
-- Prisma migrate does not run this file. Do not run it against a remote database.
-- Refuse when a receipt exists: dropping the attempt table would erase delivery
-- evidence. An empty destination table is safe to drop.
--
-- This restores ClientGhlDestination writes and ClientDeliveryNotificationPreference
-- to their pre-migration shape. It does not drop those tables.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF to_regclass('public."ExternalWebhookDeliveryAttempt"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM "ExternalWebhookDeliveryAttempt") THEN
    RAISE EXCEPTION 'external webhook down refused: delivery receipts exist';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS "ClientGhlDestination_external_webhook_primary_crm" ON "ClientGhlDestination";
DROP TRIGGER IF EXISTS "ClientExternalWebhookDestination_primary_crm" ON "ClientExternalWebhookDestination";
DROP TRIGGER IF EXISTS "ClientExternalWebhookDestination_revision" ON "ClientExternalWebhookDestination";
DROP TRIGGER IF EXISTS "ExternalWebhookDeliveryAttempt_freeze" ON "ExternalWebhookDeliveryAttempt";

DROP FUNCTION IF EXISTS external_webhook_primary_crm_conflict();
DROP FUNCTION IF EXISTS external_webhook_destination_revision();
DROP FUNCTION IF EXISTS external_webhook_attempt_freeze();

DROP TABLE IF EXISTS "ExternalWebhookDeliveryAttempt";
DROP TABLE IF EXISTS "ClientExternalWebhookDestination";

DROP TYPE IF EXISTS "ExternalWebhookMappingMode";
DROP TYPE IF EXISTS "ExternalWebhookDeliveryOutcome";
DROP TYPE IF EXISTS "ExternalWebhookAttemptState";
DROP TYPE IF EXISTS "ExternalWebhookAuthMode";
DROP TYPE IF EXISTS "ExternalWebhookDestinationKind";

ALTER TABLE "ClientDeliveryNotificationPreference"
  DROP CONSTRAINT IF EXISTS "ClientDeliveryNotifyPref_sms_verified_chk";

ALTER TABLE "ClientDeliveryNotificationPreference"
  DROP CONSTRAINT IF EXISTS "ClientDeliveryNotifyPref_phone_e164_chk";

ALTER TABLE "ClientDeliveryNotificationPreference"
  DROP COLUMN IF EXISTS "smsEnabled",
  DROP COLUMN IF EXISTS "recipientPhoneVerifiedAt",
  DROP COLUMN IF EXISTS "recipientPhoneE164";

COMMIT;
