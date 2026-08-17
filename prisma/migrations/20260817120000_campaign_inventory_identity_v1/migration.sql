-- Additive campaign-inventory identity columns + non-destructive backfill.
-- No existing values are rewritten except NULL → computed fingerprint.
--
-- Indexes are created in follow-up single-statement CONCURRENTLY migrations
-- because Prisma wraps multi-statement SQL in a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
--
-- This file only:
--   ALTER TABLE ADD COLUMN (nullable TEXT — brief ACCESS EXCLUSIVE, no rewrite)
--   CREATE EXTENSION IF NOT EXISTS pgcrypto
--   backfill UPDATE (row-level locks; other inserts can proceed)

ALTER TABLE "LeadInventoryItem"
  ADD COLUMN IF NOT EXISTS "phoneFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "emailFingerprint" TEXT;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Matches fingerprintIdentityValue("phone"|"email", value) in apps/api/src/lib/identity-fingerprint.ts
UPDATE "LeadInventoryItem" AS i
SET "phoneFingerprint" = encode(
  digest(
    'phone:' || trim(BOTH FROM COALESCE(
      e."normalizedPayloadJson" #>> '{phone_e164}',
      e."normalizedPayloadJson" #>> '{contact,phone_e164}'
    )),
    'sha256'
  ),
  'hex'
)
FROM "SourceLeadEvent" AS e
WHERE i."sourceLeadEventId" = e.id
  AND i."phoneFingerprint" IS NULL
  AND COALESCE(
    e."normalizedPayloadJson" #>> '{phone_e164}',
    e."normalizedPayloadJson" #>> '{contact,phone_e164}'
  ) IS NOT NULL
  AND trim(BOTH FROM COALESCE(
    e."normalizedPayloadJson" #>> '{phone_e164}',
    e."normalizedPayloadJson" #>> '{contact,phone_e164}'
  )) <> '';

UPDATE "LeadInventoryItem" AS i
SET "emailFingerprint" = encode(
  digest(
    'email:' || lower(trim(BOTH FROM COALESCE(
      e."normalizedPayloadJson" #>> '{email}',
      e."normalizedPayloadJson" #>> '{contact,email}'
    ))),
    'sha256'
  ),
  'hex'
)
FROM "SourceLeadEvent" AS e
WHERE i."sourceLeadEventId" = e.id
  AND i."emailFingerprint" IS NULL
  AND COALESCE(
    e."normalizedPayloadJson" #>> '{email}',
    e."normalizedPayloadJson" #>> '{contact,email}'
  ) IS NOT NULL
  AND trim(BOTH FROM COALESCE(
    e."normalizedPayloadJson" #>> '{email}',
    e."normalizedPayloadJson" #>> '{contact,email}'
  )) <> '';
