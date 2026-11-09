-- Staff identity and permission foundation.
--
-- Empty tables only. No staff principal is inserted. No permission is granted.
-- This does not alter ClientAccount, GoogleAccountConnection,
-- CompanyGoogleConnection, Admin C.O.C. sessions, or any existing credential.
-- It does not store a password, a session, or an OAuth token.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. prisma migrate deploy (Prisma 6.19, sa360-migrate) sends the file
-- through simple_query and does not wrap it. SET LOCAL lock_timeout applies
-- only inside this transaction.
--
-- Effective permission uniqueness is the partial index
-- StaffPermission_one_effective_grant_key
-- (staffPrincipalId, permission) WHERE status = 'granted'.
-- Prisma 6 cannot model that filter as @@unique. Do not drop the index in a
-- later generated migrate diff. Revoked rows stay so a later grant can be a
-- new row.
--
-- A permission authorizes only when the grant is status granted, revokedAt is
-- null, the principal is status active, and disabledAt is null. Absence of
-- that row is denial. This migration does not evaluate that predicate.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "StaffIdentityProvider" AS ENUM ('google');

CREATE TYPE "StaffPrincipalStatus" AS ENUM ('disabled', 'active');

CREATE TYPE "StaffPermissionKey" AS ENUM ('facebook_association_correction');

CREATE TYPE "StaffPermissionStatus" AS ENUM ('granted', 'revoked');

CREATE TABLE "StaffPrincipal" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "provider" "StaffIdentityProvider" NOT NULL DEFAULT 'google',
    "providerSubject" TEXT,
    "status" "StaffPrincipalStatus" NOT NULL DEFAULT 'disabled',
    "disabledAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPrincipal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffPrincipal_email_key"
  ON "StaffPrincipal"("email");

-- Unbound principals keep a null providerSubject. PostgreSQL unique treats
-- those nulls as distinct, so many provisioned rows can coexist. A bound
-- Google sub cannot belong to two principals.
CREATE UNIQUE INDEX "StaffPrincipal_provider_subject_key"
  ON "StaffPrincipal"("provider", "providerSubject");

CREATE INDEX "StaffPrincipal_status_idx"
  ON "StaffPrincipal"("status");

ALTER TABLE "StaffPrincipal"
  ADD CONSTRAINT "StaffPrincipal_email_normalized_chk"
  CHECK (
    "email" = lower(btrim("email"))
    AND char_length("email") BETWEEN 3 AND 320
    AND "email" LIKE '%_@_%._%'
    AND position(' ' IN "email") = 0
  );

ALTER TABLE "StaffPrincipal"
  ADD CONSTRAINT "StaffPrincipal_display_name_chk"
  CHECK (
    "displayName" IS NULL
    OR (
      char_length("displayName") BETWEEN 1 AND 200
      AND "displayName" = btrim("displayName")
    )
  );

ALTER TABLE "StaffPrincipal"
  ADD CONSTRAINT "StaffPrincipal_provider_subject_chk"
  CHECK (
    "providerSubject" IS NULL
    OR (
      char_length("providerSubject") BETWEEN 1 AND 255
      AND "providerSubject" = btrim("providerSubject")
      AND position(' ' IN "providerSubject") = 0
    )
  );

-- active and disabled are mutually exclusive shapes. A generic insert stays
-- disabled because disabledAt defaults to now().
ALTER TABLE "StaffPrincipal"
  ADD CONSTRAINT "StaffPrincipal_status_disabled_at_chk"
  CHECK (
    (
      "status" = 'active'
      AND "disabledAt" IS NULL
    )
    OR (
      "status" = 'disabled'
      AND "disabledAt" IS NOT NULL
    )
  );

