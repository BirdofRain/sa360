-- Read-only postconditions for production Boundary A.
--
-- Run this after production-boundary-a.sql commits, then run preconditions.sql.
-- This file grants nothing and installs nothing. A failure raises. A pass
-- rolls back. It does not require summary maintenance routines: those belong
-- to a later boundary.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $post$
BEGIN
  IF current_database() IS DISTINCT FROM 'defaultdb'
     OR current_user IS DISTINCT FROM 'doadmin'
     OR current_setting('server_version_num')::integer / 10000 <> 18 THEN
    RAISE EXCEPTION 'boundary A postcondition refused: installer identity changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'doadmin'
      AND rolcanlogin
      AND NOT rolsuper
      AND rolcreaterole
      AND rolcreatedb
      AND rolreplication
      AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'boundary A postcondition refused: doadmin attributes changed';
  END IF;

  IF (
    SELECT coalesce(string_agg(rolname, ',' ORDER BY rolname), '')
    FROM pg_roles
    WHERE rolcanlogin
  ) IS DISTINCT FROM '_doadmin_monitor,_dodb,_dodb_repl,_dodb_rewind,doadmin,postgres,sa360_app' THEN
    RAISE EXCEPTION 'boundary A postcondition refused: login roles changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'sa360_schema_owner'
      AND NOT rolcanlogin
      AND NOT rolsuper
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolbypassrls
      AND NOT rolinherit
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'sa360_app'
      AND rolcanlogin
      AND NOT rolsuper
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolbypassrls
      AND NOT rolinherit
  ) THEN
    RAISE EXCEPTION 'boundary A postcondition refused: sa360 role attributes changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member_role ON member_role.oid = membership.member
    JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = 'sa360_app'
      AND granted_role.rolname = 'sa360_summary_runtime'
      AND membership.inherit_option
      AND NOT membership.set_option
      AND NOT membership.admin_option
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member_role ON member_role.oid = membership.member
    JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = 'doadmin'
      AND granted_role.rolname = 'sa360_schema_owner'
      AND NOT membership.inherit_option
      AND membership.set_option
      AND NOT membership.admin_option
  ) OR pg_has_role('sa360_app', 'sa360_schema_owner', 'MEMBER')
    OR pg_has_role('sa360_app', 'sa360_summary_operator', 'MEMBER')
    OR pg_has_role('sa360_app', 'doadmin', 'MEMBER') THEN
    RAISE EXCEPTION 'boundary A postcondition refused: role membership changed';
  END IF;

  IF has_schema_privilege('sa360_app', 'public', 'CREATE')
     OR has_schema_privilege('sa360_app', 'sa360_summary', 'USAGE')
     OR NOT has_schema_privilege('sa360_schema_owner', 'public', 'CREATE')
     OR pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname = 'sa360_summary'))
          IS DISTINCT FROM 'sa360_schema_owner' THEN
    RAISE EXCEPTION 'boundary A postcondition refused: schema privileges changed';
  END IF;

  IF pg_get_userbyid((
       SELECT relowner FROM pg_class WHERE oid = to_regclass('public.historical_catalog_summary_control')
     )) IS DISTINCT FROM 'sa360_schema_owner'
     OR pg_get_userbyid((
       SELECT relowner FROM pg_class WHERE oid = to_regclass('public.historical_catalog_summary_label')
     )) IS DISTINCT FROM 'sa360_schema_owner'
     OR pg_get_userbyid((
       SELECT relowner FROM pg_class WHERE relname = 'historical_catalog_summary_bucket_bucket_id_seq'
     )) IS DISTINCT FROM 'sa360_schema_owner'
     OR pg_get_userbyid((
       SELECT relowner FROM pg_class WHERE oid = to_regclass('public."LeadInventoryItem"')
     )) IS DISTINCT FROM 'doadmin'
     OR pg_get_userbyid((
       SELECT relowner FROM pg_class WHERE oid = to_regclass('public.historical_catalog_projection_control')
     )) IS DISTINCT FROM 'doadmin' THEN
    RAISE EXCEPTION 'boundary A postcondition refused: ownership moved outside the summary objects';
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
  OR (SELECT count(*) FROM public.historical_catalog_summary_label) <> 0
  OR (SELECT count(*) FROM public.historical_catalog_summary_bucket) <> 0
  OR (SELECT count(*) FROM public.historical_catalog_summary_membership) <> 0
  OR (SELECT count(*) FROM public.historical_catalog_summary_checkpoint) <> 0
  OR (
    SELECT count(*)
    FROM public.historical_catalog_projection_control
    WHERE singleton
      AND ready
      AND source_row_count = projection_row_count
      AND source_row_count > 0
  ) <> 1 THEN
    RAISE EXCEPTION 'boundary A postcondition refused: summary or projection state changed';
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
    RAISE EXCEPTION 'boundary A postcondition refused: summary routine or trigger exists';
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
    RAISE EXCEPTION 'boundary A postcondition refused: projection triggers changed';
  END IF;

  IF has_function_privilege('public', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR has_function_privilege('public', 'public.historical_catalog_projection_item_trg()', 'EXECUTE')
     OR has_function_privilege('public', 'public.historical_catalog_projection_backfill_chunk(text, text)', 'EXECUTE')
     OR has_function_privilege('_doadmin_monitor', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR has_function_privilege('_dodb_repl', 'public.historical_catalog_projection_item_trg()', 'EXECUTE')
     OR has_function_privilege('_dodb_rewind', 'public.historical_catalog_projection_refresh_item(text)', 'EXECUTE')
     OR NOT has_function_privilege('doadmin', 'public.historical_catalog_projection_backfill_chunk(text, text)', 'EXECUTE')
     OR NOT has_function_privilege('doadmin', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('_dodb', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_app', 'public.historical_campaign_ownership_decision(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_app', 'public.historical_catalog_projection_refresh_item(text)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_app', 'public.historical_july_campaign_label_normalize(text)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_app', 'public.historical_registry_scope_key_kind(text)', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_catalog_projection_backfill_chunk(text, text)', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_catalog_projection_diff(text, text, integer)', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_resale_authorization_decision(text, text, timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('public', 'public.gen_random_uuid()', 'EXECUTE')
     OR pg_get_userbyid((
       SELECT routine.proowner
       FROM pg_proc AS routine
       JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
       WHERE namespace.nspname = 'public'
         AND routine.proname = 'gen_random_uuid'
         AND pg_get_function_identity_arguments(routine.oid) = ''
     )) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'boundary A postcondition refused: routine privileges changed';
  END IF;

  IF has_table_privilege('sa360_app', 'public._prisma_migrations', 'SELECT')
     OR has_table_privilege('sa360_app', 'public._prisma_migrations', 'INSERT')
     OR has_table_privilege('sa360_app', 'public.historical_catalog_summary_control', 'UPDATE')
     OR has_column_privilege('sa360_app', 'public.historical_catalog_summary_control', 'summary_ready', 'UPDATE')
     OR has_column_privilege('sa360_app', 'public.historical_catalog_projection_control', 'ready', 'UPDATE')
     OR NOT has_table_privilege('doadmin', 'public._prisma_migrations', 'INSERT')
     OR NOT has_table_privilege('doadmin', 'public._prisma_migrations', 'UPDATE')
     OR NOT has_column_privilege('doadmin', 'public.historical_catalog_projection_control', 'ready', 'UPDATE') THEN
    RAISE EXCEPTION 'boundary A postcondition refused: table privileges changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS acl
    WHERE acl.defaclacl::text LIKE '%sa360_app=%'
  ) THEN
    RAISE EXCEPTION 'boundary A postcondition refused: default privileges grant sa360_app rights';
  END IF;
END
$post$;

ROLLBACK;
