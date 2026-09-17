# Google Sheets destination setup (Phase 1C)

Phase 1C adds destination configuration only. A customer who already completed
Google OAuth (Phase 1B) can paste an existing Sheet URL/ID or create an SA360
spreadsheet, resolve tabs, run a read-only access test, and save one dormant
`google_sheets.v1` `DeliveryTarget`. No lead rows are written.

Expected production flags after merge:

- `SA360_GOOGLE_OAUTH_ENABLED=false`
- `SA360_GOOGLE_SHEETS_DESTINATION_ENABLED=false`

Do not enable live Sheets delivery in this phase.

## Existing Sheet flow

1. Portal session authenticates. Tenant is taken from the HMAC portal assertion,
   never from browser `clientAccountId`.
2. `POST /client/v1/integrations/google/sheets/resolve` with `{ spreadsheet }`
   (raw ID or `https://docs.google.com/spreadsheets/d/<id>/…`).
3. The API parses the ID locally. It does **not** fetch the customer-supplied URL.
4. On-demand access-token provider loads the tenant `GoogleAccountConnection`,
   decrypts a still-valid access token, or refreshes via
   `POST https://oauth2.googleapis.com/token` (`grant_type=refresh_token`) with
   Phase 1A CAS `tokenVersion` protection.
5. Metadata is read from `GET https://sheets.googleapis.com/v4/spreadsheets/{id}`.
6. Response is spreadsheet id/title/url plus worksheet id/title/index only.
   Nothing is persisted.

## Create Sheet flow

`POST /client/v1/integrations/google/sheets/create` calls
`POST https://sheets.googleapis.com/v4/spreadsheets` once with title
`SA360 Leads` (overrideable, sanitized) and one GRID tab named `Leads`.

Create does **not** save a `DeliveryTarget`. Repeated manual create requests can
therefore produce extra empty spreadsheets. There is no retry after an unknown
create outcome (timeout/network), because the spreadsheet may already exist.

Permissions are not changed. Drive is not used.

## Read-only test limitation

`POST /client/v1/integrations/google/sheets/test` re-reads spreadsheet metadata
and checks that the requested worksheet exists and is a GRID sheet.

This proves **read/access**, not write permission. No cells are written, no
headers are mutated, and no test row is appended. Write capability is reserved
for a later manual delivery canary (Phase 1D/1E).

## Token refresh behavior

There is no cron, worker, or background refresh. `getValidGoogleAccessToken`
runs only when a destination API needs Google HTTP.

- Fresh access token (expiry minus 60s buffer) → decrypt and use.
- Otherwise refresh. If Google omits `refresh_token`, the stored refresh
  ciphertext is left unchanged.
- Concurrent refresh: one CAS winner; the loser reloads the newest row instead
  of overwriting.
- `disconnected` rows cannot be resurrected.
- `invalid_grant` / terminal 401/403 → `reconnect_required`.
- 429 / 5xx / timeout → retryable, no status mutation.

OAuth status/disconnect remain independent of the destination flag.

## Dormant DeliveryTarget behavior

Saved metadata is reference-only:

- `connectionRefId`
- `spreadsheetId` / `spreadsheetTitle`
- `worksheetId` / `worksheetTitle`
- `headerSchemaVersion = sheets_delivery_v1`
- `createdBySa360`

No access token, refresh token, client secret, Google email, PKCE, or
encryption material. The DeliveryTarget secret denylist rejects those keys.

Persistence uses the existing `DeliveryTarget` row:

- `adapterKey = google_sheets.v1`
- `enabled = false`
- `isRequired = false`
- `isPrimary = false`
- `readinessStatus = configured`

One Sheets destination per `ClientAccount` (update-in-place). A GHL target may
coexist and is not modified.

**Why this target cannot execute**

1. LF2 planning lists enabled targets, then **excludes** `google_sheets.v1`
   before creating `DeliveryInstruction` rows. Phase 1C destinations never
   become required live deliveries, even if `enabled`/`isRequired` are flipped.
2. The shadow adapter `validateTarget` returns
   `google_sheets_live_delivery_not_enabled` rather than `ready_for_shadow`.
3. There is no execution adapter and no `deliverLive()` for `google_sheets.v1`.
4. The destination flag does not enqueue worker jobs or touch
   `FulfillmentOutbox` / `LeadAllocation`.

## No Drive API

Allowed host: `https://sheets.googleapis.com` only. Scopes remain:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/spreadsheets`

No Drive Picker, file listing, or `drive.googleapis.com`.

## Feature flag

`SA360_GOOGLE_SHEETS_DESTINATION_ENABLED` is deny-by-default and is **not**
`SA360_GOOGLE_OAUTH_ENABLED`. When false: no Sheets HTTP, no spreadsheet
create, no destination writes. GET of a previously saved destination still
returns stored references (no Google HTTP). Disconnect/OAuth status continue
to work.

## Portal / Admin UI

HTTP + portal BFF only. No Account settings UI in this phase.

BFF:

- `POST /api/client-portal/google/sheets/resolve`
- `POST /api/client-portal/google/sheets/create`
- `POST /api/client-portal/google/sheets/test`
- `GET|PUT|DELETE /api/client-portal/google/sheets/destination`

DELETE removes the SA360 `DeliveryTarget` row only. It does not delete the
Google spreadsheet, revoke OAuth, or change GHL.

## Future manual write canary

A later phase may add an explicit, flag-gated append of one lead row after
operator review. That work must lift the planning exclusion and register an
execution adapter. Phase 1C must not be treated as live fulfillment.
