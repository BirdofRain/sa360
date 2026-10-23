-- Pre-Boundary A catalog inspection. Read only.
--
-- Use this file before any role preparation. Do not use preflight.sql for
-- that pass: preflight.sql includes preconditions.sql, and preconditions.sql
-- raises until sa360_schema_owner and the runtime roles exist.
--
-- This script grants nothing, revokes nothing, and installs nothing. It is
-- not a Prisma migration and it is not the production Boundary A script.
-- Boundary A remains a separate version-pinned approval. The disposable
-- prepare-ownership.sql guard stays in place.
--
-- Do not select customer rows, passwords, or tokens. Run it from an already
-- authorized read-only session. A passed inspection rolls back.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT current_setting('server_version') AS server_version,
       current_user AS inspection_role,
       current_database() AS database_name,
       transaction_timestamp() AS observed_at;

SELECT rolname,
       rolcanlogin,
       rolsuper,
       rolcreaterole,
       rolcreatedb,
       rolbypassrls,
       rolinherit
FROM pg_roles
WHERE rolname LIKE 'sa360%'
ORDER BY rolname;

SELECT summary_ready,
       summary_epoch,
       reconciled_epoch,
       failure_count
FROM public.historical_catalog_summary_control;

SELECT (SELECT count(*) FROM public.historical_catalog_summary_label) AS label_rows,
       (SELECT count(*) FROM public.historical_catalog_summary_bucket) AS bucket_rows,
       (SELECT count(*) FROM public.historical_catalog_summary_membership) AS membership_rows,
       (SELECT count(*) FROM public.historical_catalog_summary_checkpoint) AS checkpoint_rows,
       (SELECT count(*) FROM public.historical_catalog_summary_control) AS control_rows;

SELECT routine.proname,
       routine.prokind,
       pg_get_function_identity_arguments(routine.oid) AS identity_args,
       pg_get_userbyid(routine.proowner) AS owner,
       routine.prosecdef
FROM pg_proc AS routine
JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
WHERE namespace.nspname = 'public'
  AND routine.proname LIKE 'historical_catalog_summary_%'
ORDER BY routine.proname, identity_args;

SELECT typname,
       pg_get_userbyid(typowner) AS owner
FROM pg_type
JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
WHERE pg_namespace.nspname = 'public'
  AND typname LIKE 'historical_catalog_summary_%'
ORDER BY typname;

SELECT relation.relkind,
       relation.relname,
       pg_get_userbyid(relation.relowner) AS owner
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relname LIKE 'historical_catalog_summary_%'
  AND relation.relkind IN ('r', 'S', 'v', 'm')
ORDER BY relation.relkind, relation.relname;

SELECT relation.relname AS table_name,
       trigger.tgname,
       trigger.tgenabled
FROM pg_trigger AS trigger
JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE NOT trigger.tgisinternal
  AND namespace.nspname = 'public'
  AND (
    trigger.tgname LIKE 'historical_catalog_projection_%'
    OR trigger.tgname LIKE 'historical_catalog_summary_%'
  )
ORDER BY trigger.tgname;

SELECT ready,
       source_row_count,
       projection_row_count,
       verified_at
FROM public.historical_catalog_projection_control;

SELECT pg_get_userbyid(defaclrole) AS owner_role,
       defaclnamespace::regnamespace AS schema_name,
       defaclobjtype,
       defaclacl::text AS default_acl
FROM pg_default_acl
ORDER BY owner_role, schema_name, defaclobjtype;

SELECT count(*) AS migration_rows,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS unfinished_or_failed
FROM public._prisma_migrations;

SELECT migration_name,
       started_at,
       finished_at,
       rolled_back_at,
       applied_steps_count
FROM public._prisma_migrations
WHERE finished_at IS NULL
   OR rolled_back_at IS NOT NULL
ORDER BY started_at;

SELECT routine.proname,
       pg_get_function_identity_arguments(routine.oid) AS identity_args,
       routine.prokind,
       pg_get_userbyid(routine.proowner) AS owner,
       routine.prosecdef,
       routine.proacl::text AS execute_acl,
       has_function_privilege('public', routine.oid, 'EXECUTE') AS public_execute
FROM pg_proc AS routine
JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
WHERE namespace.nspname = 'public'
ORDER BY routine.proname, identity_args;

ROLLBACK;
