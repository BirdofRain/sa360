-- Optional campaign Lead Type key on SourceFunnel.
--
-- Additive and nullable. There is no default and no backfill: existing rows
-- stay NULL and historical SourceLeadEvent rows are not rewritten.
-- Setting the key does not change origin ownership.
--
-- The check lists the controlled keys. A new key needs a later migration.
-- SourceFunnelLeadTypeAudit records who changed the key. It is not a routing
-- input and sourceFunnelId is not a foreign key.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE "SourceFunnel"
  ADD COLUMN "leadTypeKey" TEXT;

ALTER TABLE "SourceFunnel"
  ADD CONSTRAINT "SourceFunnel_leadTypeKey_chk"
  CHECK (
    "leadTypeKey" IS NULL
    OR "leadTypeKey" IN ('vet_web_form', 'nurse_web_form', 'trucker_web_form')
  );

CREATE TABLE "SourceFunnelLeadTypeAudit" (
  "id" TEXT NOT NULL,
  "sourceFunnelId" TEXT NOT NULL,
  "previousKey" TEXT,
  "nextKey" TEXT,
  "actor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceFunnelLeadTypeAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceFunnelLeadTypeAudit_actor_chk"
    CHECK ("actor" = 'ADMIN' OR "actor" ~ '^c[a-z0-9]{24}$'),
  CONSTRAINT "SourceFunnelLeadTypeAudit_previousKey_chk"
    CHECK (
      "previousKey" IS NULL
      OR "previousKey" IN ('vet_web_form', 'nurse_web_form', 'trucker_web_form')
    ),
  CONSTRAINT "SourceFunnelLeadTypeAudit_nextKey_chk"
    CHECK (
      "nextKey" IS NULL
      OR "nextKey" IN ('vet_web_form', 'nurse_web_form', 'trucker_web_form')
    )
);

CREATE INDEX "SourceFunnelLeadTypeAudit_sourceFunnelId_createdAt_idx"
  ON "SourceFunnelLeadTypeAudit"("sourceFunnelId", "createdAt");

COMMIT;
