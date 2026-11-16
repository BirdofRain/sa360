-- Durable ineligible-channel marks for notice reconciliation.
-- Does not rewrite attempts, receipts, destinations, or send counts.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE "ExternalWebhookNoticeChannelDecision" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "channel" "ExternalWebhookNoticeChannel" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalWebhookNoticeChannelDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalWebhookNoticeChannelDecision_attempt_channel_key"
  ON "ExternalWebhookNoticeChannelDecision"("attemptId", "channel");

CREATE INDEX "ExternalWebhookNoticeChannelDecision_attemptId_idx"
  ON "ExternalWebhookNoticeChannelDecision"("attemptId");

ALTER TABLE "ExternalWebhookNoticeChannelDecision"
  ADD CONSTRAINT "ExternalWebhookNoticeChannelDecision_reason_chk"
  CHECK ("reason" ~ '^[a-z0-9_]{1,80}$');

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."ExternalWebhookNoticeChannelDecision"
    TO sa360_app;
    RETURN;
  END IF;
  IF local_database THEN
    RAISE NOTICE 'notice decision grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;
  RAISE EXCEPTION 'notice decision grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
