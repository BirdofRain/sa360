-- One-time staff enrollment grants.
--
-- Empty tables only. No staff principal is inserted. No Google subject is
-- bound. No permission is granted. No invitation secret is stored.
-- This does not alter StaffPrincipal triggers, StaffPermission, ClientAccount,
-- GoogleAccountConnection, or CompanyGoogleConnection.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. SET LOCAL lock_timeout applies only inside this transaction.
--
-- One pending grant per principal is the partial index
-- StaffEnrollmentGrant_one_pending_key. Prisma 6 cannot model that filter.
-- Do not drop the index in a later generated migrate diff.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TYPE "StaffEnrollmentGrantStatus" AS ENUM ('pending', 'consumed', 'canceled');

CREATE TYPE "StaffEnrollmentEventKind" AS ENUM ('issued', 'canceled', 'consumed');

CREATE TABLE "StaffEnrollmentGrant" (
    "id" TEXT NOT NULL,
    "staffPrincipalId" TEXT NOT NULL,
    "secretDigest" TEXT NOT NULL,
    "status" "StaffEnrollmentGrantStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffEnrollmentGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffEnrollmentGrant_secretDigest_key"
  ON "StaffEnrollmentGrant"("secretDigest");

CREATE INDEX "StaffEnrollmentGrant_staffPrincipalId_status_idx"
  ON "StaffEnrollmentGrant"("staffPrincipalId", "status");

CREATE UNIQUE INDEX "StaffEnrollmentGrant_one_pending_key"
  ON "StaffEnrollmentGrant"("staffPrincipalId")
  WHERE "status" = 'pending';

ALTER TABLE "StaffEnrollmentGrant"
  ADD CONSTRAINT "StaffEnrollmentGrant_secret_digest_chk"
  CHECK ("secretDigest" ~ '^[a-f0-9]{64}$');

ALTER TABLE "StaffEnrollmentGrant"
  ADD CONSTRAINT "StaffEnrollmentGrant_expiry_chk"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "StaffEnrollmentGrant"
  ADD CONSTRAINT "StaffEnrollmentGrant_status_shape_chk"
  CHECK (
    (
      "status" = 'pending'
      AND "consumedAt" IS NULL
      AND "canceledAt" IS NULL
    )
    OR (
      "status" = 'consumed'
      AND "consumedAt" IS NOT NULL
      AND "canceledAt" IS NULL
    )
    OR (
      "status" = 'canceled'
      AND "canceledAt" IS NOT NULL
      AND "consumedAt" IS NULL
    )
  );

ALTER TABLE "StaffEnrollmentGrant"
  ADD CONSTRAINT "StaffEnrollmentGrant_staffPrincipalId_fkey"
  FOREIGN KEY ("staffPrincipalId") REFERENCES "StaffPrincipal"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "StaffEnrollmentEvent" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "staffPrincipalId" TEXT NOT NULL,
    "kind" "StaffEnrollmentEventKind" NOT NULL,
    "googleSub" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffEnrollmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffEnrollmentEvent_staffPrincipalId_createdAt_idx"
  ON "StaffEnrollmentEvent"("staffPrincipalId", "createdAt");

ALTER TABLE "StaffEnrollmentEvent"
  ADD CONSTRAINT "StaffEnrollmentEvent_google_sub_chk"
  CHECK (
    (
      "kind" = 'consumed'
      AND "googleSub" IS NOT NULL
      AND char_length("googleSub") BETWEEN 10 AND 255
      AND "googleSub" = btrim("googleSub")
      AND position(' ' IN "googleSub") = 0
    )
    OR (
      "kind" IN ('issued', 'canceled')
      AND "googleSub" IS NULL
    )
  );

ALTER TABLE "StaffEnrollmentEvent"
  ADD CONSTRAINT "StaffEnrollmentEvent_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "StaffEnrollmentGrant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION staff_enrollment_grant_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."staffPrincipalId" IS DISTINCT FROM OLD."staffPrincipalId"
     OR NEW."secretDigest" IS DISTINCT FROM OLD."secretDigest"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
    RAISE EXCEPTION 'StaffEnrollmentGrant identity columns are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'consumed' OR OLD."status" = 'canceled' THEN
    RAISE EXCEPTION 'a finished StaffEnrollmentGrant cannot change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'pending' AND NEW."status" NOT IN ('pending', 'consumed', 'canceled') THEN
    RAISE EXCEPTION 'StaffEnrollmentGrant status is unknown'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."consumedAt" IS NOT NULL AND NEW."consumedAt" IS DISTINCT FROM OLD."consumedAt" THEN
    RAISE EXCEPTION 'StaffEnrollmentGrant.consumedAt is immutable once set'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."canceledAt" IS NOT NULL AND NEW."canceledAt" IS DISTINCT FROM OLD."canceledAt" THEN
    RAISE EXCEPTION 'StaffEnrollmentGrant.canceledAt is immutable once set'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "StaffEnrollmentGrant_lifecycle_guard"
BEFORE UPDATE ON "StaffEnrollmentGrant"
FOR EACH ROW
EXECUTE FUNCTION staff_enrollment_grant_guard();

CREATE FUNCTION staff_enrollment_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'StaffEnrollment rows are retained'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "StaffEnrollmentGrant_no_delete"
BEFORE DELETE ON "StaffEnrollmentGrant"
FOR EACH ROW
EXECUTE FUNCTION staff_enrollment_reject_delete();

CREATE TRIGGER "StaffEnrollmentGrant_no_truncate"
BEFORE TRUNCATE ON "StaffEnrollmentGrant"
FOR EACH STATEMENT
EXECUTE FUNCTION staff_enrollment_reject_delete();

CREATE FUNCTION staff_enrollment_event_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'StaffEnrollmentEvent rows are immutable'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "StaffEnrollmentEvent_no_update"
BEFORE UPDATE ON "StaffEnrollmentEvent"
FOR EACH ROW
EXECUTE FUNCTION staff_enrollment_event_guard();

CREATE TRIGGER "StaffEnrollmentEvent_no_delete"
BEFORE DELETE ON "StaffEnrollmentEvent"
FOR EACH ROW
EXECUTE FUNCTION staff_enrollment_reject_delete();

CREATE TRIGGER "StaffEnrollmentEvent_no_truncate"
BEFORE TRUNCATE ON "StaffEnrollmentEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION staff_enrollment_reject_delete();

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."StaffEnrollmentGrant",
      public."StaffEnrollmentEvent"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'staff enrollment grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'staff enrollment grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
