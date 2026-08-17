CREATE INDEX CONCURRENTLY IF NOT EXISTS "SourceLeadEvent_norm_phone_e164_idx"
  ON "SourceLeadEvent" ((("normalizedPayloadJson" #>> '{phone_e164}')))
  WHERE ("normalizedPayloadJson" #>> '{phone_e164}') IS NOT NULL;
