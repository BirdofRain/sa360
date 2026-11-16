-- Index the fair recheck rotation for ineligible notice decisions.
-- Does not rewrite attempts, receipts, destinations, or send counts.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE INDEX "ExternalWebhookNoticeChannelDecision_revisit_idx"
  ON "ExternalWebhookNoticeChannelDecision" ("revisitAfter", "id");

COMMIT;
