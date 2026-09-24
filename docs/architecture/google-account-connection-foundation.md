# Google account connection foundation (Phase 1A)

Status: **implemented** (data + crypto only). No OAuth routes, Google API calls,
Sheets delivery, portal/admin UI, or production env changes.

This note records the persistence and key-isolation choices from
`docs/architecture/google-account-sheets-delivery.md` PR 1.

## Models

- `GoogleAccountConnection` — one row per `ClientAccount` (`clientAccountId` unique).
  Encrypted tokens live here only. Status enum:
  `connected | reconnect_required | disconnected | error`.
  DB default is `disconnected` so a generic create cannot look connected without
  credentials. Persistence-level wipe uses `disconnected` (Google revoke is Phase 1B).
- `GoogleOAuthPendingAuth` — tenant-bound, hashed `state`, encrypted PKCE verifier,
  allowlisted `returnTo`, `expiresAt`, one-time `consumedAt`.
  Consume sets `consumedAt` first (row is never reusable). PKCE ciphertext is then
  decrypted in memory and wiped. A leftover encrypted verifier after a rare crash
  is not reusable and is acceptable.

## Partial unique index (Prisma drift)

`GoogleAccountConnection_googleUserId_active_key` is raw SQL. Prisma 6.19 cannot
express filtered unique indexes. This matches existing SA360 partial uniques
(`LeadAllocation_sourceLeadEventId_active_exclusivity_key`,
`LeadInventoryFacetBuild_one_active_per_version_key`).

Never replace it with `@@unique([googleUserId])` — disconnected rows keep
`googleUserId` for audit and another tenant may connect that identity later.
If `prisma migrate diff` / `migrate dev` proposes `DROP INDEX` for this name,
reject the drop. The migration-guard test asserts the SQL remains.

## CAS refresh

`compareAndSetGoogleConnectionTokenRefresh` requires a new access token and
accepts an **optional** refresh token. Google often omits `refresh_token` on
subsequent refreshes; omit the field to leave the stored refresh ciphertext
unchanged. Do not pass an empty string.

Tokens are **not** on `ClientAccount` or `DeliveryTarget.configMetadataJson`.

## Crypto

AES-256-GCM (`iv.tag.ciphertext` base64url) via shared helpers in
`apps/api/src/lib/token-encryption.ts`.

- GHL continues to use **only** `GHL_TOKEN_ENCRYPTION_KEY`.
- Google uses **only** `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- Missing key fails closed. There is no cross-provider fallback.
- Deploying without `GOOGLE_TOKEN_ENCRYPTION_KEY` is safe while no runtime
  path calls Google encrypt/decrypt. Accidental invocation throws.

## Migration

`20260915180000_google_account_connection_foundation` is additive: two new empty
tables + one enum. It does not rewrite ClientAccount, GHL, DeliveryTarget,
LeadInventoryItem, SourceLeadEvent, or `backupSheet*` columns.

## Next

Phase 1B: Google OAuth start/callback/disconnect HTTP, still flag-off.
Phase 1C: destination resolve/create/test/save, still no live Sheets delivery.
See `docs/architecture/google-sheets-destination-setup.md`.
