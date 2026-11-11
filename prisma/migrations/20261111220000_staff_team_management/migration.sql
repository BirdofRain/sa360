-- Staff team management invitations and audit.
--
-- Adds team_workspace, team_manager, and team_operations permission keys.
-- Adds empty StaffInvitation and StaffManagementEvent tables.
-- Does not insert a StaffPrincipal, bind a Google subject, or grant any permission.
-- Does not alter StaffEnrollmentGrant, Admin C.O.C. sessions, portal sessions,
-- observer sessions, or Meta reviewer sessions.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. The new StaffPermissionKey values are not used in this transaction.
-- StaffPermission_one_effective_grant_key already covers every permission key.
-- Do not drop that index.
--
-- One pending invitation per principal is StaffInvitation_one_pending_key.
-- Prisma 6 cannot model that filter. Do not drop the index in a later diff.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TYPE "StaffPermissionKey" ADD VALUE IF NOT EXISTS 'team_workspace';
ALTER TYPE "StaffPermissionKey" ADD VALUE IF NOT EXISTS 'team_manager';
ALTER TYPE "StaffPermissionKey" ADD VALUE IF NOT EXISTS 'team_operations';

CREATE TYPE "StaffAccessLevel" AS ENUM ('administrator', 'manager', 'operations');

CREATE TYPE "StaffInvitationStatus" AS ENUM ('pending', 'consumed', 'canceled');

CREATE TYPE "StaffManagementEventKind" AS ENUM (
  'invited',
  'invitation_renewed',
  'invitation_canceled',
  'invitation_consumed',
  'invitation_email_sent',
  'invitation_email_skipped',
  'role_changed',
  'permissions_revoked',
  'disabled',
  'signed_in',
  'claim_rejected'
);

CREATE TABLE "StaffInvitation" (
    "id" TEXT NOT NULL,
    "staffPrincipalId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessLevel" "StaffAccessLevel" NOT NULL,
    "status" "StaffInvitationStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByStaffPrincipalId" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffInvitation_staffPrincipalId_status_idx"
  ON "StaffInvitation"("staffPrincipalId", "status");

CREATE INDEX "StaffInvitation_email_status_idx"
  ON "StaffInvitation"("email", "status");

CREATE UNIQUE INDEX "StaffInvitation_one_pending_key"
  ON "StaffInvitation"("staffPrincipalId")
  WHERE "status" = 'pending';

ALTER TABLE "StaffInvitation"
  ADD CONSTRAINT "StaffInvitation_email_normalized_chk"
  CHECK (
    "email" = lower(btrim("email"))
    AND char_length("email") BETWEEN 3 AND 320
    AND "email" LIKE '%_@_%._%'
    AND position(' ' IN "email") = 0
  );

ALTER TABLE "StaffInvitation"
  ADD CONSTRAINT "StaffInvitation_expiry_chk"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "StaffInvitation"
  ADD CONSTRAINT "StaffInvitation_status_shape_chk"
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

ALTER TABLE "StaffInvitation"
  ADD CONSTRAINT "StaffInvitation_staffPrincipalId_fkey"
  FOREIGN KEY ("staffPrincipalId") REFERENCES "StaffPrincipal"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "StaffInvitation"
  ADD CONSTRAINT "StaffInvitation_invitedByStaffPrincipalId_fkey"
  FOREIGN KEY ("invitedByStaffPrincipalId") REFERENCES "StaffPrincipal"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "StaffManagementEvent" (
    "id" TEXT NOT NULL,
    "staffPrincipalId" TEXT NOT NULL,
    "actorStaffPrincipalId" TEXT,
    "kind" "StaffManagementEventKind" NOT NULL,
    "detail" TEXT,
    "googleSub" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffManagementEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffManagementEvent_staffPrincipalId_createdAt_idx"
  ON "StaffManagementEvent"("staffPrincipalId", "createdAt");

ALTER TABLE "StaffManagementEvent"
  ADD CONSTRAINT "StaffManagementEvent_detail_chk"
  CHECK (
    "detail" IS NULL
    OR "detail" ~ '^[a-z0-9_]{1,80}$'
  );

ALTER TABLE "StaffManagementEvent"
  ADD CONSTRAINT "StaffManagementEvent_google_sub_chk"
  CHECK (
    "googleSub" IS NULL
    OR (
      char_length("googleSub") BETWEEN 10 AND 255
      AND "googleSub" = btrim("googleSub")
      AND position(' ' IN "googleSub") = 0
    )
  );

ALTER TABLE "StaffManagementEvent"
  ADD CONSTRAINT "StaffManagementEvent_staffPrincipalId_fkey"
  FOREIGN KEY ("staffPrincipalId") REFERENCES "StaffPrincipal"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION staff_invitation_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."staffPrincipalId" IS DISTINCT FROM OLD."staffPrincipalId"
     OR NEW."email" IS DISTINCT FROM OLD."email"
     OR NEW."invitedByStaffPrincipalId" IS DISTINCT FROM OLD."invitedByStaffPrincipalId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'StaffInvitation identity columns are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'consumed' THEN
    RAISE EXCEPTION 'a consumed StaffInvitation cannot change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'canceled' AND NEW."status" = 'consumed' THEN
    RAISE EXCEPTION 'a canceled StaffInvitation cannot be consumed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'pending' AND NEW."expiresAt" < OLD."expiresAt" THEN
    RAISE EXCEPTION 'StaffInvitation expiry cannot move earlier'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."consumedAt" IS NOT NULL AND NEW."consumedAt" IS DISTINCT FROM OLD."consumedAt" THEN
    RAISE EXCEPTION 'StaffInvitation.consumedAt is immutable once set'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "StaffInvitation_lifecycle_guard"
BEFORE UPDATE ON "StaffInvitation"
FOR EACH ROW
EXECUTE FUNCTION staff_invitation_guard();

CREATE FUNCTION staff_team_management_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'Staff team management rows are retained'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER "StaffInvitation_no_delete"
BEFORE DELETE ON "StaffInvitation"
FOR EACH ROW
EXECUTE FUNCTION staff_team_management_reject_delete();

CREATE TRIGGER "StaffInvitation_no_truncate"
BEFORE TRUNCATE ON "StaffInvitation"
FOR EACH STATEMENT
EXECUTE FUNCTION staff_team_management_reject_delete();

CREATE TRIGGER "StaffManagementEvent_no_update"
BEFORE UPDATE ON "StaffManagementEvent"
FOR EACH ROW
EXECUTE FUNCTION staff_team_management_reject_delete();

CREATE TRIGGER "StaffManagementEvent_no_delete"
BEFORE DELETE ON "StaffManagementEvent"
FOR EACH ROW
EXECUTE FUNCTION staff_team_management_reject_delete();

CREATE TRIGGER "StaffManagementEvent_no_truncate"
BEFORE TRUNCATE ON "StaffManagementEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION staff_team_management_reject_delete();

-- Runtime grant for the new tables only. There is no ALTER DEFAULT PRIVILEGES.
-- Loopback databases can migrate before sa360_app exists. A non-loopback
-- session without sa360_app fails and rolls back.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."StaffInvitation",
      public."StaffManagementEvent"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'staff team management grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'staff team management grants refused: sa360_app is absent';
END
$grant$;

COMMIT;
