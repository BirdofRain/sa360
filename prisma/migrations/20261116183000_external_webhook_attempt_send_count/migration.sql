-- Bounded send count for external webhook attempts that never left SA360.
--
-- A retryable receipt is state attempted, so a recovery pass that reads only
-- recorded rows never claims it again. sendCount is the durable cap. The
-- payload, mapping, destination revision, and idempotency key stay frozen.
--
-- Timestamp is after 20261113223000_external_webhook_notification_receipts
-- on unmerged PR #338. This file does not alter that table, httpAcceptedAt,
-- notification preferences, Sheets, or GHL.
--
-- Existing rows start at 0. No outcome is rewritten.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD COLUMN "sendCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ExternalWebhookDeliveryAttempt"
  ADD CONSTRAINT "ExternalWebhookDeliveryAttempt_send_count_chk"
  CHECK ("sendCount" >= 0);

COMMIT;
