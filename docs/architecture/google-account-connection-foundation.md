# Google account connection foundation (Phase 1A)

Status: **implemented** (data + crypto only). No OAuth routes, Google API calls,
Sheets delivery, portal/admin UI, or production env changes.

This note records the persistence and key-isolation choices from
`docs/architecture/google-account-sheets-delivery.md` PR 1.

## Models

- `GoogleAccountConnection` — one row per `ClientAccount` (`clientAccountId` unique).
  Encrypted tokens live here only. Status enum:
  `connected | reconnect_required | disconnected | error`.
  Persistence-level wipe uses `disconnected` (Google revoke is Phase 1B).
- `GoogleOAuthPendingAuth` — tenant-bound, hashed `state`, encrypted PKCE verifier,
  allowlisted `returnTo`, `expiresAt`, one-time `consumedAt`.

Tokens are **not** on `ClientAccount` or `DeliveryTarget.configMetadataJson`.

## Crypto

AES-256-GCM (`iv.tag.ciphertext` base64url) via shared helpers in
`apps/api/src/lib/token-encryption.ts`.

- GHL continues to use **only** `GHL_TOKEN_ENCRYPTION_KEY`.
- Google uses **only** `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- Missing key fails closed. There is no cross-provider fallback.

## Migration

`20260915180000_google_account_connection_foundation` is additive: two new empty
tables + one enum. It does not rewrite ClientAccount, GHL, DeliveryTarget,
LeadInventoryItem, SourceLeadEvent, or `backupSheet*` columns.

## Next

Phase 1B: Google OAuth start/callback/disconnect HTTP, still flag-off.
Do not enable live Sheets delivery in that PR.
