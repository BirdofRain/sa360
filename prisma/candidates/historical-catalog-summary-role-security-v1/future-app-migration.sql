-- Representative future application migration. Not a Prisma migration.
--
-- Ordinary tables stay in public and receive an explicit grant in the same
-- migration that creates them. Summary objects do not. This file refuses a
-- database whose name does not contain "test".

BEGIN;

DO $guard$
BEGIN
  IF current_database() !~* 'test' THEN
    RAISE EXCEPTION 'future migration refused: database name must contain test';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND inet_server_addr() <> '127.0.0.1'::inet
     AND inet_server_addr() <> '::1'::inet
  THEN
    RAISE EXCEPTION 'future migration refused: server is not local';
  END IF;
  IF current_user = 'sa360_app' THEN
    RAISE EXCEPTION 'future migration refused: application login cannot own schema changes';
  END IF;
END
$guard$;

CREATE TABLE public."Gate14FutureApp" (
  id text PRIMARY KEY,
  note text NOT NULL
);

CREATE SEQUENCE public."Gate14FutureApp_seq";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Gate14FutureApp" TO sa360_app;
GRANT USAGE, SELECT ON SEQUENCE public."Gate14FutureApp_seq" TO sa360_app;

COMMIT;
