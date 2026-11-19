-- Request-only client campaign registry.
--
-- Empty tables only. No SourceFunnel row is confirmed or reassigned.
-- No CampaignRoutingRule row is inserted or updated.
-- No SourceLeadEvent snapshot is rewritten.
-- No ClientGhlDestination, CompanySheetsDestination, CompanySheetsTabContract,
-- or ClientSheetColumnMap row is inserted or updated.
-- No delivery flag is changed. There is no backfill.
-- Routing, ingestion, GoHighLevel, and Company Sheets do not read these tables.
--
-- active, paused, and retired are enum labels for a later phase.
-- This migration does not write them. No operational reader uses them.
-- workflowLiveVerified and mapPublished are constrained to false.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. prisma migrate deploy sends the file through simple_query and does
-- not wrap it. SET LOCAL lock_timeout applies only inside this transaction.
--
-- Each foreign key takes a short lock on the referenced table while it validates.
-- The new tables are empty, so validation does not rewrite existing rows.
-- If a lock is not available within 3 seconds the transaction rolls back and
-- leaves no table.
--
-- Merging this file into master makes sa360-migrate apply it on the next API
-- predeploy. This change does not set a feature flag and does not arm routing.
--
-- ClientCampaignSourceIdentity_one_approved_key is a partial unique index.
-- Prisma 6 cannot model that filter. Do not drop the index in a later diff.
-- The binding identity guard is deferred so a binding and its identities commit
-- together. Do not drop that guard in a later diff.
--
-- Rollback of a failed run is this transaction. A committed table is removed
-- only by a later reviewed migration. This file does not drop anything.
-- Application rollback is safe while SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED
-- stays unset: existing readers do not reference these tables.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "ClientCampaignConfigurationStatus" AS ENUM (
  'draft',
  'review',
  'ready',
  'active',
  'paused',
  'retired'
);

CREATE TYPE "ClientCampaignSourceBindingStatus" AS ENUM (
  'suggested',
  'recorded',
  'approved',
  'superseded'
);

CREATE TYPE "ClientCampaignIdentifierKind" AS ENUM (
  'provider_funnel_id',
  'parent_url_key',
  'campaign_id',
  'form_id',
  'adset_id',
  'ad_id'
);

CREATE TYPE "ClientCampaignRegistryAction" AS ENUM (
  'create',
  'update',
  'save_bindings',
  'save_destination'
);

CREATE TABLE "ClientCampaign" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "nicheKey" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "status" "ClientCampaignConfigurationStatus" NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByActor" TEXT NOT NULL,
    "updatedByActor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCampaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientCampaign_clientAccountId_slug_key"
  ON "ClientCampaign"("clientAccountId", "slug");

CREATE INDEX "ClientCampaign_clientAccountId_updatedAt_idx"
  ON "ClientCampaign"("clientAccountId", "updatedAt");

ALTER TABLE "ClientCampaign"
  ADD CONSTRAINT "ClientCampaign_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaign"
  ADD CONSTRAINT "ClientCampaign_revision_chk"
  CHECK ("revision" >= 1);

