CREATE INDEX CONCURRENTLY IF NOT EXISTS "SourceLeadEvent_sourceProvider_sourceSystem_sourceLeadId_idx"
  ON "SourceLeadEvent" ("sourceProvider", "sourceSystem", "sourceLeadId");
