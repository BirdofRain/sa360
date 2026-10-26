-- Production Boundary A. Version-pinned candidate. Do not execute without a
-- separate approval. This file is not a Prisma migration, not a seed, and not
-- a deploy step.
--
-- Approved identity: database defaultdb, installer doadmin, PostgreSQL 18.
-- The disposable proof creates that same identity on loopback PostgreSQL 18.6.
-- prepare-ownership.sql stays the test-database-only script and is unchanged.
--
-- One transaction. On PostgreSQL 18, CREATE ROLE and GRANT membership roll
-- back with the transaction. Run it with ON_ERROR_STOP=1. If any statement
-- errors, do not issue another COMMIT from a new session; an aborted
-- transaction rolls back when the session ends.
--
-- No password is set. sa360_app cannot authenticate until a later approval
-- stores a password outside Git. DigitalOcean control-panel user creation is
-- not part of this transaction and is not undone by ROLLBACK.
--
-- The audited table, sequence, and routine body matches prepare-ownership.sql.
-- Summary readiness stays false. No summary routine or trigger is installed.

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
DECLARE
  v_bad integer;
BEGIN
  IF current_database() IS DISTINCT FROM 'defaultdb'
     OR current_user IS DISTINCT FROM 'doadmin' THEN
    RAISE EXCEPTION 'boundary A refused: installer must be doadmin on defaultdb';
  END IF;
  IF current_setting('server_version_num')::integer / 10000 <> 18 THEN
    RAISE EXCEPTION 'boundary A refused: PostgreSQL 18 is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'doadmin'
      AND rolcanlogin
      AND NOT rolsuper
      AND rolinherit
      AND rolcreaterole
      AND rolcreatedb
      AND rolreplication
      AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'boundary A refused: doadmin attributes changed';
  END IF;
  IF (
    SELECT coalesce(string_agg(rolname, ',' ORDER BY rolname), '')
    FROM pg_roles
    WHERE rolcanlogin
  ) IS DISTINCT FROM '_doadmin_monitor,_dodb,_dodb_repl,_dodb_rewind,doadmin,postgres' THEN
    RAISE EXCEPTION 'boundary A refused: login roles changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'postgres' AND rolsuper AND rolcanlogin
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = '_dodb' AND rolsuper AND rolcanlogin AND rolreplication
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = '_doadmin_monitor' AND rolcanlogin AND NOT rolsuper AND NOT rolreplication
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = '_dodb_repl' AND rolcanlogin AND NOT rolsuper AND rolreplication
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = '_dodb_rewind' AND rolcanlogin AND NOT rolsuper AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'boundary A refused: platform login attributes changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member_role ON member_role.oid = membership.member
    JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = 'doadmin'
      AND granted_role.rolname = 'doadmin_group'
      AND membership.inherit_option
      AND membership.set_option
  ) THEN
    RAISE EXCEPTION 'boundary A refused: doadmin is not a member of doadmin_group';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname LIKE 'sa360%') THEN
    RAISE EXCEPTION 'boundary A refused: a sa360 role already exists';
  END IF;
  IF pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname = current_database()))
       IS DISTINCT FROM 'doadmin' THEN
    RAISE EXCEPTION 'boundary A refused: database owner is not doadmin';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_namespace
    WHERE nspname = 'public'
      AND pg_get_userbyid(nspowner) = 'pg_database_owner'
  ) OR has_schema_privilege('public', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'boundary A refused: public schema ownership or CREATE grant changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'sa360_summary') THEN
    RAISE EXCEPTION 'boundary A refused: schema sa360_summary already exists';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND state = 'idle in transaction'
      AND pid <> pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'boundary A refused: a transaction is already open';
  END IF;
  IF (
    SELECT count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    FROM public._prisma_migrations
  ) <> 0 THEN
    RAISE EXCEPTION 'boundary A refused: a migration is unfinished or failed';
  END IF;
  IF (SELECT count(*) FROM pg_default_acl) <> 0 THEN
    RAISE EXCEPTION 'boundary A refused: pg_default_acl is not empty';
  END IF;
  IF (
    SELECT count(*)
    FROM public.historical_catalog_summary_control
    WHERE singleton
      AND summary_ready = false
      AND summary_epoch = 0
      AND reconciled_epoch IS NULL
      AND failure_count = 0
  ) <> 1
  OR (SELECT count(*) FROM public.historical_catalog_summary_control) <> 1
  OR (SELECT count(*) FROM public.historical_catalog_summary_label) <> 0
  OR (SELECT count(*) FROM public.historical_catalog_summary_bucket) <> 0
  OR (SELECT count(*) FROM public.historical_catalog_summary_membership) <> 0
  OR (SELECT count(*) FROM public.historical_catalog_summary_checkpoint) <> 0 THEN
    RAISE EXCEPTION 'boundary A refused: summary control or counts changed';
  END IF;
  IF (
    SELECT count(*)
    FROM public.historical_catalog_projection_control
    WHERE singleton
      AND ready
      AND source_row_count IS NOT NULL
      AND projection_row_count IS NOT NULL
      AND source_row_count = projection_row_count
      AND source_row_count > 0
  ) <> 1
  OR (SELECT count(*) FROM public.historical_catalog_projection_control) <> 1 THEN
    RAISE EXCEPTION 'boundary A refused: projection readiness or matched counts changed';
  END IF;
  IF (
    SELECT coalesce(string_agg(trigger.tgname || ':' || trigger.tgenabled::text, ',' ORDER BY trigger.tgname), '')
    FROM pg_trigger AS trigger
    JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE NOT trigger.tgisinternal
      AND namespace.nspname = 'public'
      AND (
        trigger.tgname LIKE 'historical_catalog_projection_%'
        OR trigger.tgname LIKE 'historical_catalog_summary_%'
      )
  ) IS DISTINCT FROM 'historical_catalog_projection_event_refresh:O,historical_catalog_projection_item_refresh:O,historical_catalog_projection_lot_refresh:O' THEN
    RAISE EXCEPTION 'boundary A refused: projection or summary triggers changed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.proname LIKE 'historical_catalog_summary_%'
  ) THEN
    RAISE EXCEPTION 'boundary A refused: a summary routine is already installed';
  END IF;

  WITH live AS (
    SELECT relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
      AND pg_get_userbyid(relation.relowner) = 'doadmin'
  ), expected(relname) AS (
    VALUES
    ('AdminRuntimeSetting'),
    ('AgedInventoryOpsVerifyAction'),
    ('AgedInventorySourceSnapshot'),
    ('AgentWorkspaceAction'),
    ('BulkLeadImport'),
    ('BulkLeadImportMappingTemplate'),
    ('BulkLeadImportRow'),
    ('BuyerDeliveredIdentity'),
    ('BuyerExternalDeliveryImportBatch'),
    ('BuyerExternalDeliveryReceipt'),
    ('CampaignRoutingRule'),
    ('ClientAccount'),
    ('ClientChannelProfileConfig'),
    ('ClientConfig'),
    ('ClientGhlDestination'),
    ('ClientOnboardingSetup'),
    ('ClientOnboardingSetupAuditEvent'),
    ('ClientProfileGhlMirrorLog'),
    ('ClientScriptAssignment'),
    ('CompanyGoogleConnection'),
    ('CompanyGoogleOAuthPendingAuth'),
    ('CompanySheetsDeliveryJob'),
    ('CompanySheetsDeliveryRow'),
    ('CompanySheetsDestination'),
    ('CompanySheetsDispatchIntent'),
    ('CompanySheetsOrderDeliveryEvidence'),
    ('CompanySheetsTabContract'),
    ('CompanySheetsWorksheetLock'),
    ('CompanySpreadsheetCreation'),
    ('ContactGuidanceEvent'),
    ('DeliveryAttempt'),
    ('DeliveryInstruction'),
    ('DeliveryRuntimeModeAuditEvent'),
    ('DeliveryRuntimeModeSetting'),
    ('DeliveryTarget'),
    ('FulfillmentOutbox'),
    ('GhlDeliveryAdapterRun'),
    ('GhlDeliveryAdapterStepRun'),
    ('GhlLiveDeliveryRun'),
    ('GhlLiveDeliveryStepRun'),
    ('GhlLocationConfigSnapshot'),
    ('GhlLocationConnection'),
    ('GhlOAuthPendingInstall'),
    ('GoogleAccountConnection'),
    ('GoogleOAuthPendingAuth'),
    ('GuidanceResource'),
    ('InboundContactIndex'),
    ('InventoryLot'),
    ('KanbanBoard'),
    ('KanbanCard'),
    ('LeadAllocation'),
    ('LeadAttribution'),
    ('LeadCaptureTrustSyncAuditEvent'),
    ('LeadDeliveryExportPackage'),
    ('LeadDeliveryPlan'),
    ('LeadDeliveryPlanStep'),
    ('LeadDuplicateRiskAssessment'),
    ('LeadEligibilityAssessment'),
    ('LeadInventoryFacetBuild'),
    ('LeadInventoryFacetSupplyAggregate'),
    ('LeadInventoryImportBatch'),
    ('LeadInventoryItem'),
    ('LeadInventoryReviewAction'),
    ('LeadInventoryReviewItemResult'),
    ('LeadOrder'),
    ('LeadOrderLine'),
    ('LeadProof'),
    ('LeadProofArtifact'),
    ('LeadProofReviewAuditEvent'),
    ('LeadReplacementRequest'),
    ('LeadSourceSnapshot'),
    ('LeadVerificationApprovalAuditEvent'),
    ('LeadVerificationResult'),
    ('Lf2CheckpointAAuditEvent'),
    ('LifecycleEvent'),
    ('MetaDispatchAttempt'),
    ('ObjectionPlaybook'),
    ('PplOperatorReviewBatch'),
    ('PplOperatorReviewItem'),
    ('PplSupplementalExport'),
    ('ProtectedAgentExclusion'),
    ('RoutingDryRunDecision'),
    ('SourceFunnel'),
    ('SourceLeadEvent'),
    ('SourceRouteSchemaSnapshot'),
    ('SupportTicket'),
    ('SynthflowOutboundResultLog'),
    ('SynthflowRequestLog'),
    ('WebhookRequestLog'),
    ('historical_catalog_projection'),
    ('HistoricalCampaignAlias'),
    ('LeadAgeBandDefinition'),
    ('historical_catalog_projection_control'),
    ('historical_catalog_projection_source'),
    ('_prisma_migrations'),
    ('ConsentDisclosureVersion'),
    ('FailedDispatch'),
    ('GuidanceResourceVersion'),
    ('HistoricalCampaignAliasEvent'),
    ('HistoricalResaleAuthorization'),
    ('HistoricalResaleAuthorizationEvent'),
    ('historical_catalog_summary_label'),
    ('historical_catalog_summary_bucket'),
    ('historical_catalog_summary_membership'),
    ('historical_catalog_summary_checkpoint'),
    ('historical_catalog_summary_control')
  )
  SELECT count(*) INTO v_bad
  FROM (
    SELECT relname FROM live
    EXCEPT
    SELECT relname FROM expected
    UNION ALL
    SELECT relname FROM expected
    EXCEPT
    SELECT relname FROM live
  ) AS diff;
  IF v_bad <> 0 OR (
    SELECT count(*)
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
  ) <> 106 THEN
    RAISE EXCEPTION 'boundary A refused: public relation inventory changed';
  END IF;

  WITH live AS (
    SELECT relation.relname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind = 'S'
      AND pg_get_userbyid(relation.relowner) = 'doadmin'
  ), expected(relname) AS (
    VALUES
    ('SupportTicket_ticketNumber_seq'),
    ('historical_catalog_summary_bucket_bucket_id_seq'),
    ('historical_catalog_summary_checkpoint_chunk_id_seq'),
    ('historical_catalog_summary_label_label_pair_id_seq')
  )
  SELECT count(*) INTO v_bad
  FROM (
    SELECT relname FROM live
    EXCEPT
    SELECT relname FROM expected
    UNION ALL
    SELECT relname FROM expected
    EXCEPT
    SELECT relname FROM live
  ) AS diff;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'boundary A refused: sequence inventory or ownership changed';
  END IF;

  WITH live AS (
    SELECT routine.proname,
           pg_get_function_identity_arguments(routine.oid) AS identity_args,
           pg_get_userbyid(routine.proowner) AS owner_name
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND NOT routine.prosecdef
      AND routine.proacl IS NULL
      AND has_function_privilege('public', routine.oid, 'EXECUTE')
  ), expected(proname, identity_args, owner_name) AS (
    VALUES
    ('historical_catalog_projection_refresh_item', 'p_item_id text', 'doadmin'),
    ('historical_catalog_projection_item_trg', '', 'doadmin'),
    ('historical_catalog_projection_event_trg', '', 'doadmin'),
    ('historical_catalog_projection_lot_trg', '', 'doadmin'),
    ('historical_july_campaign_label_normalize', 'p_label text', 'doadmin'),
    ('historical_registry_scope_key_kind', 'p_key text', 'doadmin'),
    ('historical_campaign_ownership_decision', 'p_lot_key text, p_import_request_key text, p_july_label text', 'doadmin'),
    ('historical_catalog_projection_diff', 'p_after text, p_until text, p_limit integer', 'doadmin'),
    ('historical_catalog_projection_backfill_chunk', 'IN p_after text, IN p_until text', 'doadmin'),
    ('historical_alias_evidence_reference_ok', 'p_type text, p_reference text', 'doadmin'),
    ('historical_resale_evidence_reference_ok', 'p_type text, p_reference text', 'doadmin'),
    ('historical_registry_assign_event_sequence', '', 'doadmin'),
    ('historical_registry_reject_event_mutation', '', 'doadmin'),
    ('historical_registry_reject_parent_delete', '', 'doadmin'),
    ('historical_campaign_alias_guard_identity', '', 'doadmin'),
    ('historical_resale_guard_identity', '', 'doadmin'),
    ('historical_campaign_alias_assert_history', 'p_alias_id text', 'doadmin'),
    ('historical_resale_authorization_assert_history', 'p_authorization_id text', 'doadmin'),
    ('historical_campaign_alias_history_trigger', '', 'doadmin'),
    ('historical_campaign_alias_event_history_trigger', '', 'doadmin'),
    ('historical_resale_history_trigger', '', 'doadmin'),
    ('historical_resale_event_history_trigger', '', 'doadmin'),
    ('historical_resale_posture', 'p_scope_type text, p_scope_key text, p_evaluated_at timestamp without time zone', 'doadmin'),
    ('historical_resale_authorization_decision', 'p_lot_key text, p_import_request_key text, p_evaluated_at timestamp with time zone', 'doadmin'),
    ('armor', 'bytea', 'postgres'),
    ('armor', 'bytea, text[], text[]', 'postgres'),
    ('crypt', 'text, text', 'postgres'),
    ('dearmor', 'text', 'postgres'),
    ('decrypt', 'bytea, bytea, text', 'postgres'),
    ('decrypt_iv', 'bytea, bytea, bytea, text', 'postgres'),
    ('digest', 'bytea, text', 'postgres'),
    ('digest', 'text, text', 'postgres'),
    ('encrypt', 'bytea, bytea, text', 'postgres'),
    ('encrypt_iv', 'bytea, bytea, bytea, text', 'postgres'),
    ('fips_mode', '', 'postgres'),
    ('gen_random_bytes', 'integer', 'postgres'),
    ('gen_random_uuid', '', 'postgres'),
    ('gen_salt', 'text', 'postgres'),
    ('gen_salt', 'text, integer', 'postgres'),
    ('hmac', 'bytea, bytea, text', 'postgres'),
    ('hmac', 'text, text, text', 'postgres'),
    ('pgp_armor_headers', 'text, OUT key text, OUT value text', 'postgres'),
    ('pgp_key_id', 'bytea', 'postgres'),
    ('pgp_pub_decrypt', 'bytea, bytea', 'postgres'),
    ('pgp_pub_decrypt', 'bytea, bytea, text', 'postgres'),
    ('pgp_pub_decrypt', 'bytea, bytea, text, text', 'postgres'),
    ('pgp_pub_decrypt_bytea', 'bytea, bytea', 'postgres'),
    ('pgp_pub_decrypt_bytea', 'bytea, bytea, text', 'postgres'),
    ('pgp_pub_decrypt_bytea', 'bytea, bytea, text, text', 'postgres'),
    ('pgp_pub_encrypt', 'text, bytea', 'postgres'),
    ('pgp_pub_encrypt', 'text, bytea, text', 'postgres'),
    ('pgp_pub_encrypt_bytea', 'bytea, bytea', 'postgres'),
    ('pgp_pub_encrypt_bytea', 'bytea, bytea, text', 'postgres'),
    ('pgp_sym_decrypt', 'bytea, text', 'postgres'),
    ('pgp_sym_decrypt', 'bytea, text, text', 'postgres'),
    ('pgp_sym_decrypt_bytea', 'bytea, text', 'postgres'),
    ('pgp_sym_decrypt_bytea', 'bytea, text, text', 'postgres'),
    ('pgp_sym_encrypt', 'text, text', 'postgres'),
    ('pgp_sym_encrypt', 'text, text, text', 'postgres'),
    ('pgp_sym_encrypt_bytea', 'bytea, text', 'postgres'),
    ('pgp_sym_encrypt_bytea', 'bytea, text, text', 'postgres')
  )
  SELECT count(*) INTO v_bad
  FROM (
    SELECT proname, identity_args, owner_name FROM live
    EXCEPT
    SELECT proname, identity_args, owner_name FROM expected
    UNION ALL
    SELECT proname, identity_args, owner_name FROM expected
    EXCEPT
    SELECT proname, identity_args, owner_name FROM live
  ) AS diff;
  IF v_bad <> 0 OR (SELECT count(*) FROM pg_proc AS routine JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace WHERE namespace.nspname = 'public') <> 61 THEN
    RAISE EXCEPTION 'boundary A refused: routine inventory, owner, or PUBLIC execute changed';
  END IF;
