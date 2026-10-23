-- Boundary C owner-rights transformation. Inert outside a disposable test database.
--
-- Do not copy this file into prisma/migrations. Run it only after
-- preflight.sql and functions.sql, and before triggers.sql is approved.
-- It does not attach triggers, backfill, or authorize summary_ready.
-- It refuses a non-local database whose name does not contain "test".
--
-- functions.sql stays invoker and grants the invoker superset. This file
-- moves ownership to sa360_schema_owner, marks every summary function
-- owner-rights except the committing procedure, and leaves sa360_app with
-- direct execute on the three trigger functions only.

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF current_database() !~* 'test' THEN
    RAISE EXCEPTION 'owner-rights transform refused: database name must contain test';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND inet_server_addr() <> '127.0.0.1'::inet
     AND inet_server_addr() <> '::1'::inet
  THEN
    RAISE EXCEPTION 'owner-rights transform refused: server is not local';
  END IF;
  IF current_user IN ('sa360_app', 'sa360_summary_runtime') THEN
    RAISE EXCEPTION 'owner-rights transform refused: runtime session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'sa360_schema_owner' AND NOT rolcanlogin AND NOT rolsuper
  ) THEN
    RAISE EXCEPTION 'owner-rights transform refused: sa360_schema_owner is missing';
  END IF;
END
$guard$;

DO $own$
DECLARE
  object_name text;
  object_owner text;
  routine_name text;
  routine_args text;
  routine_kind "char";
BEGIN
  IF NOT pg_has_role(current_user, 'sa360_schema_owner', 'SET') THEN
    RAISE EXCEPTION 'owner-rights transform refused: session cannot SET ROLE sa360_schema_owner';
  END IF;

  FOREACH object_name IN ARRAY ARRAY[
    'historical_catalog_summary_label',
    'historical_catalog_summary_bucket',
    'historical_catalog_summary_membership',
    'historical_catalog_summary_checkpoint',
    'historical_catalog_summary_control'
  ]
  LOOP
    SELECT pg_get_userbyid(relowner)
    INTO object_owner
    FROM pg_class
    WHERE oid = to_regclass(format('public.%I', object_name));
    IF object_owner IS NULL THEN
      RAISE EXCEPTION 'owner-rights transform refused: missing table %', object_name;
    END IF;
    IF object_owner IS DISTINCT FROM 'sa360_schema_owner' THEN
      IF object_owner IS DISTINCT FROM current_user THEN
        RAISE EXCEPTION 'owner-rights transform refused: % is owned by %', object_name, object_owner;
      END IF;
      EXECUTE format('ALTER TABLE public.%I OWNER TO sa360_schema_owner', object_name);
    END IF;
  END LOOP;
  -- BIGSERIAL sequences follow the table. Altering one the table already moved
  -- fails with "must be owner of sequence", so only a sequence still owned by
  -- this session is transferred here.
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
    IF object_owner IS NULL THEN
      RAISE EXCEPTION 'owner-rights transform refused: missing sequence %', object_name;
    END IF;
    IF object_owner IS DISTINCT FROM 'sa360_schema_owner' THEN
      IF object_owner IS DISTINCT FROM current_user THEN
        RAISE EXCEPTION 'owner-rights transform refused: % is owned by %', object_name, object_owner;
      END IF;
      EXECUTE format('ALTER SEQUENCE public.%I OWNER TO sa360_schema_owner', object_name);
    END IF;
  END LOOP;
  FOREACH object_name IN ARRAY ARRAY[
    'historical_catalog_summary_apply_desired',
    'historical_catalog_summary_apply_delta'
  ]
  LOOP
    SELECT pg_get_userbyid(typowner)
    INTO object_owner
    FROM pg_type
    JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_type.typname = object_name;
    IF object_owner IS NULL THEN
      RAISE EXCEPTION 'owner-rights transform refused: missing type %', object_name;
    END IF;
    IF object_owner IS DISTINCT FROM 'sa360_schema_owner' THEN
      IF object_owner IS DISTINCT FROM current_user THEN
        RAISE EXCEPTION 'owner-rights transform refused: % is owned by %', object_name, object_owner;
      END IF;
      EXECUTE format('ALTER TYPE public.%I OWNER TO sa360_schema_owner', object_name);
    END IF;
  END LOOP;

  FOR routine_name, routine_args, routine_kind IN
    SELECT routine.proname, pg_get_function_identity_arguments(routine.oid), routine.prokind
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.proname LIKE 'historical_catalog_summary_%'
  LOOP
    -- Ownership moves last. The migration login is INHERIT FALSE, so the
    -- moment the owner changes it can no longer alter the routine.
    IF routine_kind = 'p' THEN
      EXECUTE format(
        'ALTER PROCEDURE public.%I(%s) SECURITY INVOKER',
        routine_name,
        routine_args
      );
      EXECUTE format(
        'ALTER PROCEDURE public.%I(%s) OWNER TO sa360_schema_owner',
        routine_name,
        routine_args
      );
    ELSE
      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) SECURITY DEFINER',
        routine_name,
        routine_args
      );
      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) SET search_path = pg_catalog, public, pg_temp',
        routine_name,
        routine_args
      );
      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) OWNER TO sa360_schema_owner',
        routine_name,
        routine_args
      );
    END IF;
  END LOOP;
