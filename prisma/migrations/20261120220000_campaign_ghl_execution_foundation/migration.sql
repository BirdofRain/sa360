-- Durable campaign GHL grants and operation receipts.
--
-- Additive. One transaction. No backfill. No rewrite of SourceLeadEvent,
-- ClientCampaignShadowDecision, GhlLiveDeliveryRun, or Sheets history.
-- A grant does not enroll a workflow. A receipt does not call GoHighLevel.
-- Routing and legacy delivery do not read these tables.
-- There is no GRANT ALL, no role change, and no ALTER DEFAULT PRIVILEGES.
--
-- This script owns its transaction. prisma migrate deploy sends it with
-- simple_query and does not add BEGIN or COMMIT.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "CampaignGhlGrantStatus" AS ENUM ('active', 'revoked', 'expired');

CREATE TYPE "CampaignGhlReceiptStatus" AS ENUM (
  'planned',
  'claimed',
  'completed',
  'failed_before_send',
  'ambiguous',
  'rejected',
  'skipped'
);

CREATE TABLE "CampaignGhlExecutionGrant" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "shadowDecisionId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "clientCampaignId" TEXT NOT NULL,
    "decisionVersion" INTEGER NOT NULL,
    "campaignRevision" INTEGER NOT NULL,
    "ghlLocationId" TEXT NOT NULL,
    "workflowIdGhl" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "status" "CampaignGhlGrantStatus" NOT NULL DEFAULT 'active',
    "authorizedByActor" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByActor" TEXT,
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignGhlExecutionGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignGhlExecutionGrant_requestId_key"
  ON "CampaignGhlExecutionGrant"("requestId");

CREATE INDEX "CampaignGhlExecutionGrant_sourceLeadEventId_clientCampaignId_decisionVersion_idx"
  ON "CampaignGhlExecutionGrant"("sourceLeadEventId", "clientCampaignId", "decisionVersion");

CREATE INDEX "CampaignGhlExecutionGrant_clientAccountId_createdAt_idx"
  ON "CampaignGhlExecutionGrant"("clientAccountId", "createdAt");

CREATE INDEX "CampaignGhlExecutionGrant_shadowDecisionId_idx"
  ON "CampaignGhlExecutionGrant"("shadowDecisionId");

-- One active grant for one frozen event, campaign, revision, location, workflow, and hash.
-- A revoked row stays for audit and does not occupy this key.
CREATE UNIQUE INDEX "CampaignGhlExecutionGrant_one_active_scope"
  ON "CampaignGhlExecutionGrant"(
    "sourceLeadEventId",
    "clientCampaignId",
    "decisionVersion",
    "campaignRevision",
    "ghlLocationId",
    "workflowIdGhl",
    "configurationHash"
  )
  WHERE "status" = 'active';

ALTER TABLE "CampaignGhlExecutionGrant"
  ADD CONSTRAINT "CampaignGhlExecutionGrant_sourceLeadEventId_fkey"
  FOREIGN KEY ("sourceLeadEventId") REFERENCES "SourceLeadEvent"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CampaignGhlExecutionGrant"
  ADD CONSTRAINT "CampaignGhlExecutionGrant_shadowDecisionId_fkey"
  FOREIGN KEY ("shadowDecisionId") REFERENCES "ClientCampaignShadowDecision"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CampaignGhlExecutionGrant"
  ADD CONSTRAINT "CampaignGhlExecutionGrant_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CampaignGhlExecutionGrant"
  ADD CONSTRAINT "CampaignGhlExecutionGrant_clientCampaignId_fkey"
  FOREIGN KEY ("clientCampaignId") REFERENCES "ClientCampaign"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "CampaignGhlExecutionReceipt" (
    "id" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "clientCampaignId" TEXT NOT NULL,
    "decisionVersion" INTEGER NOT NULL,
    "ghlLocationId" TEXT NOT NULL,
    "workflowIdGhl" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" "CampaignGhlReceiptStatus" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "externalAttempted" BOOLEAN NOT NULL DEFAULT false,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "httpStatus" INTEGER,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "detailJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignGhlExecutionReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CampaignGhlExecutionReceipt_operation_check" CHECK (
      "operation" IN (
        'contact',
        'custom_fields',
        'source_attributes',
        'note',
        'tags',
        'workflow',
        'opportunity',
        'first_touch'
      )
    )
);

CREATE UNIQUE INDEX "CampaignGhlExecutionReceipt_idempotencyKey_key"
  ON "CampaignGhlExecutionReceipt"("idempotencyKey");

CREATE UNIQUE INDEX "CampaignGhlExecutionReceipt_scope_operation_key"
  ON "CampaignGhlExecutionReceipt"(
    "sourceLeadEventId",
    "clientCampaignId",
    "decisionVersion",
    "ghlLocationId",
    "workflowIdGhl",
    "operation"
  );

CREATE INDEX "CampaignGhlExecutionReceipt_clientAccountId_createdAt_idx"
  ON "CampaignGhlExecutionReceipt"("clientAccountId", "createdAt");

