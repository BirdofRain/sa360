-- AlterEnum
-- Additive only: introduces the Google Sheet cutover-rehearsal request source for
-- durable webhook-request-log auditing and C.O.C. filtering. No existing values change.
ALTER TYPE "WebhookRequestSource" ADD VALUE 'google_sheets';
