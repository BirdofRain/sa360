# Google staff sign-in

Google staff sign-in is a separate authentication path for an already provisioned
`StaffPrincipal`. It is disabled unless `SA360_STAFF_GOOGLE_SIGNIN_ENABLED` is
the exact string `true` and every required setting is present. A missing flag
or secret returns 404 before any Google request. This document does not
provision those settings.

## Trust boundary

The Admin C.O.C. server owns the browser flow: the authorization redirect,
PKCE, the one-time state cookie, and the staff session cookie. The API verifies
the Google ID token itself and loads the principal. The shared admin API key
is not an identity. A request that presents only that key, or a `sub` chosen
by the caller, is denied.

The staff session cookie is not the shared-password `ac1` cookie. Middleware
does not treat it as an operator session. A staff session does not grant the
ADMIN role, Team Workspace write authority, or
`facebook_association_correction`.

The Drive and Sheets OAuth client is a different connection. Staff code does
not read `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, or
`GOOGLE_OAUTH_REDIRECT_URI`.

## OIDC flow

The client is a dedicated Google web client. The authorize URL is
`https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code`,
scope `openid email`, PKCE `S256`, `state`, and `nonce`. There is no
`access_type=offline` and no refresh token is stored. If Google returns a
refresh token or an access token, the exchange keeps only the ID token.

The state cookie is `sa360_staff_google_state`, prefix `sg1`, httpOnly,
SameSite=Lax, Secure in production, path `/staff/google`, and it expires in
10 minutes. It holds the state, nonce, PKCE verifier, and the exact configured
redirect URI. The callback compares the query state, then the cookie is
cleared. A second presentation in the same process is `reused_state`. Google
authorization codes are single-use, which is what stops a second instance from
exchanging the same code. The redirect URI is the configured value whose path
is exactly `/staff/google/callback`. A query redirect is ignored. Callback
locations are relative (`/staff` or `/staff?error=denied`).

The API verifies the ID token with `jose` against Google's JWKS. It checks the
signature, issuer `https://accounts.google.com`, audience equal to the staff
client id, expiration, exact nonce, a present email, and `email_verified`
equal to boolean `true`. The stable identity is the Google `sub`.

## Identity

Sign-in never inserts a `StaffPrincipal`, never writes `providerSubject`, and
never inserts a `StaffPermission`. Lookup is by `provider = google` and
`providerSubject`, not by email.

- A disabled principal is denied.
- An unknown `sub` is denied.
- An unverified or missing email is denied.
- A stored `providerSubject` must equal the token `sub`.
- A null `providerSubject` is not bound from the email address.

Successful resolution returns the principal id and the Google `sub` only.

## Session

The session cookie is `sa360_staff_session`, prefix `sf1`, type `staff`.
Claims are version, type, principal id, Google `sub`, issued-at, expiry, and
session id. Expiry is eight hours after issue. There is no role claim. The
cookie is httpOnly, SameSite=Lax, Secure in production, and path `/`.

The signing key is `SA360_STAFF_SESSION_SECRET` (at least 32 characters). It
also signs the state cookie. It is not the admin session secret and not the
assertion signing secret. Logout is `POST /staff/google/logout`. It checks the
request origin and clears only the staff cookie.

`POST /internal/staff/session` verifies the cookie and reads the principal
again. A disabled, missing, unbound, or conflicting principal is denied. The
header is `x-sa360-staff-session`. Clearing the cookie ends the browser
session. A copied cookie remains valid until it expires or the principal is
disabled. Immediate revocation for a principal that stays active would need a
later session-epoch column. This change does not add that column.

## Routes

These paths exist so a disabled handler can answer. They are exact exceptions
in the Admin C.O.C. route gate. They are not a prefix, and marketing hosts
still do not serve them.

- `GET /staff/google/start`
- `GET /staff/google/callback`
- `POST /staff/google/logout`
- `GET /staff`
- `POST /internal/staff/google/resolve`
- `POST /internal/staff/session`

The shared-password login at `/login` is unchanged.

## Google Cloud Console

Create a new web OAuth client. Do not reuse the Drive or Sheets client.
Authorized redirect URI must be exactly `SA360_STAFF_GOOGLE_REDIRECT_URI`,
with path `/staff/google/callback`. Request only the OpenID `openid` and
`email` scopes. Do not request offline access. Use an internal consent screen
when the Workspace allows it. Do not create the client or copy its secret into
production as part of this change.

## First-login enrollment

A person cannot sign in until a principal already exists, is `active`, uses
provider `google`, and already has `providerSubject` equal to that person's
Google `sub`. This flow will not fill in a null subject from the email
address. Binding the first login requires a separate enrollment or invitation
mechanism that writes `providerSubject` once, only while it is null, after an
out-of-band check. Until that exists, every unbound principal is denied.

## Settings that are intentionally unset

- `SA360_STAFF_GOOGLE_SIGNIN_ENABLED`
- `SA360_STAFF_GOOGLE_CLIENT_ID`
- `SA360_STAFF_GOOGLE_CLIENT_SECRET` on the Admin C.O.C. server only
- `SA360_STAFF_GOOGLE_REDIRECT_URI`
- `SA360_STAFF_SESSION_SECRET` on the Admin C.O.C. server and the API

The API does not need the Google client secret. The resolve call uses the
existing internal API origin and does not send the admin API key.

## Recommendation

GO to merge this disabled foundation. NO-GO to provision the client or the
session secret, turn the flag on, create staff rows, bind a Google subject,
grant a permission, or execute an association correction.
