-- Local reverse. Prisma does not run this file. Do not run it on a remote database.
-- Drops only the send-count column added by this migration.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  DROP CONSTRAINT IF EXISTS "ExternalWebhookDeliveryAttempt_send_count_chk";

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  DROP COLUMN IF EXISTS "sendCount";

COMMIT;
