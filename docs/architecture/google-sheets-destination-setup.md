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

Every one of those values is server-set. The request body supplies only the
spreadsheet reference; `enabled`, `isRequired`, `isPrimary`, and provenance are
never read from it.

## Provenance (`createdBySa360`)

`createdBySa360` is **server-derived and always `false` in Phase 1C**.

A browser boolean cannot prove SA360 created a spreadsheet: a customer could
paste any existing sheet and claim ownership. Phase 1C stores no durable,
authenticated record of `POST /sheets/create`, so there is nothing trustworthy
to check a claim against, and an honest `false` is the only value we can
persist.

Consequences:

- pasted existing spreadsheet → `false`
- spreadsheet created via the create endpoint, then saved → `false`
- request body carrying `createdBySa360: true` → ignored, never persisted

The create endpoint response still reports `createdBySa360: true`, because that
response describes a spreadsheet this server just created. That value is not
persisted and is not accepted back as save input.

A later phase that needs real ownership semantics must first add a durable
server-side create marker (tenant + spreadsheet id, written under the same
authenticated request that created the sheet) and derive provenance from it.

## One destination per client

`DeliveryTarget_clientAccount_googleSheets_key` is a SQL partial unique index:

```sql
CREATE UNIQUE INDEX "DeliveryTarget_clientAccount_googleSheets_key"
  ON "DeliveryTarget"("clientAccountId")
  WHERE "adapterKey" = 'google_sheets.v1';
```

It is Sheets-scoped, so a client may still hold a GHL target at the same time.
Prisma cannot express filtered unique indexes, so the schema carries a doc
comment instead of `@@unique`; never replace it with `@@unique([clientAccountId])`.

Save runs in one transaction that takes `pg_advisory_xact_lock` on the tenant,
reads the canonical row, retires any pre-index duplicates, then creates or
updates. The unique index — not the lock — is the final guarantee. A caller
that still loses the race retries once, observes the winner's row, and updates
it, so concurrent first saves all succeed and the database holds exactly one
row.

Delete is also transactional: it locks the tenant, checks **every** matching
row for referencing `DeliveryInstruction`s first, and aborts without deleting
anything if any row is in use. There is no partial delete state. Delete removes
only the SA360 `DeliveryTarget`; it never calls Google, never touches the
spreadsheet, never revokes OAuth, and never alters GHL.

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

## Input validation and error mapping

`worksheetId` must be a real number that is a safe integer in `0 …
2147483647` (Google's int32 `sheetId` range). Numeric strings, `NaN`,
`Infinity`, floats, negatives, and oversized values are rejected as
`invalid_worksheet` before any Google request is made.

A Google `400` is classified as `invalid_request` and surfaced as
`invalid_spreadsheet_ref`, not as a missing spreadsheet: it means Google
rejected the reference we sent, which is not evidence of absence. `404`
remains `spreadsheet_unavailable` / `worksheet_unavailable`. Raw Google
response bodies are never forwarded.

## Future manual write canary

A later phase may add an explicit, flag-gated append of one lead row after
operator review. That work must lift the planning exclusion and register an
execution adapter. Phase 1C must not be treated as live fulfillment.
