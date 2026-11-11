-- Add the explicit Admin C.O.C. staff permission.
--
-- This adds an enum value only. It does not insert a StaffPrincipal, bind a
-- Google subject, or grant admin_coc or facebook_association_correction.
-- Existing Admin C.O.C. sessions, portal sessions, observer sessions, and
-- Meta reviewer sessions are unchanged.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. prisma migrate deploy sends the file through simple_query and
-- does not wrap it. The new value is not used in this transaction.
--
-- StaffPermission_one_effective_grant_key already covers every permission
-- key. Do not drop that index.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TYPE "StaffPermissionKey" ADD VALUE IF NOT EXISTS 'admin_coc';

COMMIT;