END
$guard$;

-- stage:during-roles

CREATE ROLE sa360_schema_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
CREATE ROLE sa360_summary_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
CREATE ROLE sa360_summary_operator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
CREATE ROLE sa360_summary_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
CREATE ROLE sa360_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

-- stage:after-roles

GRANT sa360_summary_runtime TO sa360_app WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
GRANT sa360_schema_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT sa360_summary_operator TO CURRENT_USER WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

-- stage:after-membership

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO sa360_app, sa360_schema_owner, sa360_summary_runtime,
  sa360_summary_operator, sa360_summary_reader;
GRANT CREATE ON SCHEMA public TO sa360_schema_owner;
REVOKE CREATE ON SCHEMA public FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader;

CREATE SCHEMA IF NOT EXISTS sa360_summary;
REVOKE ALL ON SCHEMA sa360_summary FROM PUBLIC;
REVOKE ALL ON SCHEMA sa360_summary FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader;
ALTER SCHEMA sa360_summary OWNER TO sa360_schema_owner;

-- Table and sequence default revokes remove a recorded GRANT for this role.
-- They are not a substitute for the explicit lists below.
-- Do not add a schema-scoped or global REVOKE ON FUNCTIONS here.
-- On PostgreSQL 18.6, ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ON
-- FUNCTIONS FROM PUBLIC is not recorded and leaves the built-in PUBLIC
-- EXECUTE default in place. A global REVOKE would change every future
-- routine created by the migration role. Privileged routines must
-- REVOKE EXECUTE FROM PUBLIC in the same transaction as CREATE.
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  REVOKE ALL ON TABLES FROM sa360_app, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM sa360_app, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA sa360_summary
  REVOKE ALL ON TABLES FROM sa360_app, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA sa360_summary
  REVOKE ALL ON SEQUENCES FROM sa360_app, PUBLIC;

