-- Observational client-campaign shadow decisions.
--
-- One immutable row per source lead event and decision version.
-- No existing operational table is rewritten. No backfill.
-- Routing, GoHighLevel, Company Sheets, and payment do not read this table.
-- There is no GRANT ALL, no role change, and no ALTER DEFAULT PRIVILEGES.
--
-- This script owns its transaction. prisma migrate deploy sends it with
-- simple_query and does not add BEGIN or COMMIT.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "ClientCampaignShadowStatus" AS ENUM ('MATCHED', 'UNRESOLVED', 'REVIEW_REQUIRED');

CREATE TYPE "ClientCampaignNicheClassificationStatus" AS ENUM ('MATCH', 'MISSING', 'CONFLICT', 'UNRESOLVED');

CREATE TABLE "ClientCampaignShadowDecision" (
    "id" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "decisionVersion" INTEGER NOT NULL,
    "status" "ClientCampaignShadowStatus" NOT NULL,
    "clientAccountId" TEXT,
    "clientCampaignId" TEXT,
    "campaignRevision" INTEGER,
    "campaignSlug" TEXT,
    "campaignDisplayName" TEXT,
    "campaignStatus" TEXT,
    "configuredNicheKey" TEXT,
    "configuredProductType" TEXT,
    "winningRoutingAuthority" TEXT,
    "matchType" TEXT,
    "provider" TEXT,
    "matchedBindingIds" JSONB NOT NULL,
    "reviewCandidateCampaignIds" JSONB NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "sourceEvidenceJson" JSONB NOT NULL,
    "incomingNicheJson" JSONB NOT NULL,
    "nicheClassificationStatus" "ClientCampaignNicheClassificationStatus" NOT NULL,
    "leadTypeDecisionJson" JSONB NOT NULL,
    "proposedTagsJson" JSONB NOT NULL,
    "destinationSelectionJson" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCampaignShadowDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientCampaignShadowDecision_sourceLeadEventId_decisionVersion_key"
  ON "ClientCampaignShadowDecision"("sourceLeadEventId", "decisionVersion");

CREATE INDEX "ClientCampaignShadowDecision_clientAccountId_evaluatedAt_idx"
  ON "ClientCampaignShadowDecision"("clientAccountId", "evaluatedAt");

CREATE INDEX "ClientCampaignShadowDecision_status_evaluatedAt_idx"
  ON "ClientCampaignShadowDecision"("status", "evaluatedAt");

ALTER TABLE "ClientCampaignShadowDecision"
  ADD CONSTRAINT "ClientCampaignShadowDecision_sourceLeadEventId_fkey"
  FOREIGN KEY ("sourceLeadEventId") REFERENCES "SourceLeadEvent"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION client_campaign_shadow_decision_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'client campaign shadow decisions are immutable'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "ClientCampaignShadowDecision_immutable_guard"
BEFORE UPDATE OR DELETE ON "ClientCampaignShadowDecision"
FOR EACH ROW
EXECUTE FUNCTION client_campaign_shadow_decision_immutable();

COMMENT ON TABLE "ClientCampaignShadowDecision" IS
  'Frozen observational campaign resolution. Not read by routing or delivery.';

-- SELECT and INSERT only. UPDATE and DELETE stay with the table owner.
-- Loopback databases can migrate before sa360_app exists.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT ON TABLE public."ClientCampaignShadowDecision" TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'client campaign shadow grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'client campaign shadow grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
