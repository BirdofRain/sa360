-- Runtime grants for the Meta capture tables created by
-- 20261104230000_meta_multi_page_capture_foundation.
--
-- There is no ALTER DEFAULT PRIVILEGES grant to sa360_app. A table created by
-- the migrate login is not visible to sa360_app until this migration grants it.
-- The migrate login remains the table owner. This block does not SET ROLE,
-- create a role, issue a password, or change default privileges.
--
-- Loopback databases can migrate before sa360_app exists. This block then
-- grants nothing. A non-loopback session without sa360_app fails.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."MetaGraphCredential",
      public."MetaPageCaptureGrant",
      public."MetaFormCandidate"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'meta capture grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'meta capture grants refused: sa360_app is absent';
END
$grant$;
