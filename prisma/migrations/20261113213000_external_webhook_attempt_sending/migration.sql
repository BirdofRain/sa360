-- Additive in-flight state for one external webhook attempt.
--
-- recorded cannot represent "the request may have left" without an outcome,
-- and an uncertain outcome is frozen. A crash after the socket opened would
-- otherwise POST a second time. sending is the compare-and-set claim.
-- Recovery promotes a stale sending row to uncertain and does not POST again.
--
-- The new enum value is committed before the check uses it. PostgreSQL does
-- not allow that use in the same transaction.
--
-- No attempt rows are updated. Sheets, GHL, and notification tables are not
-- altered. down.sql restores the previous check when no row is sending.
-- The enum value itself cannot be removed.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TYPE "ExternalWebhookAttemptState" ADD VALUE IF NOT EXISTS 'sending';

COMMIT;

BEGIN;

SET LOCAL lock_timeout = '3s';

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
      "state" = 'sending'
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
