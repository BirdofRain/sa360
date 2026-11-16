-- Lets notice reconciliation reopen an ineligible decision after a
-- transaction that was already open at decision time has committed.
-- Does not rewrite attempts, receipts, destinations, or send counts.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE "ExternalWebhookNoticeChannelDecision"
  ADD COLUMN "revisitAfter" TIMESTAMP(3);

COMMIT;
