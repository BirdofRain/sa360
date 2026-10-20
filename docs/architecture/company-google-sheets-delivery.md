# Company-owned Google Sheets delivery

This document supersedes the customer-connect recommendation in PR #145
(`docs/architecture/google-account-sheets-delivery.md` on that branch) for
delivery ownership. PR #145 is still an open design note from before PRs
#146–#148. Those PRs shipped a **client-scoped** OAuth connection and a dormant
`google_sheets.v1` destination. The product requirement is different: Life Agent
Launch connects and controls the Google account. Clients do not connect Google
and do not supply Google credentials.

This foundation configures that company account and binds one spreadsheet per
client. A later, separate execution flag can persist delivery jobs and append
rows. That flag defaults off. Nothing in this design marks an order delivered,
grants Google sharing, or starts a live canary.

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
- **Write readiness** — stays `not_verified`. A read test does not write a cell, and a delivery job does not promote this field.
- **Delivery execution** — stays `disabled` on the destination. `enabled` stays false. Live appends require the separate execution flag below.
- **Client sharing** — recorded recipient only. No permission is granted.

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

All three default off. The setup flags do not append rows. The execution flag does not turn itself on and is not enabled by this change.

| Variable | Effect when `true` |
| --- | --- |
| `SA360_COMPANY_GOOGLE_OAUTH_ENABLED` | Admin OAuth start, callback, and remote token revoke. Disconnect while this flag is off wipes stored credentials locally and does not call Google. |
| `SA360_COMPANY_GOOGLE_SHEETS_ENABLED` | Resolve, create, folder verify, read test, save, delete, and canary approval. Approval does not call Google. |
| `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED` | Admin enqueue and execute of delivery jobs, including the synthetic canary. Intake and release do not call it. |

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
- `PUT /admin/v1/clients/:clientAccountId/google-sheets/canary-approval`
- `POST /admin/v1/clients/:clientAccountId/google-sheets/canary`
- `POST /admin/v1/company-sheets/deliveries/lead`
- `POST /admin/v1/company-sheets/deliveries/aged-release`
- `POST /admin/v1/company-sheets/delivery-jobs/:jobId/execute`
- `POST /admin/v1/company-sheets/delivery-jobs/:jobId/release-hold`

Public callback (state + PKCE, same redaction as the client callback):

- `GET /integrations/google/company/oauth/callback`

Portal session only, no browser `clientAccountId`:

- `GET /client/v1/integrations/google/company-sheets`
- `GET /client/v1/lead-orders/:orderId/google-sheets-delivery` (order evidence only; `usesCurrentDestination` is false)

There is no portal route that connects Google, creates a sheet, or saves a
company destination.

Admin UI: `/clients/:clientAccountId/google-sheets`.

Portal: the account page shows the configured link, read-access status, and
an explicit “delivery has not started” state. Order detail shows
`CompanySheetsOrderDeliveryEvidence` recorded for that order. It does not link
the client's current spreadsheet. Order CSV behavior is unchanged. Opening
either link does not grant Google access.

## Durable writer

One company spreadsheet per client has separate tab contracts. Campaign delivery binds the Campaign Leads worksheet, schema `company_sheets_campaign_v1`, and the destination revision captured at enqueue. Aged delivery binds the Aged Orders worksheet to the exact header and `fieldSchemaVersion` of an authorized export package. The synthetic canary tab is bound only on a spreadsheet an admin has approved for canary rows. Missing or incompatible tabs stay in an actionable setup state. Inspect and portal status reads do not create, rename, or overwrite tabs. Creating a missing tab is a separate admin action.

Jobs live in `CompanySheetsDeliveryJob` with immutable spreadsheet, worksheet, schema version, destination revision, header, and connection snapshots. Idempotency keys are `lead:{client}:{sourceLeadEventId}`, `release:{client}:{order}:{exportPackageId}`, and `canary:{client}:{operatorKey}`. They do not include the current spreadsheet id, so a later destination edit cannot fork a second target for the same lead or release. An append that times out or returns an ambiguous HTTP result is held until an operator confirms the request is dead. A reconciliation read that does not show the row is not treated as proof that the earlier request cannot still commit. RAW writes preserve phone numbers and other text, including a leading `+`.

Row identity is unique per worksheet (`CompanySheetsRow_sheet_stable_key`). Writes take `CompanySheetsWorksheetLock` and append at most 25 rows per batch, four batches per execute. A later execute continues pending rows.

Before an append the worker reloads the company token, requires the same connection id, re-reads spreadsheet metadata, and runs the same company-control check as destination save. Shared drives, lost ownership, and disconnected or expired credentials stop the attempt as `retryable` and do not append. A different company connection id is `uncertain` so the job is not silently retargeted.

The header contract is checked on the snapshotted tab. A matching header is left in place. An empty tab, with column A empty through the reconcile cap, receives the header once via `values.update` with `valueInputOption=RAW`. A conflicting or non-empty header is `uncertain` and is not overwritten. RAW writes store the cell text as entered, so phone numbers that start with `+` and synthetic formula samples stay unchanged. `neutralizeSpreadsheetCell` remains a foundation helper and is not applied on this write path.

