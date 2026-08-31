# Portal per-customer password foundation + session revocation

Foundation-only change. No invite issuance, no C.O.C. invite UX, no User/Membership
tables, and no production customer conversion.

## Schema

`ClientAccount` gains three nullable/defaulted columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `portalPasswordHash` | `String?` | Encoded scrypt of the customer password. **Never plaintext.** |
| `portalPasswordSetAt` | `DateTime?` | When the hash was stored (invite PR will set this). |
| `portalSessionEpoch` | `Int @default(0)` | Increment to revoke prior sessions for this tenant. |

Existing rows stay valid: hash remains `NULL`, epoch is `0`. No data rewrite.
No secrets in the migration.

## Login before / after

**Before:** shared `CLIENT_PORTAL_LOGIN_PASSWORD` is checked first. After it
succeeds, `portalLoginEmail` selects the `ClientAccount`. Anyone who knows the
shared password and another customer's portal email can load that tenant.

**After:**

1. Resolve `ClientAccount` by `portalLoginEmail`.
2. If `portalPasswordHash` is set: verify **only** that hash. The env password
   must not succeed for that customer.
3. If `portalPasswordHash` is `NULL`: allow the shared env password as a
   **temporary** migration fallback (verified on admin-coc; also on the API
   when `CLIENT_PORTAL_LOGIN_PASSWORD` is set there).
4. `portalEnabled` is still enforced. Failures use the generic invalid-credential
   copy except for the existing disabled-portal message after a correct password.

`CLIENT_PORTAL_LOGIN_PASSWORD` is **not** removed. `CLIENT_PORTAL_ACCESS_CODE` /
`?access=` is unchanged.

## Hashing

Node `crypto.scrypt` (not argon2id): this repo has no native addons, and argon2
bindings are a DigitalOcean / Next.js compatibility risk. Storage format:

`scrypt$n=16384$r=8$p=1$keylen=32$<salt_b64url>$<dk_b64url>`

Malformed hashes fail closed. Passwords and hashes are not logged and are not
included in DTOs or API responses (`hasPortalPassword` is a boolean only).

## Session epoch — where revocation is authoritative

| Layer | What it checks | Authoritative for epoch? |
| --- | --- | --- |
| Edge middleware (`apps/admin-coc/src/middleware.ts`) | HMAC signature + expiry only | **No.** Edge cannot safely read DB state. |
| Next.js BFF (`guardClientPortalBffSession`) | HMAC, then `GET /client/v1/portal-session-state` | **Yes** for `/api/client-portal/*`. **401** if that state cannot be loaded. |
| Portal RSC / login redirect / account actions (`readTrustedPortalSession`) | Same DB epoch lookup | **Yes** for `/portal` pages and server actions. **Unauthenticated** if state cannot be loaded (missing API config is not a bypass). |
| Fastify client API | API key + BFF-supplied `clientAccountId` | Not epoch. API key holders are an existing trust boundary. |

New sessions embed `portalSessionEpoch`. Legacy v1/v2 tokens without the field
are treated as epoch `0`, matching the column default. Incrementing the epoch
invalidates those cookies without rotating `CLIENT_PORTAL_SESSION_SECRET`.

This PR does not increment epoch (no password-set / invite flow yet).

## Migration safety for existing customers

- **Unconverted** (`portalPasswordHash = null`): env password continues to work.
- **Converted** (`portalPasswordHash` set by a later invite PR): env password is
  rejected for that customer only.
- No production customer is automatically converted.
- No secret values in the migration. No backfill.

## Remaining risks (explicit)

- Shared env password still works for every **unconverted** tenant.
- `?access=` still grants a session for the env tenant.
- Edge middleware will still let a revoked cookie reach `/portal`; the Node
  loaders then 401 / redirect to login.
- Node trusted-session checks fail closed when `GET /client/v1/portal-session-state`
  cannot run (missing API config, network/API error, malformed state). HMAC
  alone is never treated as revocation-verified.
- `CLIENT_PORTAL_API_KEY` can still call tenant-scoped APIs without a cookie
  (pre-existing server-to-server trust).
