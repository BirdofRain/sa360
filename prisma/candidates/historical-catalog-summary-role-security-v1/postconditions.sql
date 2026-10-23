-- Function-install postconditions. Inert checker.
--
-- Do not copy this file into prisma/migrations. Run it after functions.sql
-- and before triggers.sql, in a later approval. It does not install, grant,
-- or alter anything. It fails closed when routine ownership, SECURITY
-- DEFINER, search_path, or execute allowlists are wrong. A pass rolls back.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

DO $post$
DECLARE
  v_bad text;
BEGIN
  IF to_regprocedure('public.historical_catalog_summary_authorize()') IS NULL
     OR to_regprocedure('public.historical_catalog_summary_mark_unready(text,boolean)') IS NULL
     OR to_regprocedure('public.historical_catalog_summary_readable()') IS NULL
     OR to_regprocedure('public.historical_catalog_summary_reconcile_issues()') IS NULL
     OR to_regprocedure('public.historical_catalog_summary_backfill_range(text,text)') IS NULL
  THEN
    RAISE EXCEPTION 'postconditions refused: summary routines are not installed';
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
  INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'historical_catalog_summary_%'
    AND p.proname <> 'historical_catalog_summary_backfill_range'
    AND (
      NOT p.prosecdef
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'sa360_schema_owner'
    );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'postconditions refused: routines are not SECURITY DEFINER owned by sa360_schema_owner: %', v_bad;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
  INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'historical_catalog_summary_%'
    AND p.prokind = 'f'
    AND (
      p.proconfig IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS setting
        WHERE setting = 'search_path=pg_catalog, public, pg_temp'
      )
    );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'postconditions refused: function search_path must be pg_catalog, public, pg_temp: %', v_bad;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'historical_catalog_summary_backfill_range'
      AND (
        prosecdef
        OR pg_get_userbyid(proowner) IS DISTINCT FROM 'sa360_schema_owner'
      )
  ) THEN
    RAISE EXCEPTION 'postconditions refused: backfill_range must stay an invoker owned by sa360_schema_owner';
  END IF;

  IF position(
    'pg_catalog.set_config(''search_path'', ''pg_catalog, public, pg_temp'', true)' IN pg_get_functiondef('public.historical_catalog_summary_backfill_range(text,text)'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'postconditions refused: backfill procedure must pin search_path to pg_catalog, public, pg_temp';
  END IF;

  IF has_function_privilege('public', 'public.historical_catalog_summary_authorize()', 'EXECUTE')
     OR has_function_privilege('public', 'public.historical_catalog_summary_mark_unready(text,boolean)', 'EXECUTE')
     OR has_function_privilege('public', 'public.historical_catalog_summary_backfill_range(text,text)', 'EXECUTE')
     OR has_function_privilege('public', 'public.historical_catalog_summary_reconcile_issues()', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_catalog_summary_authorize()', 'EXECUTE')
     OR has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_authorize()', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_catalog_summary_backfill_range(text,text)', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_catalog_summary_checkpoint_open(text,text)', 'EXECUTE')
     OR has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_checkpoint_open(text,text)', 'EXECUTE')
     OR has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_reconcile_issues()', 'EXECUTE')
     OR has_function_privilege('sa360_summary_reader', 'public.historical_catalog_summary_reconcile_issues()', 'EXECUTE')
     OR has_function_privilege('sa360_summary_reader', 'public.historical_catalog_summary_authorize()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'postconditions refused: authorize, backfill, or full reconcile is executable by public, app, runtime, or reader';
  END IF;

  IF NOT has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_item_trg()', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_event_trg()', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_lot_trg()', 'EXECUTE')
     OR NOT has_function_privilege('sa360_app', 'public.historical_catalog_summary_item_trg()', 'EXECUTE')
     OR NOT has_function_privilege('sa360_app', 'public.historical_catalog_summary_event_trg()', 'EXECUTE')
     OR NOT has_function_privilege('sa360_app', 'public.historical_catalog_summary_lot_trg()', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_operator', 'public.historical_catalog_summary_authorize()', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_operator', 'public.historical_catalog_summary_mark_unready(text,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_operator', 'public.historical_catalog_summary_backfill_range(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_operator', 'public.historical_catalog_summary_backfill_chunk(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_operator', 'public.historical_catalog_summary_checkpoint_open(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_operator', 'public.historical_catalog_summary_checkpoint_complete(bigint,integer)', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_operator', 'public.historical_catalog_summary_reconcile_issues()', 'EXECUTE')
     OR NOT has_function_privilege('sa360_summary_reader', 'public.historical_catalog_summary_readable()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'postconditions refused: trigger, operator, or reader execute allowlist is incomplete';
  END IF;

  IF has_function_privilege('sa360_app', 'public.historical_catalog_summary_mark_unready(text,boolean)', 'EXECUTE')
     OR has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_mark_unready(text,boolean)', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_catalog_summary_apply_item(text)', 'EXECUTE')
     OR has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_apply_item(text)', 'EXECUTE')
     OR has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_apply_items_work(text[])', 'EXECUTE')
     OR has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_apply_items_once(text[])', 'EXECUTE')
     OR has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_checkpoint_complete(bigint,integer)', 'EXECUTE')
     OR has_function_privilege('sa360_app', 'public.historical_catalog_summary_reconcile()', 'EXECUTE')
     OR has_function_privilege('sa360_summary_runtime', 'public.historical_catalog_summary_lock_for_reconcile()', 'EXECUTE')
     OR has_function_privilege('sa360_summary_operator', 'public.historical_catalog_summary_apply_item(text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'postconditions refused: runtime or app can execute an internal helper';
  END IF;

  IF has_table_privilege('sa360_app', 'public.historical_catalog_summary_control', 'UPDATE')
     OR has_table_privilege('sa360_summary_operator', 'public.historical_catalog_summary_control', 'UPDATE')
     OR has_column_privilege('sa360_app', 'public.historical_catalog_summary_control', 'summary_ready', 'UPDATE')
  THEN
    RAISE EXCEPTION 'postconditions refused: direct summary control updates remain granted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND t.tgname LIKE 'historical_catalog_summary_%'
      AND (NOT p.prosecdef OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'sa360_schema_owner')
  ) THEN
    RAISE EXCEPTION 'postconditions refused: a summary trigger function is not the schema-owner definer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
      AND t.tgname LIKE 'historical_catalog_projection_%'
      AND t.tgenabled <> 'O'
  ) THEN
    RAISE EXCEPTION 'postconditions refused: a projection trigger is not enabled';
  END IF;
END
$post$;

ROLLBACK;