-- Strip an older blanket grant if this script is re-run. Read-only tables
-- are granted again below. These objects stay migration- or operator-only:
--   _prisma_migrations                         Prisma migrate history
--   historical_catalog_projection_control      readiness and verification
--   historical_catalog_summary_*               summary maintenance
--   HistoricalResaleAuthorization*             no production writer; rekey must not touch them
--   HistoricalCampaignAliasEvent               registry append log, tests only
--   ConsentDisclosureVersion                   no production reference
--   GuidanceResourceVersion                    seed script only, not the API login
--   FailedDispatch                             no production reference
REVOKE ALL ON TABLE
-- app-deny:start
  public._prisma_migrations,
  public."ConsentDisclosureVersion",
  public."FailedDispatch",
  public."GuidanceResourceVersion",
  public."HistoricalCampaignAliasEvent",
  public."HistoricalResaleAuthorization",
  public."HistoricalResaleAuthorizationEvent",
-- app-deny:end
  public.historical_catalog_projection_control,
  public.historical_catalog_summary_label,
  public.historical_catalog_summary_bucket,
  public.historical_catalog_summary_membership,
  public.historical_catalog_summary_checkpoint,
  public.historical_catalog_summary_control
FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader, PUBLIC;

-- app-dml:start
-- Audited from production API, worker, portal, Sheets, intake, ordering,
-- fulfillment, client rekey, and the invoker projection triggers.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."AdminRuntimeSetting",
  public."AgedInventoryOpsVerifyAction",
  public."AgedInventorySourceSnapshot",
  public."AgentWorkspaceAction",
  public."BulkLeadImport",
  public."BulkLeadImportMappingTemplate",
  public."BulkLeadImportRow",
  public."BuyerDeliveredIdentity",
  public."BuyerExternalDeliveryImportBatch",
  public."BuyerExternalDeliveryReceipt",
  public."CampaignRoutingRule",
  public."ClientAccount",
  public."ClientChannelProfileConfig",
  public."ClientConfig",
  public."ClientGhlDestination",
  public."ClientOnboardingSetup",
  public."ClientOnboardingSetupAuditEvent",
  public."ClientProfileGhlMirrorLog",
  public."ClientScriptAssignment",
  public."CompanyGoogleConnection",
  public."CompanyGoogleOAuthPendingAuth",
  public."CompanySheetsDeliveryJob",
  public."CompanySheetsDeliveryRow",
  public."CompanySheetsDestination",
  public."CompanySheetsDispatchIntent",
  public."CompanySheetsOrderDeliveryEvidence",
  public."CompanySheetsTabContract",
  public."CompanySheetsWorksheetLock",
  public."CompanySpreadsheetCreation",
  public."ContactGuidanceEvent",
  public."DeliveryAttempt",
  public."DeliveryInstruction",
  public."DeliveryRuntimeModeAuditEvent",
  public."DeliveryRuntimeModeSetting",
  public."DeliveryTarget",
  public."FulfillmentOutbox",
  public."GhlDeliveryAdapterRun",
  public."GhlDeliveryAdapterStepRun",
  public."GhlLiveDeliveryRun",
  public."GhlLiveDeliveryStepRun",
  public."GhlLocationConfigSnapshot",
  public."GhlLocationConnection",
  public."GhlOAuthPendingInstall",
  public."GoogleAccountConnection",
  public."GoogleOAuthPendingAuth",
  public."GuidanceResource",
  public."InboundContactIndex",
  public."InventoryLot",
  public."KanbanBoard",
  public."KanbanCard",
  public."LeadAllocation",
  public."LeadAttribution",
  public."LeadCaptureTrustSyncAuditEvent",
  public."LeadDeliveryExportPackage",
  public."LeadDeliveryPlan",
  public."LeadDeliveryPlanStep",
  public."LeadDuplicateRiskAssessment",
  public."LeadEligibilityAssessment",
  public."LeadInventoryFacetBuild",
  public."LeadInventoryFacetSupplyAggregate",
  public."LeadInventoryImportBatch",
  public."LeadInventoryItem",
  public."LeadInventoryReviewAction",
  public."LeadInventoryReviewItemResult",
  public."LeadOrder",
  public."LeadOrderLine",
  public."LeadProof",
  public."LeadProofArtifact",
  public."LeadProofReviewAuditEvent",
  public."LeadReplacementRequest",
  public."LeadSourceSnapshot",
  public."LeadVerificationApprovalAuditEvent",
  public."LeadVerificationResult",
  public."Lf2CheckpointAAuditEvent",
  public."LifecycleEvent",
  public."MetaDispatchAttempt",
  public."ObjectionPlaybook",
  public."PplOperatorReviewBatch",
  public."PplOperatorReviewItem",
  public."PplSupplementalExport",
  public."ProtectedAgentExclusion",
  public."RoutingDryRunDecision",
  public."SourceFunnel",
  public."SourceLeadEvent",
  public."SourceRouteSchemaSnapshot",
  public."SupportTicket",
  public."SynthflowOutboundResultLog",
  public."SynthflowRequestLog",
  public."WebhookRequestLog",
  public.historical_catalog_projection
