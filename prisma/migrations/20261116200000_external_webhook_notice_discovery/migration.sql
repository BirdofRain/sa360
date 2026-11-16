-- Page index and one discovery cursor for external-webhook notices.
--
-- Does not rewrite attempt outcomes, sendCount, payloads, or receipts.
-- Does not enable SMS or webhook delivery.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE INDEX "ExternalWebhookDeliveryAttempt_accepted_page_idx"
  ON "ExternalWebhookDeliveryAttempt" ("httpAcceptedAt", "id");

CREATE TABLE "ExternalWebhookNoticeDiscoveryCursor" (
    "id" TEXT NOT NULL,
    "lastHttpAcceptedAt" TIMESTAMP(3),
    "lastAttemptId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalWebhookNoticeDiscoveryCursor_pkey" PRIMARY KEY ("id")
);

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."ExternalWebhookNoticeDiscoveryCursor"
    TO sa360_app;
    RETURN;
  END IF;
  IF local_database THEN
    RAISE NOTICE 'notice discovery grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;
  RAISE EXCEPTION 'notice discovery grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
