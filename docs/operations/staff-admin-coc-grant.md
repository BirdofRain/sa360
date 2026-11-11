# Grant full Admin C.O.C. access to one staff principal

This procedure is for after the `admin_coc` migration is applied. It does not
run as part of that migration. Do not run it until a named operator has a
written approval for this exact principal.

The first approved principal is:

| Field | Value |
| --- | --- |
| Email | `sam@lifeagentlaunch.com` |
| StaffPrincipal ID | `cmwc9uuyp0147m50uh3zdsyg3` |
| Permission | `admin_coc` only |

Do not grant any other principal in the same change. Do not grant
`facebook_association_correction`. Do not change Google OAuth secrets,
`SA360_STAFF_GOOGLE_SIGNIN_ENABLED`, or `SA360_STAFF_ENROLLMENT_ENABLED`.

The calls go to the API origin, not the Admin C.O.C. origin. Confirm the live
hostnames still match `docs/operations/staff-first-login-activation.md`
before calling them. The API origin recorded there is
`https://sa360-sw6oq.ondigitalocean.app`.

`SA360_STAFF_ENROLLMENT_ISSUER_SECRET` must already be set on the API and must
stay distinct from the staff session secret, the staff service secret, and
the admin secrets. The header is `x-sa360-staff-enrollment-issuer`. Send it
only from a trusted operator shell. Do not put it in the browser, in Admin
C.O.C. env, or in this repository.

## 1. Confirm the migration and the current row

Confirm `\dT+ "StaffPermissionKey"` includes `admin_coc` and that this query
returns zero:

```sql
SELECT count(*)
FROM "StaffPermission"
WHERE permission = 'admin_coc';
```

Then read the principal. Enrollment does not need to be enabled.

```http
POST /internal/staff/admin-coc/status
x-sa360-staff-enrollment-issuer: <issuer secret>
content-type: application/json

{"staffPrincipalId":"cmwc9uuyp0147m50uh3zdsyg3"}
```

Stop unless the response is all of the following:

- `ok` is true
- `email` is exactly `sam@lifeagentlaunch.com`
- `status` is `active`
- `providerSubject` is the Google subject already verified for this person
- `adminCoc` is `absent`

A 404 means the issuer secret is missing or not distinct. A 401 means the
header or the id was rejected. Do not retry with a different email.

## 2. Grant

```http
POST /internal/staff/admin-coc/grant
x-sa360-staff-enrollment-issuer: <issuer secret>
content-type: application/json

{"staffPrincipalId":"cmwc9uuyp0147m50uh3zdsyg3","email":"sam@lifeagentlaunch.com"}
```

Record the response outside the database. It is the audit record together
with the retained `StaffPermission` row:

- `permission` is `admin_coc`
- `status` is `granted`
- `staffPrincipalId` is `cmwc9uuyp0147m50uh3zdsyg3`
- `email` is `sam@lifeagentlaunch.com`
- `staffPermissionId` is a new id
- `alreadyGranted` is false

Confirm the correction permission was not created:

```sql
SELECT permission, status, "revokedAt"
FROM "StaffPermission"
WHERE "staffPrincipalId" = 'cmwc9uuyp0147m50uh3zdsyg3';
```

The only new granted row is `admin_coc`. `facebook_association_correction`
must still be absent.

## 3. Accept the sign-in

On the Admin C.O.C. origin, open `/staff/google/start` in a fresh browser
profile. A successful Google sign-in for this principal must land on `/`
(Command Center), not on the staff placeholder. Logout, then present the
copied staff cookie: the Command Center and admin BFF routes must deny it.
The shared-password login at `/login` must still open the Command Center.

## Revoke

Use this when the grant must stop and the principal should remain able to
sign in without Admin C.O.C. access.

```http
POST /internal/staff/admin-coc/revoke
x-sa360-staff-enrollment-issuer: <issuer secret>
content-type: application/json

{"staffPrincipalId":"cmwc9uuyp0147m50uh3zdsyg3","email":"sam@lifeagentlaunch.com"}
```

A successful response has `status` `revoked` and the same permission id that
was granted. The row remains. The next privileged request with the old
browser cookie must fail even though the cookie has not expired. Sign-in
then shows the access-denied screen at `/staff`.

To withdraw every staff session for this person, also disable the principal
with the existing enrollment disable route while enrollment is enabled, or
follow `docs/operations/staff-first-login-activation.md` if that flag is off.
Disabling does not delete `providerSubject` or the permission row. A disabled
principal fails authorization even if `admin_coc` is still `granted`.

## Rollback of this release

Do not drop `StaffPermissionKey`. PostgreSQL will not remove an enum value
that this migration added, and a later grant row must keep its id.

If no `admin_coc` row exists, rollback of the application is a normal revert.
Shared-password Admin C.O.C. login keeps working. If a grant exists, revoke
it with the call above before or after the revert. Revoking does not require
the new Admin C.O.C. UI. Turning `SA360_STAFF_GOOGLE_SIGNIN_ENABLED` off
makes new authorize calls return 404 and does not delete Redis session rows.
Those rows expire within eight hours. Rotating `SA360_STAFF_SESSION_SECRET`
on both apps rejects old staff cookies. Do not rotate it as part of a
routine rollback.