TO sa360_app;
-- app-dml:end

-- app-read:start
-- Reads established in production code. No insert, update, delete, or truncate.
GRANT SELECT ON TABLE
  public."HistoricalCampaignAlias",
  public."LeadAgeBandDefinition",
  public.historical_catalog_projection_control,
  public.historical_catalog_projection_source
TO sa360_app;
-- app-read:end

GRANT SELECT ON TABLE
  public."InventoryLot",
  public."SourceLeadEvent",
  public."LeadInventoryItem",
  public.historical_catalog_projection,
  public.historical_catalog_projection_source
TO sa360_schema_owner;

-- Sequences follow the same audited classes as tables. The only application
-- insert sequence is SupportTicket.ticketNumber. Summary sequences stay with
-- the summary owner. There is no GRANT ON ALL SEQUENCES.
-- sequence: grant | SupportTicket_ticketNumber_seq |
GRANT USAGE, SELECT ON SEQUENCE public."SupportTicket_ticketNumber_seq" TO sa360_app;
-- sequence: deny | historical_catalog_summary_label_label_pair_id_seq |
-- sequence: deny | historical_catalog_summary_bucket_bucket_id_seq |
-- sequence: deny | historical_catalog_summary_checkpoint_chunk_id_seq |
REVOKE ALL ON SEQUENCE
  public.historical_catalog_summary_label_label_pair_id_seq,
  public.historical_catalog_summary_bucket_bucket_id_seq,
  public.historical_catalog_summary_checkpoint_chunk_id_seq
FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader, PUBLIC;

-- Public routines. Each line is `-- routine: class | name | identity arguments`.
-- identity arguments match pg_get_function_identity_arguments. A new public
-- routine fails the static test until it is added to exactly one class.
--
-- trigger: existing invoker projection triggers. The writing role must be
-- able to execute these or inventory writes fail.
-- routine: trigger | historical_catalog_projection_refresh_item | p_item_id text
-- routine: trigger | historical_catalog_projection_item_trg |
-- routine: trigger | historical_catalog_projection_event_trg |
-- routine: trigger | historical_catalog_projection_lot_trg |
-- api: called by the historical ownership preview, including the nested
-- invoker helper that preview calls. Resale decisions are not in this class.
-- routine: api | historical_july_campaign_label_normalize | p_label text
-- routine: api | historical_registry_scope_key_kind | p_key text
-- routine: api | historical_campaign_ownership_decision | p_lot_key text, p_import_request_key text, p_july_label text
-- operator: backfill, reconciliation, and registry or resale controls.
-- The migration login owns these and keeps EXECUTE. sa360_app does not.
-- routine: operator | historical_catalog_projection_diff | p_after text, p_until text, p_limit integer
-- routine: operator | historical_catalog_projection_backfill_chunk | IN p_after text, IN p_until text
-- routine: operator | historical_alias_evidence_reference_ok | p_type text, p_reference text
-- routine: operator | historical_resale_evidence_reference_ok | p_type text, p_reference text
-- routine: operator | historical_registry_assign_event_sequence |
-- routine: operator | historical_registry_reject_event_mutation |
-- routine: operator | historical_registry_reject_parent_delete |
-- routine: operator | historical_campaign_alias_guard_identity |
-- routine: operator | historical_resale_guard_identity |
-- routine: operator | historical_campaign_alias_assert_history | p_alias_id text
-- routine: operator | historical_resale_authorization_assert_history | p_authorization_id text
-- routine: operator | historical_campaign_alias_history_trigger |
-- routine: operator | historical_campaign_alias_event_history_trigger |
-- routine: operator | historical_resale_history_trigger |
-- routine: operator | historical_resale_event_history_trigger |
-- routine: operator | historical_resale_posture | p_scope_type text, p_scope_key text, p_evaluated_at timestamp without time zone
-- routine: operator | historical_resale_authorization_decision | p_lot_key text, p_import_request_key text, p_evaluated_at timestamp with time zone
-- extension: pgcrypto routines installed by CREATE EXTENSION. Boundary A does
-- not grant or revoke them. Their existing PUBLIC execute stays as it is.
-- routine: extension | armor | bytea
-- routine: extension | armor | bytea, text[], text[]
-- routine: extension | crypt | text, text
-- routine: extension | dearmor | text
-- routine: extension | decrypt | bytea, bytea, text
-- routine: extension | decrypt_iv | bytea, bytea, bytea, text
-- routine: extension | digest | bytea, text
-- routine: extension | digest | text, text
-- routine: extension | encrypt | bytea, bytea, text
-- routine: extension | encrypt_iv | bytea, bytea, bytea, text
-- routine: extension | fips_mode |
-- routine: extension | gen_random_bytes | integer
-- routine: extension | gen_random_uuid |
-- routine: extension | gen_salt | text
-- routine: extension | gen_salt | text, integer
-- routine: extension | hmac | bytea, bytea, text
-- routine: extension | hmac | text, text, text
-- routine: extension | pgp_armor_headers | text, OUT key text, OUT value text
-- routine: extension | pgp_key_id | bytea
-- routine: extension | pgp_pub_decrypt | bytea, bytea
-- routine: extension | pgp_pub_decrypt | bytea, bytea, text
-- routine: extension | pgp_pub_decrypt | bytea, bytea, text, text
-- routine: extension | pgp_pub_decrypt_bytea | bytea, bytea
-- routine: extension | pgp_pub_decrypt_bytea | bytea, bytea, text
-- routine: extension | pgp_pub_decrypt_bytea | bytea, bytea, text, text
-- routine: extension | pgp_pub_encrypt | text, bytea
-- routine: extension | pgp_pub_encrypt | text, bytea, text
-- routine: extension | pgp_pub_encrypt_bytea | bytea, bytea
-- routine: extension | pgp_pub_encrypt_bytea | bytea, bytea, text
-- routine: extension | pgp_sym_decrypt | bytea, text
-- routine: extension | pgp_sym_decrypt | bytea, text, text
-- routine: extension | pgp_sym_decrypt_bytea | bytea, text
-- routine: extension | pgp_sym_decrypt_bytea | bytea, text, text
-- routine: extension | pgp_sym_encrypt | text, text
-- routine: extension | pgp_sym_encrypt | text, text, text
-- routine: extension | pgp_sym_encrypt_bytea | bytea, text
-- routine: extension | pgp_sym_encrypt_bytea | bytea, text, text

