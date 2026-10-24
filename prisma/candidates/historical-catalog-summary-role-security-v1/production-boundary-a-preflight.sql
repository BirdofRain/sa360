-- Read-only preflight for production Boundary A. It grants nothing.
-- A failure raises. A pass rolls back. Run it immediately before the
-- approved production-boundary-a.sql, with ON_ERROR_STOP=1.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

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

ROLLBACK;
