-- Boundary A ownership preparation. Inert outside a disposable test database.
--
-- Do not copy this file into prisma/migrations. It contains no passwords and
-- no customer data. It refuses unless the database name contains "test" and
-- the server address is local. Production role creation is a separate
-- approval; do not point this file at defaultdb.
--
-- The whole file is one transaction. On PostgreSQL 18.6, CREATE ROLE and
-- GRANT membership roll back with the transaction. A failure before COMMIT
-- leaves no new role, no membership, no schema, and no grant. Do not describe
-- an earlier committed role statement as rolled back.
--
-- Routine EXECUTE is an explicit allowlist. Owning a routine is not a reason
-- to grant it. Extension routines are not granted or revoked here.

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF current_database() !~* 'test' THEN
    RAISE EXCEPTION 'ownership preparation refused: database name must contain test';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND inet_server_addr() <> '127.0.0.1'::inet
     AND inet_server_addr() <> '::1'::inet
  THEN
    RAISE EXCEPTION 'ownership preparation refused: server is not local';
  END IF;
  IF current_user IN ('sa360_app', 'sa360_summary_runtime', 'sa360_summary_operator', 'sa360_summary_reader') THEN
    RAISE EXCEPTION 'ownership preparation refused: runtime session';
  END IF;
END
$guard$;

DO $schema_owner$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_schema_owner') THEN
    CREATE ROLE sa360_schema_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END
$schema_owner$;

-- stage:during-roles

DO $other_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_runtime') THEN
    CREATE ROLE sa360_summary_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_operator') THEN
    CREATE ROLE sa360_summary_operator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_reader') THEN
    CREATE ROLE sa360_summary_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    CREATE ROLE sa360_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END
$other_roles$;

-- stage:after-roles

DO $members$
BEGIN
  IF NOT pg_has_role('sa360_app', 'sa360_summary_runtime', 'USAGE')
     OR pg_has_role('sa360_app', 'sa360_summary_runtime', 'SET')
  THEN
    IF pg_has_role('sa360_app', 'sa360_summary_runtime', 'MEMBER') THEN
      REVOKE sa360_summary_runtime FROM sa360_app;
    END IF;
    GRANT sa360_summary_runtime TO sa360_app WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
  END IF;
  -- The migration login created these roles, so it is already their grantor.
  -- Membership is still required to transfer ownership. ADMIN TRUE on that
  -- membership is rejected as granting ADMIN back to the grantor.
  IF NOT pg_has_role(current_user, 'sa360_schema_owner', 'SET') THEN
    GRANT sa360_schema_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
  END IF;
  IF NOT pg_has_role(current_user, 'sa360_summary_operator', 'SET') THEN
    GRANT sa360_summary_operator TO CURRENT_USER WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
  END IF;
END
$members$;

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
-- stage:before-commit

COMMIT;
