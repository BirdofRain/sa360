-- Request-only source and campaign association proposals.
--
-- Empty table only. No SourceFunnel row is confirmed or reassigned.
-- No CampaignRoutingRule row is inserted or updated.
-- No inventory origin is stamped. No delivery flag is changed.
-- Routing and delivery queries do not read this table.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. prisma migrate deploy (Prisma 6.19, sa360-migrate) sends the file
-- through simple_query and does not wrap it. SET LOCAL lock_timeout applies
-- only inside this transaction.
--
-- The foreign key takes a short lock on ClientAccount while it validates.
-- The new table is empty, so validation does not rewrite client rows.
-- If the lock is not available within 3 seconds the transaction rolls back
-- and leaves no table.
--
-- Merging this file into master makes sa360-migrate apply it on the next API
-- predeploy. This change does not set a feature flag and does not arm routing.
--
-- One open proposal per client is the partial unique index
-- SourceCampaignAssociationRequest_one_requested_key.
-- Prisma 6 cannot model that filter. Do not drop the index in a later diff.
--
-- Rollback of a failed run is this transaction. A committed table is removed
-- only by a later reviewed migration. This file does not drop anything.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "SourceCampaignAssociationRequestStatus" AS ENUM (
  'requested',
  'rejected',
  'superseded'
);

CREATE TABLE "SourceCampaignAssociationRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "historicalClientAccountId" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "setupRevision" INTEGER NOT NULL,
    "providerFunnelId" TEXT,
    "parentUrlKey" TEXT,
    "providerCampaignId" TEXT NOT NULL,
    "status" "SourceCampaignAssociationRequestStatus" NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "recordResultJson" JSONB NOT NULL,
    "actor" TEXT NOT NULL,
    "dispositionReason" TEXT,
    "rejectionRequestId" TEXT,
    "rejectionPayloadHash" TEXT,
    "rejectionResultJson" JSONB,
    "supersededByRequestId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceCampaignAssociationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceCampaignAssociationRequest_requestId_key"
  ON "SourceCampaignAssociationRequest"("requestId");

CREATE UNIQUE INDEX "SourceCampaignAssociationRequest_rejectionRequestId_key"
  ON "SourceCampaignAssociationRequest"("rejectionRequestId");

CREATE UNIQUE INDEX "SourceCampaignAssociationRequest_clientAccountId_revision_key"
  ON "SourceCampaignAssociationRequest"("clientAccountId", "revision");

CREATE INDEX "SourceCampaignAssociationRequest_clientAccountId_createdAt_idx"
  ON "SourceCampaignAssociationRequest"("clientAccountId", "createdAt");

-- One open proposal. Rejected and superseded rows stay as history.
CREATE UNIQUE INDEX "SourceCampaignAssociationRequest_one_requested_key"
  ON "SourceCampaignAssociationRequest"("clientAccountId")
  WHERE "status" = 'requested';

ALTER TABLE "SourceCampaignAssociationRequest"
  ADD CONSTRAINT "SourceCampaignAssociationRequest_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "SourceCampaignAssociationRequest"
  ADD CONSTRAINT "SourceCampaignAssociationRequest_revision_chk"
  CHECK (
    "revision" >= 1
    AND "expectedRevision" >= 0
    AND "setupRevision" >= 1
    AND "revision" > "expectedRevision"
  );

ALTER TABLE "SourceCampaignAssociationRequest"
  ADD CONSTRAINT "SourceCampaignAssociationRequest_actor_chk"
  CHECK ("actor" = 'ADMIN');

ALTER TABLE "SourceCampaignAssociationRequest"
  ADD CONSTRAINT "SourceCampaignAssociationRequest_request_id_chk"
  CHECK (
    char_length("requestId") = 36
    AND (
      "rejectionRequestId" IS NULL
      OR (
        char_length("rejectionRequestId") = 36
        AND "rejectionRequestId" <> "requestId"
      )
    )
    AND (
      "supersededByRequestId" IS NULL
      OR char_length("supersededByRequestId") = 36
    )
  );

ALTER TABLE "SourceCampaignAssociationRequest"
  ADD CONSTRAINT "SourceCampaignAssociationRequest_hash_chk"
  CHECK (
    "payloadHash" ~ '^[0-9a-f]{64}$'
    AND (
      "rejectionPayloadHash" IS NULL
      OR "rejectionPayloadHash" ~ '^[0-9a-f]{64}$'
    )
  );

ALTER TABLE "SourceCampaignAssociationRequest"
  ADD CONSTRAINT "SourceCampaignAssociationRequest_identity_chk"
  CHECK (
    (
      "providerFunnelId" IS NULL
      OR (
        char_length("providerFunnelId") BETWEEN 1 AND 200
        AND "providerFunnelId" = btrim("providerFunnelId")
      )
    )
    AND (
      "parentUrlKey" IS NULL
      OR (
        char_length("parentUrlKey") BETWEEN 1 AND 500
        AND "parentUrlKey" = btrim("parentUrlKey")
        AND position(' ' IN "parentUrlKey") = 0
      )
    )
    AND ("providerFunnelId" IS NOT NULL OR "parentUrlKey" IS NOT NULL)
    AND char_length("providerCampaignId") BETWEEN 1 AND 200
    AND "providerCampaignId" = btrim("providerCampaignId")
    AND char_length("historicalClientAccountId") BETWEEN 1 AND 128
  );

