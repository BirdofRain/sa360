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
| Drive `files.get` says the connected company account owns a My Drive file, and `capabilities.canEdit` is true | `drive_owner_verified` |
| The file's `driveId` is `COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID` and its parent chain reaches `COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID`, with the capability the operation needs | `approved_shared_drive` |
| `CompanySpreadsheetCreation` exists for this company connection and the storage policy above passes, or Drive cannot be checked because the metadata scope is missing | `company_created` |
| Sheets read succeeds but the file is neither company-owned in My Drive nor inside the approved shared-drive folder | rejected (`not_company_controlled`, `unapproved_shared_drive`, `outside_approved_parent`, or `approved_drive_unconfigured`) |
| The location passes but `canEdit` or `canAddChildren` is not true | `insufficient_capability` (rejected) |
| Pasted URL, no creation marker, Drive ownership cannot be checked | `ownership_unverified` / `drive_scope_required` (rejected) |
| Drive `files.get` returns not found | `spreadsheet_unavailable` or `folder_unavailable`, including when a creation marker exists |

A pasted URL alone is not ownership. Read access alone is not ownership. Any `driveId` is not approval. `files.get`, `files.create`, and the constrained child-folder lookup send `supportsAllDrives=true`. A shared-drive file is accepted only when its drive id equals the configured approved drive and a parent walk reaches the configured approved parent. Another shared drive is `unapproved_shared_drive`. A shared drive with no configuration is `approved_drive_unconfigured`, which is distinct from a missing file. A creation marker does not override a failed lookup, an unapproved drive, or a file outside the parent. The marker is accepted without a Drive call only when the Drive metadata scope is missing. Delivery runs this same check again before an append.

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

Company storage is explicit:

- `COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID`
- `COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID`

Both must be set together before a shared-drive file is accepted. Invalid values are treated as unset. The production values for the existing Life Agent Launch shared drive are `0AMSPZadOXB3GUk9PVA` and parent folder `1tAL9K3RQy89P4L0haKwEXD9qbyfpj8Ag`. They are configuration, not an implicit default.

The company folder endpoint accepts that approved parent after Drive metadata shows it is a folder in that drive with `capabilities.canAddChildren=true`. A client subfolder is not stored as the company parent. An admin can check an existing client subfolder (`POST .../google-sheets/folder/resolve`). The subfolder must be that parent or a descendant in the same drive. Create can take that folder id and places the spreadsheet directly there.

Client folder creation (`POST .../google-sheets/folder`) is idempotent. It looks up one folder whose name is the `clientAccountId` directly under the approved parent, in that drive only, and creates it there if the lookup is empty. A second call returns the same folder. An ambiguous name or a lookup the token cannot perform does not create anything.

Spreadsheet creation uses Drive `files.create` with `parents` set to the verified folder and `supportsAllDrives=true`. It does not call the Sheets create API and then move the file. It does not use `parents=root`. If no explicit folder, approved parent, or verified My Drive folder is available, create returns `approved_parent_unconfigured` and does not call Drive. A timeout or an unconfirmed response is `create_outcome_unknown` and does not insert a creation marker and does not retry. A refusal from Drive is `create_placement_failed`; nothing is created in My Drive as a fallback. My Drive ownership checks remain valid for files that have no `driveId`. Changing the folder does not move spreadsheets that already exist.

Current scopes cannot call `drives.get`, so the drive display name is not fetched and no broader scope is requested for it. `drive.file` can create files this app creates, but it may not be allowed to add a child to a shared-drive folder the app did not create or the user did not open with the app. That failure stays `create_placement_failed` or `child_lookup_unsupported`. `drive.metadata.readonly` is what reads `driveId`, parents, and capabilities.

## Flags

All four default off. The setup flags do not append rows. The execution and dispatch flags do not turn themselves on.

| Variable | Effect when `true` |
| --- | --- |
| `SA360_COMPANY_GOOGLE_OAUTH_ENABLED` | Admin OAuth start, callback, and remote token revoke. Disconnect while this flag is off wipes stored credentials locally and does not call Google. |
| `SA360_COMPANY_GOOGLE_SHEETS_ENABLED` | Resolve, create, folder verify, read test, save, delete, and canary approval. Approval does not call Google. |
| `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED` | Admin enqueue and execute of delivery jobs, including the synthetic canary. Intake and release do not call Google unless the dispatch flag is also on and a worker drains due intents. |
| `SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED` | Records a dispatch intent for a new confirmed campaign lead or an Approve & Release of an aged package, and lets the worker drain those intents. Off inserts nothing and does not scan history. |

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
- `https://www.googleapis.com/auth/drive.metadata.readonly` (owner, shared-drive id, parent chain, and capabilities; one exact child-folder lookup)
- `https://www.googleapis.com/auth/drive.file` (create a file directly in a verified folder)

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
- `GET /admin/v1/clients/:clientAccountId/google-sheets/dispatch`
- `POST /admin/v1/clients/:clientAccountId/google-sheets/dispatch-activation`
- `POST /admin/v1/company-sheets/deliveries/aged-release/:exportPackageId/schedule`
- `POST /admin/v1/company-sheets/internal/process-dispatch`

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
the client's current spreadsheet. A client CSV download stays available after
operator Approve & Release or after a verified Sheets write (job and evidence
both `succeeded`). A queued job does not unlock it. Opening either link does
not grant Google access.

