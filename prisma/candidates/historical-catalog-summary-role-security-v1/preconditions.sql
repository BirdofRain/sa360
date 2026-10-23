-- Gate 13 ownership preconditions. Inert checker.
--
-- Do not copy this file into prisma/migrations. Do not run it on production
-- until a separate approval allows role preparation. It does not CREATE ROLE,
-- GRANT, REVOKE, ALTER OWNER, or install functions. A failed check raises.
-- A passed check rolls back, so it leaves no session state behind.
--
-- Run it before functions.sql. Missing roles, wrong owners, and a runtime
-- login that can write summary readiness fail closed. Conditional grants in
-- functions.sql are not a substitute for this check.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

DO $pre$
DECLARE
  v_table text;
  v_owner text;
  v_summary text[] := ARRAY[
    'historical_catalog_summary_label',
    'historical_catalog_summary_bucket',
    'historical_catalog_summary_membership',
    'historical_catalog_summary_checkpoint',
    'historical_catalog_summary_control'
  ];
  v_intake text[] := ARRAY[
    'InventoryLot',
    'SourceLeadEvent',
    'LeadInventoryItem',
    'historical_catalog_projection',
    'historical_catalog_projection_control'
  ];
BEGIN
  IF current_user = 'sa360_app' THEN
    RAISE EXCEPTION 'preconditions refused: installer session is sa360_app';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'sa360_schema_owner'
      AND NOT rolcanlogin
      AND NOT rolsuper
      AND NOT rolcreaterole
      AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'preconditions refused: sa360_schema_owner must be NOLOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'sa360_summary_runtime' AND NOT rolcanlogin AND NOT rolsuper
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'sa360_summary_operator' AND NOT rolcanlogin AND NOT rolsuper
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'sa360_summary_reader' AND NOT rolcanlogin AND NOT rolsuper
  ) THEN
    RAISE EXCEPTION 'preconditions refused: runtime, operator, and reader must exist as NOLOGIN NOSUPERUSER';
  END IF;

  IF NOT EXISTS (
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
    RAISE EXCEPTION 'preconditions refused: sa360_app must be a non-inheriting LOGIN without superuser, createrole, createdb, or bypassrls';
  END IF;

  IF pg_has_role('sa360_app', 'sa360_schema_owner', 'MEMBER')
     OR pg_has_role('sa360_app', 'sa360_schema_owner', 'SET')
     OR pg_has_role('sa360_app', 'sa360_summary_operator', 'MEMBER')
     OR pg_has_role('sa360_app', 'sa360_summary_operator', 'SET')
     OR pg_has_role('sa360_summary_runtime', 'sa360_schema_owner', 'MEMBER')
     OR pg_has_role('sa360_summary_runtime', 'sa360_summary_operator', 'MEMBER')
  THEN
    RAISE EXCEPTION 'preconditions refused: app or runtime can become schema owner or operator';
  END IF;

  IF NOT pg_has_role('sa360_app', 'sa360_summary_runtime', 'USAGE') THEN
    RAISE EXCEPTION 'preconditions refused: sa360_app must inherit sa360_summary_runtime';
  END IF;

  IF has_schema_privilege('sa360_app', 'public', 'CREATE')
     OR NOT has_schema_privilege('sa360_app', 'public', 'USAGE')
     OR NOT has_schema_privilege('sa360_schema_owner', 'public', 'CREATE')
  THEN
    RAISE EXCEPTION 'preconditions refused: schema CREATE must belong to sa360_schema_owner and not sa360_app';
  END IF;

  FOREACH v_table IN ARRAY v_summary LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'preconditions refused: missing summary table %', v_table;
    END IF;
    SELECT pg_get_userbyid(relowner)
    INTO v_owner
    FROM pg_class
    WHERE oid = to_regclass(format('public.%I', v_table));
    IF v_owner IS DISTINCT FROM 'sa360_schema_owner' THEN
      RAISE EXCEPTION 'preconditions refused: % is owned by %', v_table, v_owner;
    END IF;
    IF has_table_privilege('sa360_app', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('sa360_app', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('sa360_app', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('sa360_app', format('public.%I', v_table), 'TRUNCATE')
       OR has_table_privilege('sa360_app', format('public.%I', v_table), 'TRIGGER')
       OR has_table_privilege('sa360_summary_runtime', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('sa360_summary_operator', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('sa360_summary_reader', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('sa360_summary_reader', format('public.%I', v_table), 'INSERT')
    THEN
      RAISE EXCEPTION 'preconditions refused: summary DML remains available on %', v_table;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('sa360_app', 'public.historical_catalog_projection_source', 'SELECT') THEN
    RAISE EXCEPTION 'preconditions refused: sa360_app cannot read historical_catalog_projection_source';
  END IF;

  IF NOT has_table_privilege('sa360_schema_owner', 'public.historical_catalog_projection', 'SELECT')
     OR NOT has_table_privilege('sa360_schema_owner', 'public."LeadInventoryItem"', 'SELECT')
     OR NOT has_table_privilege('sa360_schema_owner', 'public."InventoryLot"', 'SELECT')
     OR NOT has_table_privilege('sa360_schema_owner', 'public."SourceLeadEvent"', 'SELECT')
  THEN
    RAISE EXCEPTION 'preconditions refused: schema owner cannot read inventory or projection inputs';
  END IF;

  IF has_column_privilege('sa360_app', 'public.historical_catalog_summary_control', 'summary_ready', 'UPDATE')
     OR has_column_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_control', 'summary_ready', 'UPDATE')
  THEN
    RAISE EXCEPTION 'preconditions refused: runtime can update summary_ready directly';
  END IF;

  FOREACH v_table IN ARRAY v_intake LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'preconditions refused: missing intake table %', v_table;
    END IF;
    IF NOT has_table_privilege('sa360_app', format('public.%I', v_table), 'SELECT')
       OR NOT has_table_privilege('sa360_app', format('public.%I', v_table), 'INSERT')
       OR NOT has_table_privilege('sa360_app', format('public.%I', v_table), 'UPDATE')
    THEN
      RAISE EXCEPTION 'preconditions refused: sa360_app lacks ordinary DML on %', v_table;
    END IF;
  END LOOP;
END
$pre$;

ROLLBACK;
