# Company-owned Google Sheets delivery

This document supersedes the customer-connect recommendation in PR #145
(`docs/architecture/google-account-sheets-delivery.md` on that branch) for
delivery ownership. PR #145 is still an open design note from before PRs
#146–#148. Those PRs shipped a **client-scoped** OAuth connection and a dormant
`google_sheets.v1` destination. The product requirement is different: Life Agent
Launch connects and controls the Google account. Clients do not connect Google
and do not supply Google credentials.

This foundation configures that company account and binds one spreadsheet per
client. It does **not** append lead rows, enqueue delivery, or mark anything
delivered.

## Verified current state

Checked against `origin/master` after #196.

### Path A — active campaign intake

Confirmed routing still resolves a client through canonical routing authority
(`CampaignRoutingRule` / dry-run `destinationClientAccountId` /
`SourceLeadEvent.clientAccountIdResolved`). Nothing in intake writes to Google
Sheets. Inbound `POST /sources/google-sheet/lead-created` is a **source**, not
a destination.

LF2 planning lists enabled `DeliveryTarget` rows and then excludes
`google_sheets.v1` before creating `DeliveryInstruction`s. There is no
execution adapter and no `deliverLive()` for Sheets. Phase 1C (PR #148) can
save a dormant client-oauth target only when `SA360_GOOGLE_SHEETS_DESTINATION_ENABLED`
is on. Production flags stay off. A saved Phase 1C target cannot receive leads.

### Path B — aged / bulk release

An authorized release still produces an immutable buyer-safe CSV
(`LeadDeliveryExportPackage`) and a separate operator mark,
`spreadsheetDeliveredAt`. That timestamp is not a Google Sheets API write.
CSV download, a saved link, and an external-delivery receipt are separate from
automated Sheets delivery. This foundation does not read or write orders,
allocations, export packages, billing, or release state.

PR #192 was reverted by #194. This work does not restore portal ordering or
live inventory. PR #188 remains on policy hold and is not merged or bypassed.

### What #146–#148 can be reused

- AES-256-GCM via `GOOGLE_TOKEN_ENCRYPTION_KEY` (`encryptGoogleToken` /
  `decryptGoogleToken`). No second key and no fallback to the GHL key.
- PKCE S256, hashed OAuth `state`, one-time pending-auth consume, and callback
  log redaction for any path ending in `/oauth/callback`.
- On-demand refresh with compare-and-set `tokenVersion`. Omitted refresh tokens
  keep the stored ciphertext. `invalid_grant` becomes `reconnect_required`.
  429 / 5xx / network errors do not change status.
- Sheets metadata read and spreadsheet create (`google-sheets-http-client`).
- Spreadsheet URL parsing that never fetches the pasted URL.
- Worksheet id validation and the “Google 400 is not a missing spreadsheet”
  mapping.
- The LF2 exclusion gate. It now also excludes `google_sheets.company.v1`.

### What must not be reused as-is

`GoogleAccountConnection` is one row per `ClientAccount`. Its partial unique
index and portal assertion flow assume the customer owns the Google identity.
Pointing company delivery at that table would let a client connect, disconnect,
or collide with the company account.

Phase 1C `createdBySa360` is hard-coded `false` because a browser boolean is
not proof. That conclusion still holds. Company control needs a server-side
create marker and a Drive owner check, not a wider reading of the old flag.

Phase 1C allows any spreadsheet the **client’s** token can read. Company
delivery must prove the **company** account controls the file.

## Company-managed destination policy

Control is computed on the server. Request fields such as `ownedByCompany`,
`createdBySa360`, `enabled`, `writeReadiness`, and `deliveryExecution` are not
read.

| Evidence | Result |
| --- | --- |
| Drive `files.get` says the connected company account owns the file | `drive_owner_verified` |
| `CompanySpreadsheetCreation` exists for this company connection and Drive does not say someone else owns it | `company_created` |
| Sheets read succeeds but Drive says the company account is not an owner | `not_company_controlled` (rejected) |
| Pasted URL, no creation marker, Drive ownership cannot be checked | `ownership_unverified` / `drive_scope_required` (rejected) |
| Drive `files.get` returns not found, access denied, or a `driveId` | rejected, including when a creation marker exists |

A pasted URL alone is not ownership. Read access alone is not ownership. Shared drives are unsupported: `files.get` uses `supportsAllDrives=false`, and a response that includes `driveId` is rejected even if `ownedByMe` is true. A creation marker does not override a failed or shared-drive lookup. The marker is accepted without a Drive call only when the Drive metadata scope is missing.

Portal order pages do not show the client's current spreadsheet. Account pages show the current configuration. An order link is recorded only by a later delivery job.

One `CompanySheetsDestination` per client. One client per `spreadsheetId`.
The same file cannot be bound to two clients.

Statuses stay separate:

- **Connection** — company Google account (`connected`, `reconnect_required`, `disconnected`, `error`).
- **Read access** — last metadata read of the bound spreadsheet (`readable` and the failure states).
- **Write readiness** — always `not_verified` in this foundation. The read test does not write a cell.
- **Delivery execution** — always `disabled`. `enabled` is stored false. No worker job is enqueued.

Saving or deleting a destination does not create `DeliveryInstruction`s, touch
`LeadOrder` / inventory / CSV packages, or resend existing traffic.

## Sharing

Intended later mechanism: Drive `permissions.create` for one explicit Google
user (`type=user`), role chosen by an admin, never `anyone` and never
link-sharing.

This foundation does not call the permissions API. A portal link does not grant
Google access. If no recipient email is saved, the API reports
`missing_recipient`. If an email is saved, status is
`intended_recipient_recorded_not_applied`. Spreadsheets stay private to the
company account.

## Folder placement

An admin may paste a folder URL or id. The API accepts it only after Drive
`files.get` shows a folder owned by the company account. There is no Drive
browser and no Google Picker.

Create uses the Sheets API. When a verified folder is configured and
`drive.file` is granted, one `files.update` sets that parent. A timeout on
create returns `create_outcome_unknown` and does not insert a creation marker
and does not retry. A failed move is recorded as `placement_failed`; the file
is not deleted and is not auto-bound. With no verified folder, create lands in
the company Drive root and reports `root_unconfigured`. Changing the folder
does not move spreadsheets that already exist.

## Flags

Both default off. Neither flag turns on lead writes.

| Variable | Effect when `true` |
| --- | --- |
| `SA360_COMPANY_GOOGLE_OAUTH_ENABLED` | Admin OAuth start, callback, and remote token revoke. Disconnect while this flag is off wipes stored credentials locally and does not call Google. |
| `SA360_COMPANY_GOOGLE_SHEETS_ENABLED` | Resolve, create, folder verify, read test, save, delete |

GET of connection status and GET of a saved destination do not call Google and
work while the flags are off. Existing `SA360_GOOGLE_OAUTH_ENABLED` and
`SA360_GOOGLE_SHEETS_DESTINATION_ENABLED` are unchanged and still govern the
client-scoped Phase 1B/1C routes.

Company OAuth also needs the existing `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_TOKEN_ENCRYPTION_KEY`, plus:

- `COMPANY_GOOGLE_OAUTH_REDIRECT_URI` ending in `/integrations/google/company/oauth/callback`
- `SA360_ADMIN_PUBLIC_BASE_URL` or `ADMIN_COC_BASE_URL` for the post-callback redirect

Company scopes (not added to client OAuth):

- `openid`, `email`, `profile`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive.metadata.readonly` (owner and folder check; no file list)
- `https://www.googleapis.com/auth/drive.file` (move files this app created)

The company Google identity cannot be stored as an active client connection,
and an active client identity cannot be stored as the company connection.

## HTTP

Admin key only:

- `GET /admin/v1/integrations/google/company`
- `GET /admin/v1/integrations/google/company/oauth/start`
- `POST /admin/v1/integrations/google/company/disconnect`
- `PUT|DELETE /admin/v1/integrations/google/company/folder`
- `GET|PUT|DELETE /admin/v1/clients/:clientAccountId/google-sheets/destination`
- `POST .../resolve`, `.../create`, `.../test`

Public callback (state + PKCE, same redaction as the client callback):

- `GET /integrations/google/company/oauth/callback`

Portal session only, no browser `clientAccountId`:

- `GET /client/v1/integrations/google/company-sheets`

There is no portal route that connects Google, creates a sheet, or saves a
company destination.

Admin UI: `/clients/:clientAccountId/google-sheets`.

Portal: the account page shows the configured link, read-access status, and
an explicit “delivery has not started” state. Order detail says no automated
Sheets delivery has been recorded for that order and does not link the
client's current spreadsheet. Order CSV behavior is unchanged.

## Migration

`20261020183000_company_google_sheets_foundation` adds empty tables only:

- `CompanyGoogleConnection`
- `CompanyGoogleOAuthPendingAuth`
- `CompanySpreadsheetCreation`
- `CompanySheetsDestination`

It does not alter client OAuth rows, `DeliveryTarget`, orders, inventory, or
export packages. `CompanyGoogleConnection_googleUserId_active_key` is a SQL
partial unique index. Do not drop it if `prisma migrate diff` proposes that.

## Staged plan after this foundation

1. **Execution adapter, still flag-off.** Register a Sheets writer that reads
   `CompanySheetsDestination`, re-checks company control before writing (the
   stored `controlBasis` is the result of the last successful save, and the
   read-access test does not refresh it), neutralizes cell values with
   `neutralizeSpreadsheetCell`, and appends through a durable queue. Ambiguous
   Google append timeouts must persist an attempt id and reconcile before any
   retry. Do not mark the attempt succeeded on timeout.
2. **Active-campaign canary.** After a lead is already routed to a confirmed
   `clientAccountId`, enqueue delivery for that client’s destination only.
   Intake success stays independent of delivery success. Do not backfill leads
   that arrived before the destination was saved.
3. **Aged/bulk canary.** Consume an already authorized release and its final
   export allocation set. Do not reselect inventory. Delivery identity is
   client + order + release + destination. CSV download and
   `spreadsheetDeliveredAt` stay independent until an explicit product decision
   says a successful Sheets write may also record that operator mark.
4. **Sharing canary.** Apply `permissions.create` only for an admin-confirmed
   recipient and role. Still never `anyone` or link access by default.
5. **Remove or keep Phase 1C client OAuth.** Leave it flag-off unless a later
   decision deletes those routes. Do not point it at the company account.

## Remaining decisions

- Which Google user Life Agent Launch will connect, and the OAuth client’s
  authorized redirect URI for the company callback.
- Whether new spreadsheets must use a verified folder or may stay in the
  company Drive root (`root_unconfigured` is allowed today).
- The client recipient email source and the Google role (`reader` vs `writer`).
- Whether a successful future Sheets write should also set
  `spreadsheetDeliveredAt`, or whether that operator mark stays manual.
- Whether aged orders append to the client’s campaign spreadsheet or get a
  separate tab/file per release. This foundation stores one destination per
  client and does not choose.
- When, if ever, to retire the client-scoped Phase 1B/1C routes.

## Rollback

Deploy is not part of this change. If the migration has been applied only to
local or staging databases and no company tokens have been stored, dropping
the four new tables removes the foundation. Do not drop
`GoogleAccountConnection` or `DeliveryTarget`. Leave both company flags unset
or `false`. Existing intake, CSV, release, and client-oauth code paths do not
read these tables.