ALTER TABLE "SourceCampaignAssociationRequest"
  ADD CONSTRAINT "SourceCampaignAssociationRequest_result_object_chk"
  CHECK (
    jsonb_typeof("recordResultJson") = 'object'
    AND (
      "rejectionResultJson" IS NULL
      OR jsonb_typeof("rejectionResultJson") = 'object'
    )
  );

ALTER TABLE "SourceCampaignAssociationRequest"
  ADD CONSTRAINT "SourceCampaignAssociationRequest_status_shape_chk"
  CHECK (
    (
      "status" = 'requested'
      AND "dispositionReason" IS NULL
      AND "rejectedAt" IS NULL
      AND "supersededAt" IS NULL
      AND "supersededByRequestId" IS NULL
      AND "rejectionRequestId" IS NULL
      AND "rejectionPayloadHash" IS NULL
      AND "rejectionResultJson" IS NULL
    )
    OR (
      "status" = 'rejected'
      AND "rejectedAt" IS NOT NULL
      AND "supersededAt" IS NULL
      AND "supersededByRequestId" IS NULL
      AND "dispositionReason" IN (
        'source_owned_by_other_client',
        'ambiguous_source',
        'campaign_owned_by_other_client',
        'operator_rejected'
      )
      AND (
        (
          "dispositionReason" = 'operator_rejected'
          AND "rejectionRequestId" IS NOT NULL
          AND "rejectionPayloadHash" ~ '^[0-9a-f]{64}$'
          AND jsonb_typeof("rejectionResultJson") = 'object'
        )
        OR (
          "dispositionReason" <> 'operator_rejected'
          AND "rejectionRequestId" IS NULL
          AND "rejectionPayloadHash" IS NULL
          AND "rejectionResultJson" IS NULL
        )
      )
    )
    OR (
      "status" = 'superseded'
      AND "supersededAt" IS NOT NULL
      AND "supersededByRequestId" IS NOT NULL
      AND "dispositionReason" = 'superseded_by_later_request'
      AND "rejectedAt" IS NULL
      AND "rejectionRequestId" IS NULL
      AND "rejectionPayloadHash" IS NULL
      AND "rejectionResultJson" IS NULL
    )
  );

COMMENT ON TABLE "SourceCampaignAssociationRequest" IS
  'Proposed source and campaign association only. Not a SourceFunnel, not a CampaignRoutingRule, and not read by routing or delivery.';

CREATE FUNCTION source_campaign_association_request_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."historicalClientAccountId" IS DISTINCT FROM NEW."clientAccountId" THEN
      RAISE EXCEPTION 'historical client id must match the client at insert'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" NOT IN ('requested', 'rejected') THEN
      RAISE EXCEPTION 'a request cannot be inserted as superseded'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
     OR NEW."clientAccountId" IS DISTINCT FROM OLD."clientAccountId"
     OR NEW."historicalClientAccountId" IS DISTINCT FROM OLD."historicalClientAccountId"
     OR NEW."expectedRevision" IS DISTINCT FROM OLD."expectedRevision"
     OR NEW."setupRevision" IS DISTINCT FROM OLD."setupRevision"
     OR NEW."providerFunnelId" IS DISTINCT FROM OLD."providerFunnelId"
     OR NEW."parentUrlKey" IS DISTINCT FROM OLD."parentUrlKey"
     OR NEW."providerCampaignId" IS DISTINCT FROM OLD."providerCampaignId"
     OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
     OR NEW."recordResultJson" IS DISTINCT FROM OLD."recordResultJson"
     OR NEW."actor" IS DISTINCT FROM OLD."actor"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'SourceCampaignAssociationRequest snapshot is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" = 'requested' AND NEW."status" = 'superseded' THEN
    IF NEW."revision" IS DISTINCT FROM OLD."revision"
       OR NEW."rejectionRequestId" IS NOT NULL
       OR NEW."rejectedAt" IS NOT NULL
       OR NEW."supersededAt" IS NULL
       OR NEW."supersededByRequestId" IS NULL
    THEN
      RAISE EXCEPTION 'supersession must keep the revision and record its replacement'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'requested' AND NEW."status" = 'rejected' THEN
    IF NEW."revision" <= OLD."revision"
       OR NEW."rejectionRequestId" IS NULL
       OR NEW."rejectedAt" IS NULL
       OR NEW."supersededAt" IS NOT NULL
       OR NEW."supersededByRequestId" IS NOT NULL
    THEN
      RAISE EXCEPTION 'rejection must advance the revision and keep the request id'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'SourceCampaignAssociationRequest status cannot change that way'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "SourceCampaignAssociationRequest_snapshot_guard"
BEFORE INSERT OR UPDATE ON "SourceCampaignAssociationRequest"
FOR EACH ROW
EXECUTE FUNCTION source_campaign_association_request_guard();

-- Runtime grant for the new table only. DELETE is withheld so the app role
-- cannot erase the audit. There is no ALTER DEFAULT PRIVILEGES.
-- The migrate login remains the table owner. This block does not SET ROLE,
-- create a role, issue a password, or change default privileges.
-- Loopback databases can migrate before sa360_app exists. This block then
-- grants nothing. A non-loopback session without sa360_app fails and rolls back.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public."SourceCampaignAssociationRequest"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'source campaign request grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'source campaign request grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
