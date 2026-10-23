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

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sa360_app;
REVOKE ALL ON SEQUENCE
  public.historical_catalog_summary_label_label_pair_id_seq,
  public.historical_catalog_summary_bucket_bucket_id_seq,
  public.historical_catalog_summary_checkpoint_chunk_id_seq
FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader, PUBLIC;

DO $sequences$
DECLARE
  sequence_name text;
BEGIN
  FOR sequence_name IN
    SELECT seq.relname
    FROM pg_class AS seq
    JOIN pg_namespace AS seq_namespace ON seq_namespace.oid = seq.relnamespace
    JOIN pg_depend AS dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
    JOIN pg_class AS tbl ON tbl.oid = dep.refobjid
    WHERE seq_namespace.nspname = 'public'
      AND seq.relkind = 'S'
      AND NOT has_table_privilege('sa360_app', tbl.oid, 'INSERT')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON SEQUENCE public.%I FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader, PUBLIC',
      sequence_name
    );
  END LOOP;
END
$sequences$;

DO $execute$
DECLARE
  routine_name text;
  routine_args text;
  routine_kind "char";
BEGIN
  FOR routine_name, routine_args, routine_kind IN
    SELECT routine.proname, pg_get_function_identity_arguments(routine.oid), routine.prokind
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND pg_get_userbyid(routine.proowner) = current_user
      AND routine.proname NOT LIKE 'historical_catalog_summary_%'
  LOOP
    IF routine_kind = 'p' THEN
      EXECUTE format('GRANT EXECUTE ON PROCEDURE public.%I(%s) TO sa360_app', routine_name, routine_args);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO sa360_app', routine_name, routine_args);
    END IF;
  END LOOP;
END
$execute$;

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
