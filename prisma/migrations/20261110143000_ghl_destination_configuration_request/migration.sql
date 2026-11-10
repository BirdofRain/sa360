-- Request-only GoHighLevel destination configuration.
--
-- Empty table only. No ClientGhlDestination row is inserted or updated.
-- No CampaignRoutingRule row is inserted or updated.
-- No GhlLiveDeliveryRun is created. No workflow enrollment is sent.
-- Delivery, enrollment, and routing queries do not read this table.
-- deliveryEnabled, deliveryMode, clientCutoverApproved, and
-- internalApprovalStatus are not columns on this table and are not changed.
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
-- predeploy. This change does not set a feature flag and does not arm delivery.
-- Independent predeploy review is required before that rollout.
--
-- One stored configuration per client is the partial unique index
-- GhlDestinationConfigurationRequest_one_stored_key.
-- Prisma 6 cannot model that filter. Do not drop the index in a later diff.
--
-- Rollback of a failed run is this transaction. A committed table is removed
-- only by a later reviewed migration. This file does not drop anything.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "GhlDestinationConfigurationRequestStatus" AS ENUM (
  'stored',
  'superseded'
);

CREATE TABLE "GhlDestinationConfigurationRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "historicalClientAccountId" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "expectedDestinationUpdatedAt" TIMESTAMP(3),
    "locationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "fieldMappingsJson" JSONB NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "snapshotFetchedAt" TIMESTAMP(3) NOT NULL,
    "status" "GhlDestinationConfigurationRequestStatus" NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "recordResultJson" JSONB NOT NULL,
    "actor" TEXT NOT NULL,
    "supersededByRequestId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GhlDestinationConfigurationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GhlDestinationConfigurationRequest_requestId_key"
  ON "GhlDestinationConfigurationRequest"("requestId");

CREATE UNIQUE INDEX "GhlDestinationConfigurationRequest_clientAccountId_revision_key"
  ON "GhlDestinationConfigurationRequest"("clientAccountId", "revision");

CREATE INDEX "GhlDestinationConfigurationRequest_clientAccountId_createdAt_idx"
  ON "GhlDestinationConfigurationRequest"("clientAccountId", "createdAt");

-- One stored configuration. Superseded rows stay as history.
CREATE UNIQUE INDEX "GhlDestinationConfigurationRequest_one_stored_key"
  ON "GhlDestinationConfigurationRequest"("clientAccountId")
  WHERE "status" = 'stored';

ALTER TABLE "GhlDestinationConfigurationRequest"
  ADD CONSTRAINT "GhlDestinationConfigurationRequest_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "GhlDestinationConfigurationRequest"
  ADD CONSTRAINT "GhlDestinationConfigurationRequest_revision_chk"
  CHECK (
    "revision" >= 1
    AND "expectedRevision" >= 0
    AND "revision" = "expectedRevision" + 1
  );

ALTER TABLE "GhlDestinationConfigurationRequest"
  ADD CONSTRAINT "GhlDestinationConfigurationRequest_actor_chk"
  CHECK ("actor" = 'ADMIN');

ALTER TABLE "GhlDestinationConfigurationRequest"
  ADD CONSTRAINT "GhlDestinationConfigurationRequest_request_id_chk"
  CHECK (
    char_length("requestId") = 36
    AND (
      "supersededByRequestId" IS NULL
      OR (
        char_length("supersededByRequestId") = 36
        AND "supersededByRequestId" <> "requestId"
      )
    )
  );

ALTER TABLE "GhlDestinationConfigurationRequest"
  ADD CONSTRAINT "GhlDestinationConfigurationRequest_hash_chk"
  CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "GhlDestinationConfigurationRequest"
  ADD CONSTRAINT "GhlDestinationConfigurationRequest_identity_chk"
  CHECK (
    char_length("historicalClientAccountId") BETWEEN 1 AND 128
    AND char_length("locationId") BETWEEN 1 AND 200
    AND "locationId" = btrim("locationId")
    AND char_length("workflowId") BETWEEN 1 AND 200
    AND "workflowId" = btrim("workflowId")
    AND char_length("snapshotId") BETWEEN 1 AND 200
  );

ALTER TABLE "GhlDestinationConfigurationRequest"
  ADD CONSTRAINT "GhlDestinationConfigurationRequest_result_object_chk"
  CHECK (
    jsonb_typeof("recordResultJson") = 'object'
    AND jsonb_typeof("fieldMappingsJson") = 'array'
    AND jsonb_array_length("fieldMappingsJson") <= 40
  );

ALTER TABLE "GhlDestinationConfigurationRequest"
  ADD CONSTRAINT "GhlDestinationConfigurationRequest_status_shape_chk"
  CHECK (
    (
      "status" = 'stored'
      AND "supersededAt" IS NULL
      AND "supersededByRequestId" IS NULL
    )
    OR (
      "status" = 'superseded'
      AND "supersededAt" IS NOT NULL
      AND "supersededByRequestId" IS NOT NULL
    )
  );

COMMENT ON TABLE "GhlDestinationConfigurationRequest" IS
  'Intended GoHighLevel location, workflow, and field ids only. Not a ClientGhlDestination and not read by delivery, enrollment, or routing.';

CREATE FUNCTION ghl_destination_configuration_request_guard()
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
    IF NEW."status" <> 'stored' THEN
      RAISE EXCEPTION 'a configuration request cannot be inserted as superseded'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
     OR NEW."clientAccountId" IS DISTINCT FROM OLD."clientAccountId"
     OR NEW."historicalClientAccountId" IS DISTINCT FROM OLD."historicalClientAccountId"
     OR NEW."expectedRevision" IS DISTINCT FROM OLD."expectedRevision"
     OR NEW."revision" IS DISTINCT FROM OLD."revision"
     OR NEW."expectedDestinationUpdatedAt" IS DISTINCT FROM OLD."expectedDestinationUpdatedAt"
     OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
     OR NEW."workflowId" IS DISTINCT FROM OLD."workflowId"
     OR NEW."fieldMappingsJson" IS DISTINCT FROM OLD."fieldMappingsJson"
     OR NEW."snapshotId" IS DISTINCT FROM OLD."snapshotId"
     OR NEW."snapshotFetchedAt" IS DISTINCT FROM OLD."snapshotFetchedAt"
     OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
     OR NEW."recordResultJson" IS DISTINCT FROM OLD."recordResultJson"
     OR NEW."actor" IS DISTINCT FROM OLD."actor"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'GhlDestinationConfigurationRequest snapshot is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" = 'stored' AND NEW."status" = 'superseded' THEN
    IF NEW."supersededAt" IS NULL OR NEW."supersededByRequestId" IS NULL THEN
      RAISE EXCEPTION 'supersession must record its replacement'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'GhlDestinationConfigurationRequest status cannot change that way'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "GhlDestinationConfigurationRequest_snapshot_guard"
BEFORE INSERT OR UPDATE ON "GhlDestinationConfigurationRequest"
FOR EACH ROW
EXECUTE FUNCTION ghl_destination_configuration_request_guard();

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
      public."GhlDestinationConfigurationRequest"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'ghl destination configuration request grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'ghl destination configuration request grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
