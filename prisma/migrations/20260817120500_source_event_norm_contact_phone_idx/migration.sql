CREATE INDEX CONCURRENTLY IF NOT EXISTS "SourceLeadEvent_norm_contact_phone_e164_idx"
  ON "SourceLeadEvent" ((("normalizedPayloadJson" #>> '{contact,phone_e164}')))
  WHERE ("normalizedPayloadJson" #>> '{contact,phone_e164}') IS NOT NULL;
