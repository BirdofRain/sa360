-- SourceFunnel origin backfill looks up SourceLeadEvent by
-- sourceProvider + sourceCampaignId, then unique-joins LeadInventoryItem.
-- Production association timed out because sourceCampaignId was unindexed
-- and the planner scanned the full NULL-origin inventory population instead.
-- CONCURRENTLY matches existing SourceLeadEvent index migrations and avoids
-- ACCESS EXCLUSIVE write blocking while live NextGen intake continues.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SourceLeadEvent_sourceProvider_sourceCampaignId_idx"
  ON "SourceLeadEvent" ("sourceProvider", "sourceCampaignId");
