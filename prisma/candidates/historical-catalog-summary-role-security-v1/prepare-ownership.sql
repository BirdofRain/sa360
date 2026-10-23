-- Boundary A ownership preparation. Inert outside a disposable test database.
--
-- Do not copy this file into prisma/migrations. It contains no passwords and
-- no customer data. It refuses unless the database name contains "test" and
-- the server address is local. Production role creation is a separate
-- approval; do not point this file at defaultdb.
--
-- The session user is the migration login. It must already be able to create
-- roles. This script creates no superuser and does not grant CREATEROLE,
-- BYPASSRLS, or public CREATE to sa360_app.

-- Role creation cannot sit inside an explicit transaction. The guard runs
-- first and stops the file before any role is created.

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

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_schema_owner') THEN
    CREATE ROLE sa360_schema_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
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
$roles$;

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

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO sa360_app, sa360_schema_owner, sa360_summary_runtime,
  sa360_summary_operator, sa360_summary_reader;
GRANT CREATE ON SCHEMA public TO sa360_schema_owner;
REVOKE CREATE ON SCHEMA public FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader;

CREATE SCHEMA IF NOT EXISTS sa360_summary;
REVOKE ALL ON SCHEMA sa360_summary FROM PUBLIC;
REVOKE ALL ON SCHEMA sa360_summary FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader;
ALTER SCHEMA sa360_summary OWNER TO sa360_schema_owner;

ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  REVOKE ALL ON TABLES FROM sa360_app, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM sa360_app, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM sa360_app, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA sa360_summary
  REVOKE ALL ON TABLES FROM sa360_app, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA sa360_summary
  REVOKE ALL ON SEQUENCES FROM sa360_app, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA sa360_summary
  REVOKE ALL ON FUNCTIONS FROM sa360_app, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sa360_app;
REVOKE ALL ON TABLE
  public.historical_catalog_summary_label,
  public.historical_catalog_summary_bucket,
  public.historical_catalog_summary_membership,
  public.historical_catalog_summary_checkpoint,
  public.historical_catalog_summary_control
FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader, PUBLIC;

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

DO $sequences$
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
$sequences$;

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

COMMIT;
