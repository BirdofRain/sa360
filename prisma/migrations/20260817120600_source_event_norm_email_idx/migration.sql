CREATE INDEX CONCURRENTLY IF NOT EXISTS "SourceLeadEvent_norm_email_idx"
  ON "SourceLeadEvent" ((lower(("normalizedPayloadJson" #>> '{email}'))))
  WHERE ("normalizedPayloadJson" #>> '{email}') IS NOT NULL;