END
$own$;

-- Membership in the owner is INHERIT FALSE. Grants on objects the owner now
-- holds have to run as that role. Inventory grants stay with the migration
-- login, which still owns those tables.
SET LOCAL ROLE sa360_schema_owner;

REVOKE ALL ON TABLE
  public.historical_catalog_summary_label,
  public.historical_catalog_summary_bucket,
  public.historical_catalog_summary_membership,
  public.historical_catalog_summary_checkpoint,
  public.historical_catalog_summary_control
FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader, PUBLIC;

REVOKE ALL ON SEQUENCE
  public.historical_catalog_summary_label_label_pair_id_seq,
  public.historical_catalog_summary_bucket_bucket_id_seq,
  public.historical_catalog_summary_checkpoint_chunk_id_seq
FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader, PUBLIC;

REVOKE ALL ON FUNCTION public.historical_catalog_summary_chunk_cap() FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_label_token(text, text) FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_failure_reason(text) FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_mark_unready(text, boolean) FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_label_id(text, text) FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_apply_items_once(text[]) FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_apply_items_work(text[]) FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_apply_item(text) FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_backfill_chunk(text, text) FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_checkpoint_open(text, text) FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_checkpoint_complete(bigint, integer) FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON PROCEDURE public.historical_catalog_summary_backfill_range(text, text) FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_readable() FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_lock_for_reconcile() FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_reconcile_issues() FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_reconcile() FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_authorize() FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_chunk_bounds() FROM PUBLIC, sa360_app, sa360_summary_runtime;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_item_trg() FROM PUBLIC, sa360_summary_operator;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_event_trg() FROM PUBLIC, sa360_summary_operator;
REVOKE ALL ON FUNCTION public.historical_catalog_summary_lot_trg() FROM PUBLIC, sa360_summary_operator;

GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_item_trg() TO sa360_summary_runtime, sa360_app;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_event_trg() TO sa360_summary_runtime, sa360_app;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_lot_trg() TO sa360_summary_runtime, sa360_app;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_mark_unready(text, boolean) TO sa360_summary_operator;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_backfill_chunk(text, text) TO sa360_summary_operator;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_checkpoint_open(text, text) TO sa360_summary_operator;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_checkpoint_complete(bigint, integer) TO sa360_summary_operator;
GRANT EXECUTE ON PROCEDURE public.historical_catalog_summary_backfill_range(text, text) TO sa360_summary_operator;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_readable() TO sa360_summary_operator, sa360_summary_reader;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_lock_for_reconcile() TO sa360_summary_operator;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_reconcile_issues() TO sa360_summary_operator;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_reconcile() TO sa360_summary_operator;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_authorize() TO sa360_summary_operator;
GRANT EXECUTE ON FUNCTION public.historical_catalog_summary_chunk_bounds() TO sa360_summary_operator;

-- The migration login owns the inventory tables and attaches the triggers.
-- Trigger creation and any later inventory write in a migration require
-- EXECUTE on the entrypoint. Helpers stay revoked from this login.
DO $migrate_execute$
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION
       public.historical_catalog_summary_item_trg(),
       public.historical_catalog_summary_event_trg(),
       public.historical_catalog_summary_lot_trg()
     TO %I',
    session_user
  );
END
$migrate_execute$;

RESET ROLE;

GRANT SELECT ON TABLE
  public."InventoryLot",
  public."SourceLeadEvent",
  public."LeadInventoryItem",
  public.historical_catalog_projection,
  public.historical_catalog_projection_source
TO sa360_schema_owner;

COMMIT;
