-- AlterEnum
-- Additive only: introduces the Facebook Lead Ads request source for durable
-- webhook-request-log auditing and C.O.C. filtering. No existing values change.
ALTER TYPE "WebhookRequestSource" ADD VALUE 'facebook_lead_ads';
