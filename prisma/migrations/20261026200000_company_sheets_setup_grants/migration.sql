-- Grant-only correction for the company Sheets setup tables created by
-- 20261023220000_company_sheets_setup_links.
--
-- This is not execution approval. Applying it on a database where sa360_app
-- already exists grants the privileges below. It does not issue a password,
-- change a role or membership, transfer ownership, or edit default privileges.
--
-- CompanySheetsClientFolder: SELECT, INSERT, UPDATE, DELETE.
-- The setup service claims, updates, upserts, and deletes an unconfirmed
-- first claim. Unlink updates the row and keeps it.
-- CompanySheetsFolderEvent: SELECT, INSERT.
-- History is append-only. Unlink inserts an event and does not update or
-- delete one.
-- CompanySheetsSpreadsheetLink: SELECT, INSERT, UPDATE.
-- A destination save inserts the current link and updates the prior current
-- link. It does not delete link rows.
--
-- No TRUNCATE, REFERENCES, or TRIGGER privilege is granted. There is no
-- GRANT ALL and no grant to PUBLIC.
--
-- Loopback development databases can migrate before sa360_app exists. This
-- file then records the migration and grants nothing. Creating the role later
-- does not apply the grants: Boundary A is checksum-pinned and does not name
-- these tables, and its relation inventory refuses a database that already
-- contains them. Re-run this file as the table owner after the role exists.
-- Prisma will not re-run a recorded migration.
--
-- A non-loopback session without sa360_app fails. A managed migrate cannot
-- record this migration as applied while the grants are missing.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."CompanySheetsClientFolder" TO sa360_app;
    GRANT SELECT, INSERT ON TABLE public."CompanySheetsFolderEvent" TO sa360_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE public."CompanySheetsSpreadsheetLink" TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'company sheets setup grants skipped: sa360_app is absent on loopback; re-run this file after the role exists';
    RETURN;
  END IF;

  RAISE EXCEPTION 'company sheets setup grants refused: sa360_app is absent';
END
$grant$;
