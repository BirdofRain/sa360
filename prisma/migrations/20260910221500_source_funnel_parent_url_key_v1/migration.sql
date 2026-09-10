-- Additive SourceFunnel parent_url_key identity.
-- Preserves existing #133 rows (synthetic UUID SourceFunnel evidence stays valid).
-- providerFunnelId becomes nullable so URL-only sources are not stored as fake UUIDs.
-- firstSeenAt/lastSeenAt become nullable so operator pre-registration is not a fabricated observation.
--
-- PostgreSQL unique indexes treat NULLs as distinct, so:
--   (provider, providerFunnelId) uniqueness applies only when providerFunnelId is present
--   (provider, parentUrlKey) uniqueness applies only when parentUrlKey is present
-- Multiple UUID-only rows (parentUrlKey NULL) and URL-only rows (providerFunnelId NULL) coexist.
--
-- CHECK: every row must have at least one provider identity.
--
-- Lock / index behavior:
--   ALTER COLUMN DROP NOT NULL — short ACCESS EXCLUSIVE, no table rewrite
--   ADD COLUMN nullable TEXT — short ACCESS EXCLUSIVE, no table rewrite
--   CREATE UNIQUE INDEX on parentUrlKey — ShareLock; table is small
--   ADD CHECK — validates existing rows (all have providerFunnelId)
--
-- Do not run this against production from an implementation thread.

ALTER TABLE "SourceFunnel" ALTER COLUMN "providerFunnelId" DROP NOT NULL;
ALTER TABLE "SourceFunnel" ALTER COLUMN "firstSeenAt" DROP NOT NULL;
ALTER TABLE "SourceFunnel" ALTER COLUMN "lastSeenAt" DROP NOT NULL;

ALTER TABLE "SourceFunnel" ADD COLUMN "parentUrlKey" TEXT;
ALTER TABLE "SourceFunnel" ADD COLUMN "pageSlug" TEXT;

CREATE UNIQUE INDEX "SourceFunnel_provider_parentUrlKey_key"
  ON "SourceFunnel"("provider", "parentUrlKey");

CREATE INDEX "SourceFunnel_provider_pageSlug_idx"
  ON "SourceFunnel"("provider", "pageSlug");

ALTER TABLE "SourceFunnel"
  ADD CONSTRAINT "SourceFunnel_provider_identity_present_check"
  CHECK (
    ("providerFunnelId" IS NOT NULL AND btrim("providerFunnelId") <> '')
    OR ("parentUrlKey" IS NOT NULL AND btrim("parentUrlKey") <> '')
  );
