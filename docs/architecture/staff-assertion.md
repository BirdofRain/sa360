# Staff assertion

Status: **signing contract only**. No login, no OAuth client, no staff session,
no route, no permission grant, and no production secret.

This assertion is how a future Admin C.O.C. server can tell the SA360 API
which `StaffPrincipal` it has already authenticated. It is identity evidence.
It is not a permission, and possessing it does not make a principal active.

The module is `packages/shared/src/staff-assertion.ts`, exported as
`@sa360/shared/staff-assertion`. It is not on the shared package barrel, so a
normal `@sa360/shared` import does not pull it into a browser bundle. Import
it from server code only. Do not pass the signing secret through a client
prop or a `NEXT_PUBLIC_` variable.

## What this is not

| Credential | Why it is a different thing |
| --- | --- |
| `ADMIN_API_KEY` / `x-sa360-admin-key` | Shared admin capability. It does not name a person. |
| Admin C.O.C. session `ac1` | Shared-password browser session signed with `ADMIN_COC_SESSION_SECRET`. |
| Client portal assertion | Proves a portal session for a client account. Header `x-sa360-client-portal-assertion`. |
| Meta reviewer session | Separate reviewer cookie and secret. |
| Agent Workspace key | Workspace integration credential. |
| Association-correction snapshot | Cohort evidence signed with `SA360_ASSOCIATION_CORRECTION_SNAPSHOT_SECRET`. |
| Drive and Sheets OAuth | Tokens on `GoogleAccountConnection` and `CompanyGoogleConnection`. |

The signer and verifier read one environment variable,
`SA360_STAFF_ASSERTION_SECRET`. They do not fall back to any credential in
the table above. This change does not set that variable in `.env`, App
Platform, or a deployment spec.

The value must be at least 32 characters and must not contain whitespace.
A missing, empty, or short value fails closed: minting throws
`secret_unavailable`, and verification returns that same code. The secret is
read with bracket access so a client build does not inline it.

## Claims

The token is `sa1.<base64url canonical JSON>.<base64url HMAC-SHA256>`.
The HMAC covers the prefix and the body. Verification hashes both signatures
with SHA-256 and compares those digests with `timingSafeEqual`, so a short or
malformed signature does not throw and does not decide by string length.

The signed object has exactly these fields:

| Claim | Value |
| --- | --- |
| `v` | `1` |
| `iss` | `SA360 Admin C.O.C.` |
| `aud` | `SA360 API staff authorization` |
| `sub` | `StaffPrincipal.id`, a Prisma cuid (`c` plus 24 lowercase letters or digits) |
| `iat` | Issued-at, unix seconds |
| `exp` | `iat` plus 60 seconds |
| `jti` | Assertion id, 22 to 64 unreserved characters, generated with 18 random bytes when the caller does not supply one |
| `purpose` | `staff_authentication` |

Canonical form is JSON with those keys sorted and no extra whitespace.
A resigned body in any other order is `not_canonical`. An extra field,
including `email`, `displayName`, `role`, or an operator label, is
`unexpected_field`. Email and `x-sa360-operator` are not accepted as `sub`.

Verification also rejects a bad signature, the wrong issuer, audience, or
purpose, an unsupported version, a missing subject or assertion id, a lifetime
other than 60 seconds, an `iat` more than 30 seconds ahead of the verifier's
clock, and an `exp` at or before that clock. The verifier copies the claims
out of the token. It does not look up a row and it does not grant a permission.

`verifyStaffAssertion` accepts an expected `staffPrincipalId`. A valid
assertion for a different principal is `principal_mismatch`. Changing `sub`
inside an already signed token is `invalid_signature`.

The future header name is `x-sa360-staff-assertion`. No route reads it.

## Authorization boundary

A future correction endpoint has to require every one of these. This module
implements only the assertion check.

1. The existing admin API key still authenticates the caller.
2. The staff assertion verifies for this issuer, audience, and purpose.
3. `sub` is loaded from `StaffPrincipal` at request time.
4. That row is `active`, with `disabledAt` null.
5. `provider` is `google` and `providerSubject` is bound.
6. A live `StaffPermission` row is `granted` for `facebook_association_correction`, with `revokedAt` null.
7. The same permission predicate is checked again inside the correction transaction.

A valid assertion does not skip any of those reads. Disabling the principal
or revoking the grant must take effect on the next request even if the
assertion has not expired. `x-sa360-operator` stays an unauthenticated label.
The future handler must not record it as the actor. The actor is the
`StaffPrincipal` id from the assertion, after the live row matches it.

The association-correction snapshot remains a separate signature over the
cohort. A staff assertion does not replace that snapshot, and that snapshot
does not authenticate a person.

## Replay

Verification is stateless. The same token verifies on every call until `exp`.
A 60-second lifetime and the audience string limit where a stolen token can
be replayed. They do not make the token single-use. There is no nonce store
in this change.

A future execution endpoint should make replay handling part of the same
transaction as the correction:

- Insert an audit row keyed by `jti` before any association write.
- If that `jti` already exists with the same principal and the same snapshot,
  return the prior result and write nothing else.
- If that `jti` already exists with a different principal or a different
  cohort, reject the attempt.
- Commit the audit row and the association together. A crash before commit
  leaves no use of the `jti`, so a retry can proceed.
- Reject an expired or future-issued assertion before taking the funnel lock.

That audit table is not in this change. Do not store the assertion secret or
the raw token in the audit row. Store the assertion id, the principal id, and
the snapshot identity that the correction contract already defines.

## Key rotation

Version 1 carries no key id. The minter and the verifier must use the same
secret. Replace `SA360_STAFF_ASSERTION_SECRET` on both server runtimes
together. Tokens signed with the previous secret fail immediately. They would
have expired within 60 seconds anyway. Do not bridge the rotation with
`ADMIN_API_KEY`, `ADMIN_COC_SESSION_SECRET`, or the snapshot secret.

A later version can add a key id if an overlap window is required. Until
then, do not accept two secrets.

## Remaining Google OIDC work

This contract assumes some later server has already authenticated the
principal. That server does not exist yet. Still required, each under its
own approval:

- A Google OAuth client used only for staff sign-in, distinct from Drive and Sheets.
- Authorization-code routes, redirect URI, state, and CSRF protection.
- ID token checks: issuer, audience, JWKS, nonce, and `email_verified`.
- Binding `providerSubject` from Google's `sub` onto an already provisioned principal. A login must not insert a principal.
- A staff session cookie with its own name, secret, and lifetime. Do not reuse `ADMIN_COC_SESSION_SECRET` or this assertion as the browser session.
- Minting this assertion from that server session, with `sub` set to the session's principal id.
- Provisioning `SA360_STAFF_ASSERTION_SECRET` on the minting runtime and the API. This document does not provision it.
- Invitation and permission administration.
- The correction POST and its audit row.

## Merge recommendation

GO to merge this library. Nothing calls it, the secret is unset, and there
is no migration or route.

NO-GO to provision the secret, add a login, or treat a verified assertion as
permission to correct a lead.
