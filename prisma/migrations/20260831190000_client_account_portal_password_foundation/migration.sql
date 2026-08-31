-- Per-customer portal password + session revocation foundation.
-- Additive only. Existing ClientAccount rows stay valid:
--   portalPasswordHash = NULL  → shared CLIENT_PORTAL_LOGIN_PASSWORD still works
--   portalSessionEpoch = 0     → existing HMAC sessions remain valid until epoch increments
-- No secret values and no data rewrite.

ALTER TABLE "ClientAccount" ADD COLUMN "portalPasswordHash" TEXT,
ADD COLUMN "portalPasswordSetAt" TIMESTAMP(3),
ADD COLUMN "portalSessionEpoch" INTEGER NOT NULL DEFAULT 0;