CREATE TABLE "StaffPermission" (
    "id" TEXT NOT NULL,
    "staffPrincipalId" TEXT NOT NULL,
    "permission" "StaffPermissionKey" NOT NULL,
    "status" "StaffPermissionStatus" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPermission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffPermission_staffPrincipalId_permission_idx"
  ON "StaffPermission"("staffPrincipalId", "permission");

-- One effective grant per principal and permission. Revoked rows are excluded
-- so history can remain and a replacement grant can be inserted.
CREATE UNIQUE INDEX "StaffPermission_one_effective_grant_key"
  ON "StaffPermission"("staffPrincipalId", "permission")
  WHERE "status" = 'granted';

ALTER TABLE "StaffPermission"
  ADD CONSTRAINT "StaffPermission_lifecycle_chk"
  CHECK (
    (
      "status" = 'granted'
      AND "revokedAt" IS NULL
    )
    OR (
      "status" = 'revoked'
      AND "revokedAt" IS NOT NULL
      AND "revokedAt" >= "grantedAt"
    )
  );

-- Restrict: a principal id that already has a grant cannot be removed or
-- rewritten through the permission row. The delete triggers reject both
-- deletes even when no grant exists.
ALTER TABLE "StaffPermission"
  ADD CONSTRAINT "StaffPermission_staffPrincipalId_fkey"
  FOREIGN KEY ("staffPrincipalId") REFERENCES "StaffPrincipal"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION staff_principal_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'StaffPrincipal.id is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."providerSubject" IS NOT NULL
     AND (
       NEW."provider" IS DISTINCT FROM OLD."provider"
       OR NEW."providerSubject" IS DISTINCT FROM OLD."providerSubject"
     ) THEN
    RAISE EXCEPTION 'StaffPrincipal provider binding is immutable once set'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "StaffPrincipal_binding_guard"
BEFORE UPDATE ON "StaffPrincipal"
FOR EACH ROW
EXECUTE FUNCTION staff_principal_binding_guard();

CREATE FUNCTION staff_principal_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'StaffPrincipal rows are retained'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "StaffPrincipal_no_delete"
BEFORE DELETE ON "StaffPrincipal"
FOR EACH ROW
EXECUTE FUNCTION staff_principal_reject_delete();

CREATE TRIGGER "StaffPrincipal_no_truncate"
BEFORE TRUNCATE ON "StaffPrincipal"
FOR EACH STATEMENT
EXECUTE FUNCTION staff_principal_reject_delete();

CREATE FUNCTION staff_permission_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."staffPrincipalId" IS DISTINCT FROM OLD."staffPrincipalId"
     OR NEW."permission" IS DISTINCT FROM OLD."permission"
     OR NEW."grantedAt" IS DISTINCT FROM OLD."grantedAt" THEN
    RAISE EXCEPTION 'StaffPermission identity columns are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'revoked' AND NEW."status" IS DISTINCT FROM 'revoked' THEN
    RAISE EXCEPTION 'a revoked StaffPermission cannot be reactivated'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
    RAISE EXCEPTION 'StaffPermission.revokedAt is immutable once set'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "StaffPermission_lifecycle_guard"
BEFORE UPDATE ON "StaffPermission"
FOR EACH ROW
EXECUTE FUNCTION staff_permission_lifecycle_guard();

CREATE FUNCTION staff_permission_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'StaffPermission rows are retained'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "StaffPermission_no_delete"
BEFORE DELETE ON "StaffPermission"
FOR EACH ROW
EXECUTE FUNCTION staff_permission_reject_delete();

CREATE TRIGGER "StaffPermission_no_truncate"
BEFORE TRUNCATE ON "StaffPermission"
FOR EACH STATEMENT
EXECUTE FUNCTION staff_permission_reject_delete();

-- Runtime grant for the new tables only. There is no ALTER DEFAULT PRIVILEGES.
-- The migrate login remains the table owner. This block does not SET ROLE,
-- create a role, issue a password, or change default privileges.
-- Loopback databases can migrate before sa360_app exists. This block then
-- grants nothing. A non-loopback session without sa360_app fails and rolls back.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."StaffPrincipal",
      public."StaffPermission"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'staff principal grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'staff principal grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
