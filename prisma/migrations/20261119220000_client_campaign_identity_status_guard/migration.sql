-- Tighten the request-only campaign identity guard.
--
-- The registry migration already refuses a suggested binding with an identity,
-- a recorded or approved binding with no identity, and an update of the command log.
-- This file adds the missing direction: an active identity cannot carry a different
-- status from its binding, and its client and campaign ids cannot diverge.
--
-- No table is added. No existing operational table is rewritten. No backfill.
-- ClientCampaignSourceIdentity_one_approved_key is not dropped.
-- ClientCampaignRegistryCommand_immutable_guard is not dropped.
-- There is no GRANT, no role change, and no ALTER DEFAULT PRIVILEGES.
--
-- This script owns its transaction. prisma migrate deploy sends it with
-- simple_query and does not add BEGIN or COMMIT. Replacing the function and
-- adding the identity trigger take a short lock on the new, empty tables.
-- A failed statement rolls this transaction back and leaves the previous guard.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION client_campaign_binding_identity_guard()
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

  IF EXISTS (
    SELECT 1
    FROM "ClientCampaignSourceIdentity" AS identity_row
    WHERE identity_row."bindingId" = NEW."id"
      AND identity_row."active" = true
      AND identity_row."bindingStatus" IS DISTINCT FROM NEW."status"
  ) THEN
    RAISE EXCEPTION 'active campaign identity status must match its binding'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ClientCampaignSourceIdentity" AS identity_row
    JOIN "ClientCampaign" AS campaign
      ON campaign."id" = NEW."clientCampaignId"
    WHERE identity_row."bindingId" = NEW."id"
      AND (
        identity_row."clientCampaignId" IS DISTINCT FROM NEW."clientCampaignId"
        OR identity_row."clientAccountId" IS DISTINCT FROM campaign."clientAccountId"
      )
  ) THEN
    RAISE EXCEPTION 'campaign identity client must match the campaign'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION client_campaign_identity_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  binding_status "ClientCampaignSourceBindingStatus";
  binding_campaign text;
  campaign_client text;
BEGIN
  SELECT binding."status", binding."clientCampaignId"
    INTO binding_status, binding_campaign
  FROM "ClientCampaignSourceBinding" AS binding
  WHERE binding."id" = NEW."bindingId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign identity requires its binding'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."clientCampaignId" IS DISTINCT FROM binding_campaign THEN
    RAISE EXCEPTION 'campaign identity campaign must match its binding'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT campaign."clientAccountId"
    INTO campaign_client
  FROM "ClientCampaign" AS campaign
  WHERE campaign."id" = NEW."clientCampaignId";

  IF campaign_client IS DISTINCT FROM NEW."clientAccountId" THEN
    RAISE EXCEPTION 'campaign identity client must match the campaign'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."active" AND NEW."bindingStatus" IS DISTINCT FROM binding_status THEN
    RAISE EXCEPTION 'active campaign identity status must match its binding'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE CONSTRAINT TRIGGER "ClientCampaignSourceIdentity_status_guard"
AFTER INSERT OR UPDATE ON "ClientCampaignSourceIdentity"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION client_campaign_identity_row_guard();

COMMIT;
