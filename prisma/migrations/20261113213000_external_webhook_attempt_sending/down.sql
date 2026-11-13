-- Local reverse of the sending-state check. Prisma does not run this file.
-- Do not run it against a remote database. PostgreSQL cannot drop the enum
-- value sending once it has been committed. This restores the check that
-- allows only recorded and attempted. It refuses while a row is still sending.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM "ExternalWebhookDeliveryAttempt" WHERE "state" = 'sending') THEN
    RAISE EXCEPTION 'external webhook sending down refused: an attempt is in flight';
  END IF;
END
$guard$;

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  DROP CONSTRAINT "ExternalWebhookDeliveryAttempt_state_chk";

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

COMMIT;