`values.append` also uses `RAW` and `INSERT_ROWS`. A timeout or HTTP 5xx is ambiguous: the same attempt reconciles column A and does not append again. If that read fails, is truncated, or any attempted id is still missing, the job becomes `uncertain` and keeps `appendStartedAt`. `RETRY AFTER RECONCILE` does not clear that marker while the row is absent. Queued, running, succeeded, retryable, and uncertain are stored on the job. Aged releases also copy that status onto `CompanySheetsOrderDeliveryEvidence`. `spreadsheetDeliveredAt` is not written.

Enqueue accepts a confirmed lead (`clientAccountIdResolved`) or a committed export package whose order belongs to that client and is `ready`, `active`, or `completed`. Draft, paused, canceled, and not-yet-approved orders are refused. `spreadsheetDeliveredAt` is not an authorization gate and is not written. The aged path uses that package's CSV bytes, checksum, row count, and allocation id list. It does not query `LeadAllocation` or build a new delivery set. Evidence stores the snapshot URL. Portal order pages read that evidence, not `CompanySheetsDestination`.

An operator phrase does not prove an earlier append has stopped. Release-hold reads column A. If every pending stable id is present exactly once, the job adopts those rows and does not append. If `appendStartedAt` is set and any id is missing, duplicated, or the read is incomplete, the job stays `uncertain`. Another append is allowed only on a later execute when `appendStartedAt` is null and that read completed.

The canary is admin-only. `canaryApproved` is set while the setup flag is on and does not call Google. Enqueue and execute also require the execution flag, one to five synthetic rows, and the destination still matching the snapshot. This change does not run a canary against Google.

No route calls Drive `permissions.create`. Intake, release, CSV commit, inventory, and billing code do not import the writer.

## Migration

`20261020183000_company_google_sheets_foundation` adds empty tables only:

- `CompanyGoogleConnection`
- `CompanyGoogleOAuthPendingAuth`
- `CompanySpreadsheetCreation`
- `CompanySheetsDestination`

It does not alter client OAuth rows, `DeliveryTarget`, orders, inventory, or
export packages. `CompanyGoogleConnection_googleUserId_active_key` is a SQL
partial unique index. Do not drop it if `prisma migrate diff` proposes that.

`20261020200000_company_sheets_delivery_writer` adds `canaryApproved` and the
job, row, lock, and order-evidence tables. It does not drop either partial
unique index and does not alter orders, allocations, export packages, or
`spreadsheetDeliveredAt`.

`20261020213000_company_sheets_tab_contracts` adds `CompanySheetsTabContract`,
`destinationRevision`, and the job snapshot columns `schemaVersion`,
`destinationRevision`, and `appendStartedAt`. It is additive and does not drop
those indexes or change CSV delivery.

## Staged plan after the flag-off writer

1. **Execution adapter.** Present on this branch and still default-off. Jobs, snapshots, locks, bounded batches, literal cells, and ambiguous-append reconciliation are implemented. Intake and release do not enqueue them.
2. **Active-campaign canary.** After a lead is already routed to a confirmed
   `clientAccountId`, call the lead enqueue and execute explicitly. Use a
   company test spreadsheet approved for that canary. `canaryApproved` gates
   only the synthetic-row endpoint. Intake success stays independent of
   delivery success. Do not backfill leads that arrived before the destination
   was saved. Do not enable the execution flag until the Google account and
   test spreadsheet are chosen.
3. **Aged/bulk canary.** Call the aged enqueue with one already authorized
   release and execute it against that same approved test destination. Do not
   reselect inventory. Keep CSV download and `spreadsheetDeliveredAt`
   independent until an explicit product decision says a successful Sheets
   write may also record that operator mark.
4. **Sharing canary.** Apply `permissions.create` only for an admin-confirmed
   recipient and role. Still never `anyone` or link access by default. A
   recipient email still does not establish access.
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
- When, if ever, to retire the client-scoped Phase 1B/1C routes.

The tab decision is closed: one Life Agent Launch spreadsheet per client, with
a Campaign Leads tab, an Aged Orders tab, and a Canary tab only in an approved
test spreadsheet. Existing tabs are selected explicitly when their header is
compatible. They are not renamed or reused automatically.

## Rollback

Deploy is not part of this change. Leave `SA360_COMPANY_GOOGLE_OAUTH_ENABLED`,
`SA360_COMPANY_GOOGLE_SHEETS_ENABLED`, and
`SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED` unset or `false`. That stops
new Google mutations and delivery execution. Do not drop
`CompanyGoogleConnection`, `CompanySheetsDestination`, or the delivery job
tables as a routine rollback once credentials, destinations, or jobs exist;
those rows are audit evidence. Do not drop `GoogleAccountConnection` or
`DeliveryTarget`. Existing intake, CSV, release, and client-oauth code paths
do not read the writer tables.
