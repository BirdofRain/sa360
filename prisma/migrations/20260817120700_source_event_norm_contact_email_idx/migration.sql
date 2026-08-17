CREATE INDEX CONCURRENTLY IF NOT EXISTS "SourceLeadEvent_norm_contact_email_idx"
  ON "SourceLeadEvent" ((lower(("normalizedPayloadJson" #>> '{contact,email}'))))
  WHERE ("normalizedPayloadJson" #>> '{contact,email}') IS NOT NULL;
