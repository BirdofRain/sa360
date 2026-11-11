# Staff Admin C.O.C. access

A Google staff session proves identity. It does not grant Admin C.O.C. access.
Full Admin C.O.C. access is the `admin_coc` value of `StaffPermission`. That
permission is separate from `facebook_association_correction`. Granting one
does not grant the other.

The shared-password `ac1` session remains a working fallback. The staff cookie
is not rewritten into an `ac1` cookie. The browser never receives
`x-sa360-admin-key` or `SA360_ADMIN_API_KEY`.

## Authorization predicate

Every privileged Admin C.O.C. request is allowed only when all of these are
true:

1. The `sa360_staff_session` cookie signature is valid and the session is
   unexpired.
2. Redis has an active registration for that session id, principal, Google
   subject, and expiry. A revoked or missing registration is denial.
3. `StaffPrincipal.status` is `active` and `disabledAt` is null.
4. `providerSubject` equals the Google subject in the session.
5. A `StaffPermission` row exists with `permission = admin_coc`,
   `status = granted`, and `revokedAt` null.

`POST /internal/staff/admin-coc/authorize` evaluates that predicate. The Admin
C.O.C. server calls it with `x-sa360-staff-google-service` and
`x-sa360-staff-session`. A missing service credential, the admin API key, or a
caller-supplied principal id does not pass.

Middleware uses the same response only to choose a route. Pages, the dashboard
layout, server actions, BFF routes, and `adminRequestJson` call it again
before any privileged work. `adminRequestJson` attaches the server-side admin
API key only after that check. Observer allowlists still apply to an
`SA360_OBSERVER` cookie. A staff session without `admin_coc` is not an
observer and is not an admin.

## Landing

After Google sign-in, an authorized administrator is redirected to `/`
(Command Center). Any other staff session is redirected to `/staff`, which
shows an access-denied screen and a logout control. A disabled principal or a
revoked session is rejected and does not reach the Command Center.

## Grant and revoke

`POST /internal/staff/admin-coc/grant` and
`POST /internal/staff/admin-coc/revoke` require
`x-sa360-staff-enrollment-issuer`. They do not require
`SA360_STAFF_ENROLLMENT_ENABLED`. The staff service secret, a staff session,
and the shared admin API key are rejected.

The body must contain both `staffPrincipalId` and the exact stored email.
An email suffix, an email alone, or an id that does not match that email is
denied. The principal must be active and already bound to a Google subject.
A second grant while one is effective returns the existing row. Revocation
sets `status = revoked` and `revokedAt`. The row stays. A later grant is a
new row. Disabling the principal leaves the grant row in place and makes it
stop authorizing.

The controlled procedure is `docs/operations/staff-admin-coc-grant.md`.
This code does not insert a production grant.

## What this does not change

- Customer portal cookies, Meta reviewer cookies, and observer cookies stay
  on their own checks.
- `facebook_association_correction` is not granted and its preview route
  still requires `x-sa360-admin-key`. There is no new correction execution
  path.
- Delivery, fulfillment, and other production feature gates are unchanged.
- Turning `SA360_STAFF_GOOGLE_SIGNIN_ENABLED` off makes authorize return 404.
  Existing Redis rows are not deleted by that flag.
