-- SourceFunnel origin backfill looks up SourceLeadEvent by
-- sourceProvider + sourceCampaignId, then unique-joins LeadInventoryItem.
-- Production association timed out because sourceCampaignId was unindexed
-- and the planner scanned the full NULL-origin inventory population instead.
-- Ordinary CREATE INDEX takes a SHARE table lock that conflicts with
-- INSERT/UPDATE/DELETE and therefore blocks live NextGen intake writes
-- during the index build. CREATE INDEX CONCURRENTLY avoids that
-- write-blocking behavior by using lighter locking phases compatible
-- with normal DML.
-- Do not use IF NOT EXISTS: a failed CONCURRENTLY build can leave an
-- INVALID same-name index. Retry must DROP INDEX CONCURRENTLY then
-- actually run CREATE INDEX CONCURRENTLY again, not silently skip.
CREATE INDEX CONCURRENTLY "SourceLeadEvent_sourceProvider_sourceCampaignId_idx"
  ON "SourceLeadEvent" ("sourceProvider", "sourceCampaignId");
