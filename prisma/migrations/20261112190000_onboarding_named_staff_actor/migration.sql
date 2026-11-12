-- Named staff may be stored on onboarding configuration requests.
--
-- ADMIN stays the shared-admin actor. A named actor is StaffPrincipal.id,
-- a Prisma cuid (c plus 24 lowercase letters or digits). Emails, display
-- names, and browser labels do not satisfy the check.
--
-- Existing rows are already ADMIN, so this does not rewrite them.
-- The immutability triggers still reject actor changes after insert.
-- ClientGhlDestination, CompanySheetsDestination, CampaignRoutingRule,
-- delivery flags, and integration settings are not touched.
--
-- ClientOnboardingSetupAuditEvent.actor is already unconstrained text.
-- This migration does not alter that table.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT
-- is the last. SET LOCAL lock_timeout applies only inside this transaction.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE "SourceCampaignAssociationRequest"
  DROP CONSTRAINT "SourceCampaignAssociationRequest_actor_chk";

ALTER TABLE "SourceCampaignAssociationRequest"
  ADD CONSTRAINT "SourceCampaignAssociationRequest_actor_chk"
  CHECK ("actor" = 'ADMIN' OR "actor" ~ '^c[a-z0-9]{24}$');

ALTER TABLE "GhlDestinationConfigurationRequest"
  DROP CONSTRAINT "GhlDestinationConfigurationRequest_actor_chk";

ALTER TABLE "GhlDestinationConfigurationRequest"
  ADD CONSTRAINT "GhlDestinationConfigurationRequest_actor_chk"
  CHECK ("actor" = 'ADMIN' OR "actor" ~ '^c[a-z0-9]{24}$');

ALTER TABLE "CompanySheetsDestinationConfigurationRequest"
  DROP CONSTRAINT "CompanySheetsDestConfigRequest_actor_chk";

ALTER TABLE "CompanySheetsDestinationConfigurationRequest"
  ADD CONSTRAINT "CompanySheetsDestConfigRequest_actor_chk"
  CHECK ("actor" = 'ADMIN' OR "actor" ~ '^c[a-z0-9]{24}$');

COMMIT;
