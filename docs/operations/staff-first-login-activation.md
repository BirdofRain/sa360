# First staff Google login — activation and rollback

This runbook is documentation for a later, separately approved production
activation. It does not create a Google client, set a secret, write a
`StaffPrincipal`, issue an invitation, grant a `StaffPermission`, or turn on
either feature flag.

The deployed foundation is disabled. Production was verified on
`df8248b272dd4c067bb180968d1bb346a3b8d653` with zero principals, zero Google
subject bindings, zero permissions, zero enrollment grants, and zero
enrollment events. Keep it that way until every phase below has its own
approval.

The browser routes live on Admin C.O.C. The trusted production origins already
recorded for that app and the API are:

| App | Origin |
| --- | --- |
| Admin C.O.C. | `https://sa360-api-staging-coo57.ondigitalocean.app` |
| API | `https://sa360-sw6oq.ondigitalocean.app` |

Those values come from the existing trusted configuration in
`docs/ghl/agent-workspace-first-ghl-embed-checklist.md` and
`docs/operations/lf2-production-migration-runbook.md`. Confirm they still
match the live app hostnames before creating any Google client. Do not invent
a second public origin.

## Phase 1 — Google Cloud configuration

Create or select a dedicated OAuth client used only for staff sign-in. Do not
reuse the company Google Sheets or Drive client (`GOOGLE_OAUTH_CLIENT_ID` /
`GOOGLE_OAUTH_CLIENT_SECRET`). That client is a different trust boundary.

Authorized redirect URIs, both exact:

- `https://sa360-api-staging-coo57.ondigitalocean.app/staff/google/enroll/callback`
- `https://sa360-api-staging-coo57.ondigitalocean.app/staff/google/callback`

Authorized JavaScript origin, if the Google client requires one:

- `https://sa360-api-staging-coo57.ondigitalocean.app`

The API origin is not a redirect URI. The enrollment and login callbacks are
Admin C.O.C. routes. Do not add a wildcard, a trailing slash, or an
`http://` variant.

Record the new client id and client secret outside this repository. Do not
commit them.

## Phase 2 — Secrets and enrollment

Leave `SA360_STAFF_GOOGLE_SIGNIN_ENABLED` unset on both apps during this
phase. Enrollment does not turn login on.

| Setting | API | Admin C.O.C. | Purpose |
| --- | --- | --- | --- |
| `SA360_STAFF_ENROLLMENT_ENABLED` | yes | yes | Exact `true` opens the enrollment routes. Any other value stays 404. |
| `SA360_STAFF_ENROLLMENT_ISSUER_SECRET` | yes | never | Bootstrap credential for provision, issue, cancel, disable, and status. Sent only as `x-sa360-staff-enrollment-issuer`. |
| `SA360_STAFF_GOOGLE_CLIENT_ID` | yes | yes | OAuth client id and ID-token audience. |
| `SA360_STAFF_GOOGLE_CLIENT_SECRET` | no | yes | Admin C.O.C. exchanges the authorization code. The API verifies the ID token and does not need this secret. |
| `SA360_STAFF_GOOGLE_ENROLL_REDIRECT_URI` | no | yes | Exact enrollment callback from Phase 1. |
| `SA360_STAFF_GOOGLE_REDIRECT_URI` | no | yes | Exact login callback from Phase 1. Unused while the login flag is off. |
| `SA360_STAFF_SESSION_SECRET` | yes | yes | Admin C.O.C. signs `sa360_staff_session`. The API verifies it. |
| `SA360_STAFF_GOOGLE_SERVICE_SECRET` | yes | yes | Shared internal header `x-sa360-staff-google-service`. |

`SA360_STAFF_ENROLLMENT_ISSUER_SECRET` belongs only on the API. Placing it on
Admin C.O.C. is a failed activation. The issuer secret, service secret,
session secret, and `SA360_STAFF_ASSERTION_SECRET` must all differ, and each
must differ from the admin password and admin session secret. Assertion
signing is not part of this activation; leave `SA360_STAFF_ASSERTION_SECRET`
unset.

Confirm the existing Admin C.O.C. `SA360_API_INTERNAL_URL` already points at
the production API. Do not repoint it as part of staff activation.

Each principal or invitation write needs its own written approval from a
named person. The approval is kept outside the database. It names the person,
the mailbox, and the action (`provision` or `issue`). The issuer secret is
not that record, and `StaffEnrollmentEvent` does not store the person's name.
The shared-password Admin C.O.C. session cannot perform these writes.