CREATE INDEX "CampaignGhlExecutionReceipt_status_updatedAt_idx"
  ON "CampaignGhlExecutionReceipt"("status", "updatedAt");

ALTER TABLE "CampaignGhlExecutionReceipt"
  ADD CONSTRAINT "CampaignGhlExecutionReceipt_sourceLeadEventId_fkey"
  FOREIGN KEY ("sourceLeadEventId") REFERENCES "SourceLeadEvent"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CampaignGhlExecutionReceipt"
  ADD CONSTRAINT "CampaignGhlExecutionReceipt_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CampaignGhlExecutionReceipt"
  ADD CONSTRAINT "CampaignGhlExecutionReceipt_clientCampaignId_fkey"
  FOREIGN KEY ("clientCampaignId") REFERENCES "ClientCampaign"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION campaign_ghl_execution_grant_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
     OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
     OR NEW."sourceLeadEventId" IS DISTINCT FROM OLD."sourceLeadEventId"
     OR NEW."shadowDecisionId" IS DISTINCT FROM OLD."shadowDecisionId"
     OR NEW."clientAccountId" IS DISTINCT FROM OLD."clientAccountId"
     OR NEW."clientCampaignId" IS DISTINCT FROM OLD."clientCampaignId"
     OR NEW."decisionVersion" IS DISTINCT FROM OLD."decisionVersion"
     OR NEW."campaignRevision" IS DISTINCT FROM OLD."campaignRevision"
     OR NEW."ghlLocationId" IS DISTINCT FROM OLD."ghlLocationId"
     OR NEW."workflowIdGhl" IS DISTINCT FROM OLD."workflowIdGhl"
     OR NEW."configurationHash" IS DISTINCT FROM OLD."configurationHash"
     OR NEW."authorizedByActor" IS DISTINCT FROM OLD."authorizedByActor"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'campaign ghl grant identity is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'revoked' AND NEW.status IS DISTINCT FROM 'revoked' THEN
    RAISE EXCEPTION 'a revoked campaign ghl grant cannot be restored'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'expired' AND NEW.status IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'an expired campaign ghl grant cannot be restored'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'active' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'active' AND NEW.status IN ('revoked', 'expired') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'campaign ghl grant status transition is not allowed'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "CampaignGhlExecutionGrant_guard"
BEFORE UPDATE ON "CampaignGhlExecutionGrant"
FOR EACH ROW
EXECUTE FUNCTION campaign_ghl_execution_grant_guard();

CREATE FUNCTION campaign_ghl_execution_receipt_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW.simulated IS TRUE AND NEW.status = 'completed' THEN
    RAISE EXCEPTION 'simulated campaign ghl receipts cannot be external completions'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'completed' AND NEW."externalAttempted" IS NOT TRUE THEN
    RAISE EXCEPTION 'completed campaign ghl receipts require an external attempt'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status IN ('completed', 'ambiguous', 'rejected') THEN
    RAISE EXCEPTION 'campaign ghl send results must update a claim'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."sourceLeadEventId" IS DISTINCT FROM OLD."sourceLeadEventId"
     OR NEW."clientAccountId" IS DISTINCT FROM OLD."clientAccountId"
     OR NEW."clientCampaignId" IS DISTINCT FROM OLD."clientCampaignId"
     OR NEW."decisionVersion" IS DISTINCT FROM OLD."decisionVersion"
     OR NEW."ghlLocationId" IS DISTINCT FROM OLD."ghlLocationId"
     OR NEW."workflowIdGhl" IS DISTINCT FROM OLD."workflowIdGhl"
     OR NEW.operation IS DISTINCT FROM OLD.operation
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
  THEN
    RAISE EXCEPTION 'campaign ghl receipt identity is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'planned' AND NEW.status IN ('claimed', 'skipped') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'claimed' AND NEW.status IN ('completed', 'failed_before_send', 'ambiguous', 'rejected', 'skipped') THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('failed_before_send', 'skipped') AND NEW.status = 'claimed' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'campaign ghl receipt status transition is not allowed'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "CampaignGhlExecutionReceipt_guard"
BEFORE INSERT OR UPDATE ON "CampaignGhlExecutionReceipt"
FOR EACH ROW
EXECUTE FUNCTION campaign_ghl_execution_receipt_guard();

COMMENT ON TABLE "CampaignGhlExecutionGrant" IS
  'Operator grant for one frozen campaign GHL operation. Not an execution.';

COMMENT ON TABLE "CampaignGhlExecutionReceipt" IS
  'Campaign-scoped GHL operation ledger. Not a legacy live-delivery receipt.';

-- SELECT, INSERT, and UPDATE only. DELETE stays with the table owner.
-- Loopback databases can migrate before sa360_app exists.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public."CampaignGhlExecutionGrant",
      public."CampaignGhlExecutionReceipt"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'campaign ghl execution grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'campaign ghl execution grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