ALTER TABLE "ClientCampaign"
  ADD CONSTRAINT "ClientCampaign_slug_chk"
  CHECK (
    char_length("slug") BETWEEN 1 AND 80
    AND "slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  );

ALTER TABLE "ClientCampaign"
  ADD CONSTRAINT "ClientCampaign_display_name_chk"
  CHECK (
    char_length("displayName") BETWEEN 1 AND 120
    AND "displayName" = btrim("displayName")
  );

ALTER TABLE "ClientCampaign"
  ADD CONSTRAINT "ClientCampaign_catalog_chk"
  CHECK (
    "nicheKey" IN ('VET', 'NURSE', 'MTG', 'TRUCKER', 'HEALTH', 'IUL', 'FEX')
    AND "productType" IN ('life_insurance', 'health_insurance', 'other')
  );

ALTER TABLE "ClientCampaign"
  ADD CONSTRAINT "ClientCampaign_actor_chk"
  CHECK (
    ("createdByActor" = 'ADMIN' OR "createdByActor" ~ '^c[a-z0-9]{24}$')
    AND ("updatedByActor" = 'ADMIN' OR "updatedByActor" ~ '^c[a-z0-9]{24}$')
  );

CREATE TABLE "ClientCampaignSourceBinding" (
    "id" TEXT NOT NULL,
    "clientCampaignId" TEXT NOT NULL,
    "bindingKey" TEXT NOT NULL,
    "sourceFunnelId" TEXT,
    "campaignRoutingRuleId" TEXT,
    "evidenceJson" JSONB NOT NULL DEFAULT '{}',
    "status" "ClientCampaignSourceBindingStatus" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCampaignSourceBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientCampaignSourceBinding_clientCampaignId_bindingKey_key"
  ON "ClientCampaignSourceBinding"("clientCampaignId", "bindingKey");

CREATE INDEX "ClientCampaignSourceBinding_sourceFunnelId_idx"
  ON "ClientCampaignSourceBinding"("sourceFunnelId");

CREATE INDEX "ClientCampaignSourceBinding_campaignRoutingRuleId_idx"
  ON "ClientCampaignSourceBinding"("campaignRoutingRuleId");

CREATE INDEX "ClientCampaignSourceBinding_clientCampaignId_status_idx"
  ON "ClientCampaignSourceBinding"("clientCampaignId", "status");

ALTER TABLE "ClientCampaignSourceBinding"
  ADD CONSTRAINT "ClientCampaignSourceBinding_clientCampaignId_fkey"
  FOREIGN KEY ("clientCampaignId") REFERENCES "ClientCampaign"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignSourceBinding"
  ADD CONSTRAINT "ClientCampaignSourceBinding_sourceFunnelId_fkey"
  FOREIGN KEY ("sourceFunnelId") REFERENCES "SourceFunnel"("id")
  ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignSourceBinding"
  ADD CONSTRAINT "ClientCampaignSourceBinding_campaignRoutingRuleId_fkey"
  FOREIGN KEY ("campaignRoutingRuleId") REFERENCES "CampaignRoutingRule"("id")
  ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignSourceBinding"
  ADD CONSTRAINT "ClientCampaignSourceBinding_shape_chk"
  CHECK (
    "revision" >= 1
    AND char_length("bindingKey") BETWEEN 1 AND 80
    AND "bindingKey" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND ("actor" = 'ADMIN' OR "actor" ~ '^c[a-z0-9]{24}$')
    AND jsonb_typeof("evidenceJson") = 'object'
  );

CREATE TABLE "ClientCampaignSourceIdentity" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "clientCampaignId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "provider" "SourceLeadProvider" NOT NULL,
    "kind" "ClientCampaignIdentifierKind" NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "bindingStatus" "ClientCampaignSourceBindingStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCampaignSourceIdentity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientCampaignSourceIdentity_provider_kind_normalizedValue_active_idx"
  ON "ClientCampaignSourceIdentity"("provider", "kind", "normalizedValue", "active");

CREATE INDEX "ClientCampaignSourceIdentity_clientCampaignId_active_idx"
  ON "ClientCampaignSourceIdentity"("clientCampaignId", "active");

CREATE INDEX "ClientCampaignSourceIdentity_bindingId_idx"
  ON "ClientCampaignSourceIdentity"("bindingId");

CREATE INDEX "ClientCampaignSourceIdentity_clientAccountId_idx"
  ON "ClientCampaignSourceIdentity"("clientAccountId");

-- One approved active identity for a provider, kind, and exact value.
-- Recorded identities may coexist only until the service refuses the overlap.
-- The service refuses that overlap before insert. This index stops a race
-- from approving the same exact identity twice.
CREATE UNIQUE INDEX "ClientCampaignSourceIdentity_one_approved_key"
  ON "ClientCampaignSourceIdentity"("provider", "kind", "normalizedValue")
  WHERE "active" = true AND "bindingStatus" = 'approved';

ALTER TABLE "ClientCampaignSourceIdentity"
  ADD CONSTRAINT "ClientCampaignSourceIdentity_bindingId_fkey"
  FOREIGN KEY ("bindingId") REFERENCES "ClientCampaignSourceBinding"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignSourceIdentity"
  ADD CONSTRAINT "ClientCampaignSourceIdentity_clientCampaignId_fkey"
  FOREIGN KEY ("clientCampaignId") REFERENCES "ClientCampaign"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignSourceIdentity"
  ADD CONSTRAINT "ClientCampaignSourceIdentity_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignSourceIdentity"
  ADD CONSTRAINT "ClientCampaignSourceIdentity_value_chk"
  CHECK (
    "provider" <> 'unknown'
    AND char_length("normalizedValue") BETWEEN 1 AND 500
    AND "normalizedValue" = btrim("normalizedValue")
    AND position(' ' IN "normalizedValue") = 0
    AND position('?' IN "normalizedValue") = 0
    AND position('#' IN "normalizedValue") = 0
  );

CREATE TABLE "ClientCampaignDestinationSelection" (
    "id" TEXT NOT NULL,
    "clientCampaignId" TEXT NOT NULL,
    "clientGhlDestinationId" TEXT,
    "ghlLocationId" TEXT,
    "workflowIdGhl" TEXT,
    "workflowTriggerMode" TEXT,
    "workflowLiveVerified" BOOLEAN NOT NULL DEFAULT false,
    "companySheetsDestinationId" TEXT,
    "spreadsheetId" TEXT,
    "worksheetId" INTEGER,
    "worksheetTitle" TEXT,
    "mapPublished" BOOLEAN NOT NULL DEFAULT false,
    "readinessWarnings" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCampaignDestinationSelection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientCampaignDestinationSelection_clientCampaignId_key"
  ON "ClientCampaignDestinationSelection"("clientCampaignId");

CREATE INDEX "ClientCampaignDestinationSelection_clientGhlDestinationId_idx"
  ON "ClientCampaignDestinationSelection"("clientGhlDestinationId");

CREATE INDEX "ClientCampaignDestinationSelection_companySheetsDestinationId_idx"
  ON "ClientCampaignDestinationSelection"("companySheetsDestinationId");

ALTER TABLE "ClientCampaignDestinationSelection"
  ADD CONSTRAINT "ClientCampaignDestinationSelection_clientCampaignId_fkey"
  FOREIGN KEY ("clientCampaignId") REFERENCES "ClientCampaign"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignDestinationSelection"
  ADD CONSTRAINT "ClientCampaignDestinationSelection_clientGhlDestinationId_fkey"
  FOREIGN KEY ("clientGhlDestinationId") REFERENCES "ClientGhlDestination"("id")
  ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignDestinationSelection"
  ADD CONSTRAINT "ClientCampaignDestinationSelection_companySheetsDestinationId_fkey"
  FOREIGN KEY ("companySheetsDestinationId") REFERENCES "CompanySheetsDestination"("id")
  ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignDestinationSelection"
  ADD CONSTRAINT "ClientCampaignDestinationSelection_shape_chk"
  CHECK (
    "revision" >= 1
    AND "workflowLiveVerified" = false
    AND "mapPublished" = false
    AND ("actor" = 'ADMIN' OR "actor" ~ '^c[a-z0-9]{24}$')
    AND jsonb_typeof("readinessWarnings") = 'array'
    AND (
      "workflowTriggerMode" IS NULL
      OR "workflowTriggerMode" IN ('none', 'direct_api', 'tag_trigger')
    )
    AND (
      "workflowIdGhl" IS NULL
      OR (
        char_length("workflowIdGhl") BETWEEN 1 AND 200
        AND "workflowIdGhl" = btrim("workflowIdGhl")
        AND position(' ' IN "workflowIdGhl") = 0
      )
    )
    AND (
      "ghlLocationId" IS NULL
      OR (
        char_length("ghlLocationId") BETWEEN 1 AND 200
        AND "ghlLocationId" = btrim("ghlLocationId")
      )
    )
    AND (
      "spreadsheetId" IS NULL
      OR (
        char_length("spreadsheetId") BETWEEN 1 AND 200
        AND "spreadsheetId" = btrim("spreadsheetId")
      )
    )
    AND ("worksheetId" IS NULL OR "worksheetId" >= 0)
    AND (
      "worksheetTitle" IS NULL
      OR (
        char_length("worksheetTitle") BETWEEN 1 AND 120
        AND "worksheetTitle" = btrim("worksheetTitle")
      )
    )
  );

CREATE TABLE "ClientCampaignRegistryCommand" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "historicalClientAccountId" TEXT NOT NULL,
    "clientCampaignId" TEXT,
    "action" "ClientCampaignRegistryAction" NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCampaignRegistryCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientCampaignRegistryCommand_requestId_key"
  ON "ClientCampaignRegistryCommand"("requestId");

CREATE INDEX "ClientCampaignRegistryCommand_clientAccountId_createdAt_idx"
  ON "ClientCampaignRegistryCommand"("clientAccountId", "createdAt");

CREATE INDEX "ClientCampaignRegistryCommand_clientCampaignId_createdAt_idx"
  ON "ClientCampaignRegistryCommand"("clientCampaignId", "createdAt");

ALTER TABLE "ClientCampaignRegistryCommand"
  ADD CONSTRAINT "ClientCampaignRegistryCommand_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignRegistryCommand"
  ADD CONSTRAINT "ClientCampaignRegistryCommand_clientCampaignId_fkey"
  FOREIGN KEY ("clientCampaignId") REFERENCES "ClientCampaign"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ClientCampaignRegistryCommand"
  ADD CONSTRAINT "ClientCampaignRegistryCommand_shape_chk"
  CHECK (
    char_length("requestId") = 36
    AND "expectedRevision" >= 0
    AND "payloadHash" ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof("resultJson") = 'object'
    AND ("actor" = 'ADMIN' OR "actor" ~ '^c[a-z0-9]{24}$')
    AND char_length("historicalClientAccountId") BETWEEN 1 AND 128
  );

CREATE FUNCTION client_campaign_binding_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  active_count integer;
  approved_count integer;
BEGIN
  SELECT count(*) INTO active_count
  FROM "ClientCampaignSourceIdentity"
  WHERE "bindingId" = NEW."id" AND "active" = true;

  IF NEW."status" = 'suggested' AND active_count <> 0 THEN
    RAISE EXCEPTION 'suggested campaign binding cannot store an exact identity'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."status" IN ('recorded', 'approved') AND active_count < 1 THEN
    RAISE EXCEPTION 'campaign binding requires an exact identity before it leaves draft'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."status" = 'approved' THEN
    SELECT count(*) INTO approved_count
    FROM "ClientCampaignSourceIdentity"
    WHERE "bindingId" = NEW."id"
      AND "active" = true
      AND "bindingStatus" = 'approved';
    IF approved_count < 1 THEN
      RAISE EXCEPTION 'approved campaign binding requires an approved exact identity'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF NEW."status" = 'superseded' AND active_count <> 0 THEN
    RAISE EXCEPTION 'superseded campaign binding cannot keep an active identity'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE CONSTRAINT TRIGGER "ClientCampaignSourceBinding_identity_guard"
AFTER INSERT OR UPDATE ON "ClientCampaignSourceBinding"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION client_campaign_binding_identity_guard();

CREATE FUNCTION client_campaign_registry_command_guard()
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
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'ClientCampaignRegistryCommand is immutable'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "ClientCampaignRegistryCommand_immutable_guard"
BEFORE INSERT OR UPDATE ON "ClientCampaignRegistryCommand"
FOR EACH ROW
EXECUTE FUNCTION client_campaign_registry_command_guard();

COMMENT ON TABLE "ClientCampaign" IS
  'Request-only campaign configuration. Not a routing rule and not read by delivery.';

COMMENT ON TABLE "ClientCampaignSourceBinding" IS
  'Requested source evidence. approved does not confirm a source or create a routing rule.';

COMMENT ON TABLE "ClientCampaignSourceIdentity" IS
  'Exact source identifier for one binding. Not routing authority.';

COMMENT ON TABLE "ClientCampaignDestinationSelection" IS
  'Intended workflow and worksheet. Not a live enrollment and not a published sheet map.';

COMMENT ON TABLE "ClientCampaignRegistryCommand" IS
  'Idempotency and audit log for campaign registry commands. Not read by routing or delivery.';

-- Runtime grant for the new tables only. DELETE is withheld so the app role
-- cannot erase the audit or the saved request. There is no ALTER DEFAULT PRIVILEGES.
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
      public."ClientCampaign",
      public."ClientCampaignSourceBinding",
      public."ClientCampaignSourceIdentity",
      public."ClientCampaignDestinationSelection"
    TO sa360_app;
    GRANT SELECT, INSERT ON TABLE
      public."ClientCampaignRegistryCommand"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'client campaign registry grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'client campaign registry grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