The first principal is created unbound and `active`, with no
`StaffPermission` row. Issue one invitation. The recipient submits it on the
same-origin enrollment form. A successful enrollment redirects to Google,
then binds `providerSubject` and consumes the grant. It does not set
`sa360_staff_session`.

Before leaving this phase, read enrollment status and confirm:

- the stored subject is the expected Google subject
- the grant status is `consumed`
- a second use of the invitation is rejected
- `StaffPermission` count for that principal is 0
- the login flag is still unset and `POST /internal/staff/google/resolve` is 404

## Phase 3 — First controlled login

Turn on `SA360_STAFF_GOOGLE_SIGNIN_ENABLED` with the exact value `true` on
both apps only after the Phase 2 checks pass. The first account still has no
`StaffPermission` grants.

Acceptance criteria, all required:

1. A separate visit to `/staff/google/start` completes Google authentication.
   This is a new sign-in, not a reuse of the enrollment callback.
2. The API registers `sa360_staff_session` in the shared Redis allowlist.
3. A second API instance accepts that session.
4. The session does not open shared-password Admin C.O.C. pages, Team
   Workspace, Source Resolution, Meta association correction, or GHL, Sheets,
   or fulfillment controls. Those remain behind the admin session.
5. Logout returns 303 to `/staff`, revokes the registry row, and clears only
   the staff cookie.
6. Presenting the copied staff cookie afterward is denied.
7. Disabling the principal denies a later sign-in and denies an
   already-registered session. The stored Google subject stays on the row.

A same-origin browser POST that receives 403 means the request `Host` did not
match the public origin. Stop. Do not accept a forwarded-host list to make
the form succeed.

## Phase 4 — Rollback

`POST /internal/staff/enrollment/disable` is available only while
`SA360_STAFF_ENROLLMENT_ENABLED` is the exact string `true` and the issuer
secret, client id, and service secret are present. After enrollment is turned
off, that route returns 404. Disable sets `status` to `disabled` and
`disabledAt`. It does not clear `providerSubject`.

`POST /internal/staff/session/revoke` is available only while login readiness
is on. Turning `SA360_STAFF_GOOGLE_SIGNIN_ENABLED` off does not delete Redis
keys under `sa360:staff-session:`. Those registrations remain until they
expire. The maximum session lifetime is 8 hours. A copied staff cookie is not
an admin session. Shared-password Admin C.O.C. login stays available
throughout.

Do not clear `providerSubject`. Do not delete a principal, a
`StaffEnrollmentGrant`, or a `StaffEnrollmentEvent`.

### Preferred order

Use this order when the issuer route is healthy and enrollment is still
enabled.

1. Disable the compromised principal through
   `POST /internal/staff/enrollment/disable` before enrollment is turned off.
2. While login is still enabled, revoke each presented staff session through
   logout or `POST /internal/staff/session/revoke`. There is no bulk-revoke
   route. A session that is not presented remains registered in Redis.
3. Then set `SA360_STAFF_ENROLLMENT_ENABLED` and
   `SA360_STAFF_GOOGLE_SIGNIN_ENABLED` to any value other than `true`, or
   unset them, on both apps. Enrollment and login routes return 404. New
   Google sessions cannot be registered.
4. Leave the grant and enrollment event rows in place.

### Flags off before the principal is disabled

If immediate containment requires both flags off first, new enrollment and
login requests return 404, and the issuer disable route is then unavailable.
Redis session registrations are still present.

Do not turn either feature back on until a separately approved recovery
procedure chooses one of these containment steps:

- Enable enrollment only long enough to disable the principal, confirm
  `disabledAt` is set, then turn enrollment off again. Do not enable login
  during that window.
- Enable login only long enough to revoke the known presented sessions, then
  turn login off again. Do not leave it on.
- Rotate `SA360_STAFF_SESSION_SECRET` on both apps before login is enabled
  again. Old cookies fail signature verification. Rotation does not delete
  Redis rows, subject bindings, or audit rows. The replacement must differ
  from the service secret, the issuer secret, the assertion secret, and the
  admin secrets.
- Wait through the maximum session lifetime of 8 hours so the cookie expiry
  and the Redis registration TTL have both elapsed.

Re-enabling login with the same session secret, an active principal, and an
unrevoked Redis registration restores that previously valid session. Do not
do that. A principal that has already been disabled cannot use a restored
cookie. Any other still-active principal with an unrevoked registration can.

Removing the staff client secret or session secret does not delete identity
rows. Remove those secrets only after the flags are off and the chosen
containment step is recorded.
