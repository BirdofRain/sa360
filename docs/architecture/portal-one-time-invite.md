# Portal one-time invite + customer password setup

Builds on `docs/architecture/portal-per-customer-password-foundation.md`.
No invite email, no C.O.C. invite button, no magic links, no User/Membership
tables, and no production deploy.

## Schema

Additive columns on `ClientAccount`:

| Column | Type | Meaning |
| --- | --- | --- |
| `portalInviteTokenHash` | `String? @unique` | SHA-256 hex of the outstanding invite token. **Never the raw token.** |
| `portalInviteExpiresAt` | `DateTime?` | Expiry of that outstanding invite. |

Existing rows stay valid (both null). No issued-at column: expiry minus the
documented TTL is enough for beta audit.

## Token design

- Raw token: 32 bytes from Node `crypto.randomBytes`, base64url (~43 chars, 256 bits).
- Stored digest: SHA-256 hex. High-entropy random bearer tokens use a simple
  cryptographic digest so outstanding invites can be looked up by unique index.
  The scrypt password format is for human passwords, not invite lookup.
- Raw token is returned **only** at issuance (inside `inviteUrl`). It is never
  persisted and must not be logged.
- Single-use, tenant-bound (hash lives on that `ClientAccount` row), expiring.

**TTL: 48 hours** (`PORTAL_INVITE_TTL_MS`). Reissue overwrites hash + expiry,
so the previous outstanding token stops working.

## Issuance

`POST /admin/v1/clients/:clientAccountId/portal-invite` (admin API key).

Requires `portalEnabled = true` and a valid `portalLoginEmail`. Does not send
email. Response:

```json
{ "ok": true, "inviteUrl": "/portal/invite/<raw-token>", "expiresAt": "..." }
```

`inviteUrl` is prefixed with `SA360_PORTAL_PUBLIC_BASE_URL` or `ADMIN_COC_BASE_URL`
when those existing env keys are set. No production hostname is invented.

Does not expose password hashes, invite hashes, the shared env password, session
secrets, or API keys.

## Acceptance

Customer route: `/portal/invite/<token>` (no session required).

`POST /client/v1/portal-invite/accept` `{ token, password }` (portal API key via
the Next.js server action; the browser never sends `clientAccountId`).

On success, one atomic `updateMany`:

1. Resolve by token hash, not expired, portal still enabled.
2. Hash the new password with `hashPortalPassword` (scrypt from PR #109).
3. Set `portalPasswordHash` + `portalPasswordSetAt`.
4. Clear `portalInviteTokenHash` + `portalInviteExpiresAt`.
5. Increment `portalSessionEpoch` **exactly once**.

Then redirect to `/portal/login?passwordSet=1`. No auto session.

Invalid / expired / already-used / disabled-portal accept: the same generic
copy. No account enumeration.

## Password policy

Length only, documented in UI copy and tests:

- Minimum 10 characters
- Maximum 128 characters
- No uppercase / lowercase / digit / symbol composition rules

Rejected password contents are not logged and are not returned.

## After conversion

- The invite cannot be reused.
- Shared `CLIENT_PORTAL_LOGIN_PASSWORD` fails for that tenant.
- The new customer password succeeds.
- Pre-conversion sessions (previous epoch) fail authoritative Node epoch checks.
- Unconverted `portalPasswordHash = null` accounts still use the env fallback.