-- Revoke the built-in PUBLIC execute grant, then grant only the runtime set.
-- The owner keeps EXECUTE. No dynamic grant over every owned routine.
REVOKE ALL ON FUNCTION
  public.historical_catalog_projection_refresh_item(text),
  public.historical_catalog_projection_item_trg(),
  public.historical_catalog_projection_event_trg(),
  public.historical_catalog_projection_lot_trg(),
  public.historical_july_campaign_label_normalize(text),
  public.historical_registry_scope_key_kind(text),
  public.historical_campaign_ownership_decision(text, text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.historical_catalog_projection_refresh_item(text),
  public.historical_catalog_projection_item_trg(),
  public.historical_catalog_projection_event_trg(),
  public.historical_catalog_projection_lot_trg(),
  public.historical_july_campaign_label_normalize(text),
  public.historical_registry_scope_key_kind(text),
  public.historical_campaign_ownership_decision(text, text, text)
TO sa360_app;

REVOKE ALL ON FUNCTION
  public.historical_catalog_projection_diff(text, text, integer),
  public.historical_alias_evidence_reference_ok(text, text),
  public.historical_resale_evidence_reference_ok(text, text),
  public.historical_registry_assign_event_sequence(),
  public.historical_registry_reject_event_mutation(),
  public.historical_registry_reject_parent_delete(),
  public.historical_campaign_alias_guard_identity(),
  public.historical_resale_guard_identity(),
  public.historical_campaign_alias_assert_history(text),
  public.historical_resale_authorization_assert_history(text),
  public.historical_campaign_alias_history_trigger(),
  public.historical_campaign_alias_event_history_trigger(),
  public.historical_resale_history_trigger(),
  public.historical_resale_event_history_trigger(),
  public.historical_resale_posture(text, text, timestamp),
  public.historical_resale_authorization_decision(text, text, timestamptz)
FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader;
REVOKE ALL ON PROCEDURE public.historical_catalog_projection_backfill_chunk(text, text)
FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader;

-- stage:after-grants

DO $owners$
DECLARE
  object_name text;
BEGIN
  FOREACH object_name IN ARRAY ARRAY[
    'historical_catalog_summary_label',
    'historical_catalog_summary_bucket',
    'historical_catalog_summary_membership',
    'historical_catalog_summary_checkpoint',
    'historical_catalog_summary_control'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO sa360_schema_owner', object_name);
  END LOOP;
END
$owners$;

DO $summary_sequences$
DECLARE
  object_name text;
  object_owner text;
BEGIN
  FOREACH object_name IN ARRAY ARRAY[
    'historical_catalog_summary_label_label_pair_id_seq',
    'historical_catalog_summary_bucket_bucket_id_seq',
    'historical_catalog_summary_checkpoint_chunk_id_seq'
  ]
  LOOP
    SELECT pg_get_userbyid(relowner)
    INTO object_owner
    FROM pg_class
    WHERE oid = to_regclass(format('public.%I', object_name));
    IF object_owner IS DISTINCT FROM 'sa360_schema_owner' THEN
      EXECUTE format('ALTER SEQUENCE public.%I OWNER TO sa360_schema_owner', object_name);
    END IF;
  END LOOP;
END
$summary_sequences$;

-- The migration login no longer owns these tables. Checkers count the control
-- row, so that login keeps SELECT and nothing else. sa360_app is not in this grant.
SET LOCAL ROLE sa360_schema_owner;
DO $installer_read$
BEGIN
  EXECUTE format(
    'GRANT SELECT ON TABLE
       public.historical_catalog_summary_label,
       public.historical_catalog_summary_bucket,
       public.historical_catalog_summary_membership,
       public.historical_catalog_summary_checkpoint,
       public.historical_catalog_summary_control
     TO %I',
    session_user
  );
END
$installer_read$;
RESET ROLE;

-- stage:after-ownership

DO $final$
BEGIN
  IF (
    SELECT count(*)
    FROM public.historical_catalog_summary_control
    WHERE singleton
      AND summary_ready = false
      AND summary_epoch = 0
      AND reconciled_epoch IS NULL
      AND failure_count = 0
  ) <> 1
  OR (SELECT count(*) FROM public.historical_catalog_summary_label) <> 0
  OR (SELECT count(*) FROM public.historical_catalog_summary_bucket) <> 0
  OR (SELECT count(*) FROM public.historical_catalog_summary_membership) <> 0
  OR (SELECT count(*) FROM public.historical_catalog_summary_checkpoint) <> 0 THEN
    RAISE EXCEPTION 'boundary A refused: summary readiness changed before commit';
  END IF;
  IF (
    SELECT count(*)
    FROM public.historical_catalog_projection_control
    WHERE ready
      AND source_row_count = projection_row_count
      AND source_row_count > 0
  ) <> 1 THEN
    RAISE EXCEPTION 'boundary A refused: projection control changed before commit';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.proname LIKE 'historical_catalog_summary_%'
  ) OR EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    WHERE NOT trigger.tgisinternal
      AND trigger.tgname LIKE 'historical_catalog_summary_%'
  ) THEN
    RAISE EXCEPTION 'boundary A refused: summary routine or trigger appeared';
  END IF;
  IF (
    SELECT coalesce(string_agg(trigger.tgname || ':' || trigger.tgenabled::text, ',' ORDER BY trigger.tgname), '')
    FROM pg_trigger AS trigger
    JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE NOT trigger.tgisinternal
      AND namespace.nspname = 'public'
      AND trigger.tgname LIKE 'historical_catalog_projection_%'
  ) IS DISTINCT FROM 'historical_catalog_projection_event_refresh:O,historical_catalog_projection_item_refresh:O,historical_catalog_projection_lot_refresh:O' THEN
    RAISE EXCEPTION 'boundary A refused: projection triggers changed before commit';
  END IF;
  IF has_function_privilege('public', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR has_function_privilege('_doadmin_monitor', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR has_function_privilege('_dodb_repl', 'public.historical_catalog_projection_item_trg()', 'EXECUTE')
     OR has_function_privilege('_dodb_rewind', 'public.historical_catalog_projection_refresh_item(text)', 'EXECUTE')
     OR NOT has_function_privilege('doadmin', 'public.historical_catalog_projection_backfill_chunk(text, text)', 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('_dodb', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_app', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_app', 'public.historical_catalog_projection_item_trg()', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_catalog_projection_backfill_chunk(text, text)', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_catalog_projection_diff(text, text, integer)', 'EXECUTE')
     OR NOT has_function_privilege('public', 'public.gen_random_uuid()', 'EXECUTE') THEN
    RAISE EXCEPTION 'boundary A refused: routine execute result does not match the allowlist';
  END IF;
  IF pg_get_userbyid((
       SELECT relowner FROM pg_class WHERE oid = to_regclass('public.historical_catalog_summary_control')
     )) IS DISTINCT FROM 'sa360_schema_owner'
     OR pg_get_userbyid((
       SELECT relowner FROM pg_class WHERE relname = 'historical_catalog_summary_label_label_pair_id_seq'
     )) IS DISTINCT FROM 'sa360_schema_owner' THEN
    RAISE EXCEPTION 'boundary A refused: summary ownership did not move';
  END IF;
  IF pg_get_userbyid((
       SELECT relowner FROM pg_class WHERE oid = to_regclass('public."LeadInventoryItem"')
     )) IS DISTINCT FROM 'doadmin' THEN
    RAISE EXCEPTION 'boundary A refused: inventory ownership moved';
  END IF;
END
$final$;

-- stage:before-commit

COMMIT;
