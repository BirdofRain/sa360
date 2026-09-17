# Google OAuth HTTP connection (Phase 1B)

Phase 1B adds OAuth connection HTTP only. It does not call Google Sheets or Drive,
create delivery targets, or change fulfillment/worker behavior.

## Portal tenant binding

The browser authenticates to the Next.js portal with its signed, httpOnly portal
session. The portal BFF checks the session signature, expiry, database-backed
`portalSessionEpoch`, and `portalEnabled` status. It then creates a short-lived
HMAC assertion using the existing server-only `CLIENT_PORTAL_API_KEY`.

Fastify requires both the portal API key and that assertion, re-checks the
database epoch/status, and derives `clientAccountId` from it. Google start,
status, and disconnect reject browser-supplied `clientAccountId` values.

The callback runs on the API origin, where the portal cookie is not assumed to
be available. Its only tenant authority is the high-entropy, one-time
`GoogleOAuthPendingAuth` state created by authenticated start. The callback does
not accept a tenant identifier.

## Rollout and redirects

`SA360_GOOGLE_OAUTH_ENABLED` is deny-by-default. When disabled, start and
callback make no Google HTTP requests. Status remains readable. Disconnect
remains available because pausing new OAuth must not trap an existing grant.

Callback redirects use only the validated relative `returnTo` stored in pending
auth plus `SA360_PORTAL_PUBLIC_BASE_URL` (falling back to the existing
`ADMIN_COC_BASE_URL`). Incoming Host headers are never used.

## OAuth and identity

Authorization uses PKCE S256 and only `openid`, `email`, `profile`, and
`https://www.googleapis.com/auth/spreadsheets`. Token exchange is one-shot,
bounded by a timeout, and requires an initial refresh token. Identity comes
from Google's OpenID Connect userinfo endpoint using the returned access token;
unverified ID token payloads are not decoded or trusted.

## Disconnect safety

Disconnect decrypts the refresh token when available (otherwise the access
token), calls Google's fixed revoke endpoint with a bounded timeout, then wipes
local ciphertext through the Phase 1A disconnect service. HTTP 200 and Google's
invalid-token HTTP 400 are treated as safe to wipe. Network errors, 429, and
5xx preserve the encrypted credential and return a retryable failure; there is
no retry loop. The token-version increment performed by the Phase 1A wipe
prevents a concurrent stale refresh from resurrecting credentials.

## Configuration

New variables:

- `SA360_GOOGLE_OAUTH_ENABLED`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`

The existing canonical `SA360_PORTAL_PUBLIC_BASE_URL` is also required before
enabling (with `ADMIN_COC_BASE_URL` retained as the existing fallback).
Google credentials and encryption key are loaded only by enabled OAuth
operations or disconnect. Flag-off API startup requires none of them.

Phase 1C destination setup is documented in
`docs/architecture/google-sheets-destination-setup.md`. It uses a separate
deny-by-default flag (`SA360_GOOGLE_SHEETS_DESTINATION_ENABLED`) and does not
enable live lead delivery.