## Durable writer

One company spreadsheet per client has separate tab contracts. Campaign delivery binds the Campaign Leads worksheet, schema `company_sheets_campaign_v1`, and the destination revision captured at enqueue. Aged delivery binds the Aged Orders worksheet to the exact header and `fieldSchemaVersion` of an authorized export package. The synthetic canary tab is bound only on a spreadsheet an admin has approved for canary rows. Missing or incompatible tabs stay in an actionable setup state. Inspect and portal status reads do not create, rename, or overwrite tabs. Creating a missing tab is a separate admin action.

Jobs live in `CompanySheetsDeliveryJob` with immutable spreadsheet, worksheet, schema version, destination revision, header, and connection snapshots. Idempotency keys are `lead:{client}:{sourceLeadEventId}`, `release:{client}:{order}:{exportPackageId}`, and `canary:{client}:{operatorKey}`. They do not include the current spreadsheet id, so a later destination edit cannot fork a second target for the same lead or release. An append that times out or returns an ambiguous HTTP result is held until an operator confirms the request is dead. A reconciliation read that does not show the row is not treated as proof that the earlier request cannot still commit. RAW writes preserve phone numbers and other text, including a leading `+`.

Row identity is unique per worksheet (`CompanySheetsRow_sheet_stable_key`). Writes take `CompanySheetsWorksheetLock` and append at most 25 rows per batch, four batches per execute. A later execute continues pending rows.

Before an append the worker reloads the company token, requires the same connection id, re-reads spreadsheet metadata, and runs the same company-control check as destination save. An unapproved shared drive, a file outside the approved parent, lost My Drive ownership, a missing capability, and disconnected or expired credentials stop the attempt as `retryable` and do not append. A different company connection id is `uncertain` so the job is not silently retargeted. The job keeps the spreadsheet, worksheet, schema, and destination revision captured at enqueue.

The header contract is checked on the snapshotted tab. A matching header is left in place. An empty tab, with column A empty through the reconcile cap, receives the header once via `values.update` with `valueInputOption=RAW`. A conflicting or non-empty header is `uncertain` and is not overwritten. RAW writes store the cell text as entered, so phone numbers that start with `+` and synthetic formula samples stay unchanged. `neutralizeSpreadsheetCell` remains a foundation helper and is not applied on this write path.

`values.append` also uses `RAW` and `INSERT_ROWS`. A timeout or HTTP 5xx is ambiguous: the same attempt reconciles column A and does not append again. If that read fails, is truncated, or any attempted id is still missing, the job becomes `uncertain` and keeps `appendStartedAt`. `RETRY AFTER RECONCILE` does not clear that marker while the row is absent. Queued, running, succeeded, retryable, and uncertain are stored on the job. Aged releases also copy that status onto `CompanySheetsOrderDeliveryEvidence`. `spreadsheetDeliveredAt` is not written.

Enqueue accepts a confirmed lead (`clientAccountIdResolved`) or a client-released export package. The order must belong to that client and be `ready`, `active`, or `completed`, and the package must already have `spreadsheetDeliveredAt` from Approve & Release. Draft, paused, canceled, not-yet-approved, and internal (unreleased) packages are refused with `package_not_released` when the order itself is otherwise eligible. The writer reads that timestamp and does not write it. The aged path uses that package's CSV bytes, checksum, row count, and allocation id list. It does not query `LeadAllocation` or build a new delivery set. Evidence stores the snapshot URL. Portal order pages read that evidence, not `CompanySheetsDestination`.

An operator phrase does not prove an earlier append has stopped. Release-hold reads column A. If every pending stable id is present exactly once, the job adopts those rows and does not append. If `appendStartedAt` is set and any id is missing, duplicated, or the read is incomplete, the job stays `uncertain`. Another append is allowed only on a later execute when `appendStartedAt` is null and that read completed.

The canary is admin-only. `canaryApproved` is set while the setup flag is on and does not call Google. Enqueue and execute also require the execution flag, one to five synthetic rows, and the destination still matching the snapshot. This change does not run a canary against Google.

No route calls Drive `permissions.create`. Confirmed intake and Approve & Release record a dispatch intent only. They do not import the writer and they do not call Google. CSV commit of an unreleased package does not record an intent.

## Automatic dispatch

`SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED` defaults off. While it is off, confirmed routing and Approve & Release do not insert `CompanySheetsDispatchIntent` rows and do not scan older leads or packages. Turning the flag on does not backfill. A release that already happened before the flag was on is not scheduled by replaying Approve & Release.

Each client destination has its own campaign and aged switches, both default off. Enabling a switch stores `campaignDispatchNotBefore` or `agedDispatchNotBefore` at that moment. The cutoff never moves earlier. A lead resolved before the campaign cutoff, or a package released before the aged cutoff, is not scheduled. Disabling the switch does not clear the cutoff and does not replay anything.

