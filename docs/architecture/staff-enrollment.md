# Staff enrollment

Staff enrollment binds one verified Google subject to one existing
`StaffPrincipal`. It is disabled unless `SA360_STAFF_ENROLLMENT_ENABLED` is
the exact string `true` and the required settings are present. A missing flag
returns 404. This document does not provision those settings, create a
principal, or bind a subject.

Login stays on `SA360_STAFF_GOOGLE_SIGNIN_ENABLED`. Turning login on does not
turn enrollment on. An enrollment callback cannot satisfy a login state
cookie, and a login callback does not write `providerSubject`.

## Trust boundary

The shared-password Admin C.O.C. session is not an individual identity. It
cannot provision a principal, issue an invitation, cancel one, disable a
principal, or read enrollment status. The Admin C.O.C. server does not hold
the enrollment issuer secret and has no enrollment administration screen.

The issuer credential is `SA360_STAFF_ENROLLMENT_ISSUER_SECRET`. It is a
separate bootstrap secret, at least 32 characters, with no whitespace. It must
differ from the admin password, the admin session secret, the admin API keys,
the staff service secret, the staff session secret, and the assertion secret.
The API accepts it only on `x-sa360-staff-enrollment-issuer`. The browser never
receives it.

That secret is not a person. Production use requires a separate approval
before the flag is set, before the secret is placed on the API, and before
any principal or invitation is written. It is not placed on Admin C.O.C.

The recipient proves the Google account with Google's signed ID token. The
invitation secret authorizes which principal may be bound. An email address,
a request-body subject, or a caller-selected principal id does not.

## Authorization contract

A grant belongs to one existing principal.

- The principal must already exist, with `provider = google`, `status = active`,
  `disabledAt` null, and `providerSubject` null.
- A disabled principal is rejected.
- A principal that already has a Google subject is rejected.
- Only one pending grant may exist for a principal.
- The invitation secret is 32 random bytes, base64url. The database stores
  only its SHA-256 hex digest.
- The grant expires 15 minutes after it is issued. The OAuth state cookie
  then lasts 10 minutes, so the recipient must finish inside the earlier
  deadline.
- Completion consumes the grant. A second presentation is rejected.
- Cancellation is idempotent. A consumed grant cannot be canceled or reused.
- No `StaffPermission` is created. Enrollment does not grant admin access,
  Team Workspace write access, or `facebook_association_correction`.
- The enrollment callback does not set `sa360_staff_session`. The person
  signs in later through the normal Google staff login after that login is
  enabled.

Issuer routes, all 404 until the flag, Google client id, service secret, and
issuer secret are configured:

- `POST /internal/staff/enrollment/provision`
- `POST /internal/staff/enrollment/issue`
- `POST /internal/staff/enrollment/cancel`
- `POST /internal/staff/enrollment/disable`
- `POST /internal/staff/enrollment/status`

Recipient routes use the existing staff service credential, not the issuer
secret. They 404 until the enrollment flag, Google client id, and service
secret are configured:

- `POST /internal/staff/enrollment/preview`
- `POST /internal/staff/enrollment/complete`
- `POST /internal/staff/enrollment/state/consume`

A missing or wrong credential is 401. Redis or database failure is 503 and
does not report success.

## Google verification and binding

The browser flow is `GET /staff/google/enroll/start?enrollment=...`, then
Google, then `GET /staff/google/enroll/callback`. The redirect URI is
`SA360_STAFF_GOOGLE_ENROLL_REDIRECT_URI` and its path is exactly
`/staff/google/enroll/callback`. It is not the login redirect. The start
response sets `Referrer-Policy: no-referrer` and does not put the invitation
secret on the Google URL. The secret travels in the httpOnly enrollment
state cookie.

The flow reuses the staff authorization-code client: PKCE S256, nonce,
signed purpose-bound state prefix `se1`, and the same atomic Redis state
consumption with a separate enrollment route. A login state cookie fails
enrollment verification. If Redis is unavailable, the callback does not
exchange the code.

The API verifies the ID token with the existing Google verifier: signature,
issuer `https://accounts.google.com`, audience equal to the staff client id,
expiration, nonce, and `email_verified === true`. The stable binding is
`sub`. The token email must also equal the principal email after
normalization. That email check is an extra constraint. It is not the
authorization. A matching email without the invitation is denied.

Binding runs in one database transaction:

1. Lock the grant by the secret digest.
2. Reject a missing, canceled, consumed, or expired grant.
3. Lock that grant's principal.
4. Require an active, unbound Google principal whose email matches.
5. Set `providerSubject` only where it is still null.
6. Mark that same grant consumed only where it is still pending and unexpired.
7. Insert an audit event with the principal id, grant id, and Google sub.

A unique `providerSubject` collision or a failed compare-and-set rolls the
transaction back. The grant stays pending and the principal stays unbound.
Two concurrent attempts on the same grant end with one binding. The other
fails closed. The existing trigger still rejects any later change to a
subject that is already set.

## Audit and recovery

`StaffEnrollmentEvent` records `issued`, `canceled`, and `consumed`. A
consumed event stores the Google sub. It does not store the invitation
secret, the ID token, the authorization code, or a refresh token.

Operator procedure, only after the separate approval above:

1. Provision the principal with the issuer credential. The row is active and
   unbound. No permission is granted.
2. Issue one invitation. The API returns the secret once.
3. Deliver `https://<admin>/staff/google/enroll/start?enrollment=<secret>`
   through a private channel. Access logs can retain that URL. The secret
   expires in 15 minutes and works once.
4. The recipient completes Google verification.
5. Confirm the binding with `POST /internal/staff/enrollment/status`. It
   returns the stored subject. It does not change it.
6. Cancel an unused invitation with `POST /internal/staff/enrollment/cancel`.
   A second cancel is success.
7. Disable a compromised principal with
   `POST /internal/staff/enrollment/disable`. The subject stays recorded.
   Later logins fail because the principal is disabled.

There is no rebinding. An incorrect or lost Google binding cannot be
cleared or silently assigned to another subject. Recovery is to disable that
principal and provision a new principal for a corrected mailbox, then issue
a new invitation. The old subject remains on the disabled row.

## What stays unchanged

Shared-password login, Team Workspace authorization, Source Resolution, and
the login session registry are unchanged. Enrollment does not add an
association-correction execution route.
