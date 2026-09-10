-- Additive SourceFunnel registry + inventory origin-client stamp.
-- Existing ClientAccount and LeadInventoryItem rows are preserved.
-- No data rewrite. New columns are nullable; existing inventory origin stays NULL.
--
-- Lock / index behavior:
--   CREATE TYPE            — brief catalog lock
--   CREATE TABLE           — new empty table (cheap)
--   ALTER TABLE ADD COLUMN — nullable TEXT; short ACCESS EXCLUSIVE, no table rewrite
--   ADD CONSTRAINT FK      — validates existing rows (all NULL → fast)
--   CREATE UNIQUE INDEX on empty SourceFunnel (cheap)
--   CREATE INDEX on LeadInventoryItem.originClientAccountId
--     btree over a new mostly-NULL column. Non-CONCURRENT (Prisma wraps
--     migrate deploy in a transaction, so CONCURRENTLY cannot be used).
--     ShareLock blocks writes for the index build duration. At current
--     inventory scale this is expected to be short; it is not a full-table
--     rewrite. If inventory grows large, a follow-up CONCURRENTLY index
--     migration (outside a transaction) can replace this.
--
-- Rollback: DROP TABLE "SourceFunnel"; DROP TYPE; ALTER TABLE DROP COLUMN
-- originClientAccountId. Dropping the column does not restore prior origin
-- stamps (there are none on existing rows). Do not run this against production
-- from an implementation thread.

CREATE TYPE "SourceFunnelAssociationStatus" AS ENUM ('unassociated', 'suggested', 'confirmed');

CREATE TABLE "SourceFunnel" (
    "id" TEXT NOT NULL,
    "provider" "SourceLeadProvider" NOT NULL,
    "providerFunnelId" TEXT NOT NULL,
    "observedFunnelName" TEXT,
    "nicheKey" TEXT,
    "associationStatus" "SourceFunnelAssociationStatus" NOT NULL DEFAULT 'unassociated',
    "suggestedClientAccountId" TEXT,
    "originClientAccountId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceFunnel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceFunnel_provider_providerFunnelId_key"
  ON "SourceFunnel"("provider", "providerFunnelId");

CREATE INDEX "SourceFunnel_associationStatus_idx" ON "SourceFunnel"("associationStatus");
CREATE INDEX "SourceFunnel_originClientAccountId_idx" ON "SourceFunnel"("originClientAccountId");
CREATE INDEX "SourceFunnel_suggestedClientAccountId_idx" ON "SourceFunnel"("suggestedClientAccountId");
CREATE INDEX "SourceFunnel_lastSeenAt_idx" ON "SourceFunnel"("lastSeenAt");

ALTER TABLE "SourceFunnel"
  ADD CONSTRAINT "SourceFunnel_suggestedClientAccountId_fkey"
  FOREIGN KEY ("suggestedClientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SourceFunnel"
  ADD CONSTRAINT "SourceFunnel_originClientAccountId_fkey"
  FOREIGN KEY ("originClientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadInventoryItem"
  ADD COLUMN "originClientAccountId" TEXT;

CREATE INDEX "LeadInventoryItem_originClientAccountId_idx"
  ON "LeadInventoryItem"("originClientAccountId");

ALTER TABLE "LeadInventoryItem"
  ADD CONSTRAINT "LeadInventoryItem_originClientAccountId_fkey"
  FOREIGN KEY ("originClientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE SET NULL ON UPDATE CASCADE;