Campaign intents are written in the same database transaction as the confirmed `SourceLeadEvent` update, and only when status is `routing_matched` with a resolved client. Aged intents are written in the same transaction as `markSpreadsheetDelivered`, only on the update that sets `spreadsheetDeliveredAt`, using that release time for the cutoff. A database error rolls the business row and the intent back together. Flag-off, unmatched, inactive, and pre-cutoff paths return without throwing, so they do not reject a valid intake or release. An idempotent replay of Approve & Release does not insert another intent. Missing configuration does not fail intake: the admin dispatch read reports `configured: false`, and a post-cutoff campaign lead whose tab is not bound, or whose destination later disappears, stays `awaiting_setup` so a later drain can recover it.

An aged release recorded before the Aged Orders tab is bound is `needs_explicit_schedule`. Binding the tab later does not create a job. `POST .../aged-release/:exportPackageId/schedule` is the audited action. It still requires the operator release mark, the stored CSV, order ownership, and the ready/active/completed order status. It does not set `spreadsheetDeliveredAt` and it does not append during the request. An unreleased package returns `package_not_released` and is not retried automatically.

The worker repeatable job is registered only while the dispatch flag is on. It POSTs to the internal drain. The drain creates the durable delivery job with the execution flag still off, and calls execute only when `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED` is on. An uncertain job is not appended again and blocks further writes on that worksheet. Draft, paused, canceled, unapproved, unreleased, mismatched, and altered packages are parked and are not retried into a later status change.

Client CSV download is authorized by the operator release mark or by a verified automated delivery: `CompanySheetsOrderDeliveryEvidence.status` and the related job status are both `succeeded` for that package, order, and client. `spreadsheetDeliveredAt` stays null on the automated-only path. A queued, running, retryable, or uncertain job does not authorize the download, and order status alone does not.

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

`20261020233000_company_sheets_dispatch_intent` adds the four destination
dispatch columns and `CompanySheetsDispatchIntent`. It does not alter orders,
allocations, export packages, or `spreadsheetDeliveredAt`.

## Staged plan after the flag-off writer

1. **Execution adapter and dispatch outbox.** Present and still default-off. Jobs, snapshots, locks, bounded batches, literal cells, and ambiguous-append reconciliation are implemented. Automatic scheduling is a separate flag. With both flags off, intake and release do not create jobs and do not call Google.
2. **Active-campaign canary.** After a lead is already routed to a confirmed
   `clientAccountId`, use the synthetic canary on a company test spreadsheet
   approved for that canary. `canaryApproved` gates only the synthetic-row
   endpoint. Do not enable the execution flag until the Google account and
   test spreadsheet are chosen. Do not enable dispatch until that canary has
   been reviewed. Enabling dispatch does not replay leads from before the
   client cutoff.
3. **Aged/bulk canary.** Call the aged enqueue with one package that already
   has Approve & Release and execute it against that same approved test
   destination. Do not reselect inventory. Do not let Sheets success set
   `spreadsheetDeliveredAt`. The client CSV stays available because the
   operator mark is already set, and also if a later verified Sheets write is
   the only authorization.
4. **Sharing canary.** Apply `permissions.create` only for an admin-confirmed
   recipient and role. Still never `anyone` or link access by default. A
   recipient email still does not establish access.
5. **Remove or keep Phase 1C client OAuth.** Leave it flag-off unless a later
   decision deletes those routes. Do not point it at the company account.

## Remaining decisions

- Which Google user Life Agent Launch will connect, and the OAuth client’s
  authorized redirect URI for the company callback.
- New spreadsheets are not created in Drive root. Shared-drive placement requires the two approved-storage variables above. A verified company-owned My Drive folder remains a valid explicit parent when those variables are unset.
- The client recipient email source. The first sharing role should be `reader`
  for an admin-confirmed email. Do not use `anyone` or link sharing.
- `spreadsheetDeliveredAt` stays the operator external-delivery receipt. A
  verified Sheets write is separate evidence and does not set that timestamp.
- When, if ever, to retire the client-scoped Phase 1B/1C routes. Leave
  `SA360_GOOGLE_OAUTH_ENABLED` and `SA360_GOOGLE_SHEETS_DESTINATION_ENABLED` off.

The tab decision is closed: one Life Agent Launch spreadsheet per client, with
a Campaign Leads tab, an Aged Orders tab, and a Canary tab only in an approved
test spreadsheet. Existing tabs are selected explicitly when their header is
compatible. They are not renamed or reused automatically.

## Rollback

Deploy is not part of this change. Leave `SA360_COMPANY_GOOGLE_OAUTH_ENABLED`,
`SA360_COMPANY_GOOGLE_SHEETS_ENABLED`,
`SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED`, and
`SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED` unset or `false`. That stops
new Google mutations, delivery execution, and automatic scheduling. Do not drop
`CompanyGoogleConnection`, `CompanySheetsDestination`, or the delivery job
tables as a routine rollback once credentials, destinations, or jobs exist;
those rows are audit evidence. Do not drop `GoogleAccountConnection` or
`DeliveryTarget`. Existing intake, CSV, release, and client-oauth code paths
do not read the writer tables.
