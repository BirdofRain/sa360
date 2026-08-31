-- One-time portal invite state on ClientAccount.
-- Additive only. Existing rows stay valid:
--   portalInviteTokenHash = NULL  → no outstanding invite
--   portalInviteExpiresAt = NULL
-- No secret values and no data rewrite. Raw invite tokens are never stored.

ALTER TABLE "ClientAccount" ADD COLUMN "portalInviteTokenHash" TEXT,
ADD COLUMN "portalInviteExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ClientAccount_portalInviteTokenHash_key" ON "ClientAccount"("portalInviteTokenHash");
