# Company Sheets configuration request

An operator can store an intended spreadsheet id and GRID worksheet id.
The row is `CompanySheetsDestinationConfigurationRequest`. It is not a
`CompanySheetsDestination`, and delivery does not read it.

`SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED` must be the exact string `true`
after trim. Unset, blank, and `TRUE` stay off. The flag does not turn on
OAuth, Sheets setup, execution, or dispatch.

Admin API key only. A portal key, portal assertion, or workspace key is
rejected. The path is not on the observer allowlist.

`GET /admin/v1/clients/:clientAccountId/company-sheets-destination-configuration`

`POST /admin/v1/clients/:clientAccountId/company-sheets-destination-configuration`

POST accepts `requestId`, `expectedRevision`, `expectedDestinationRevision`,
`spreadsheetId`, and `worksheetId`. Titles and control basis are copied from
the company Google metadata check. Caller display text is not accepted.

## Operational dependency audit

These readers and writers use `CompanySheetsDestination` itself. Turning
dispatch off does not make a write to that row safe.

| Path | What an inactive destination still allows |
| --- | --- |
| `saveCompanySheetsDestination` | Creates the row, or changes the worksheet on the same spreadsheet while dispatch is on. A spreadsheet-id change is refused only while dispatch is on. |
| `updateCompanySheetsAccess` and the write probe | Update `accessStatus` or `writeReadiness` without appending a row. |
| Tab inspect | Rewrites `CompanySheetsTabContract` and can clear `boundAt` while a job is open. |
| Tab bind and tab create | Bind a contract, provision a header, or add a worksheet, and bump `destinationRevision`. |
| `enqueueConfirmedLeadSheetsDelivery` | Enqueues from the destination and its bound campaign contract when the execution flag allows it. It does not require `campaignDispatchEnabled`. |
| Aged release enqueue | Uses the destination and the bound aged contract for an authorized release. Dispatch off is not the gate. |
| Onboarding captured-test enqueue | Can create a job from an approved worksheet while dispatch is off. |
| Canary approval | Updates `canaryApproved` on the destination row. |
| Delivery execution | A job already queued keeps the destination snapshot it copied, including `destinationRevision`. |
| Delivery-success scan | Reads the destination row while deciding notification evidence. |
| Published column maps | `publishColumnMap` and custom campaign writes use the destination and the map. They do not read this request table. |

`CompanySheetsDeliveryJob` copies spreadsheet, worksheet, control basis, and
`destinationRevision` at enqueue. A later request row cannot retarget that job.
Campaign and aged dispatch read the destination switches. They do not read
this request table.

## Stored contract

One stored row per client. Older rows stay as `superseded`. `requestId` is
unique. The same id and payload replays the stored result. A different payload
with that id is `request_id_reused`. `revision` is `expectedRevision + 1`.
`payloadHash` is SHA-256 of the client, both expected tokens, the parsed
spreadsheet id, and the worksheet id. `actor` is `ADMIN`. There is no delivery
authorization column.

`expectedDestinationRevision` is null only when no destination row exists.
Otherwise it must equal `CompanySheetsDestination.destinationRevision`.

Company control uses `loadReadyConnection`, spreadsheet metadata, and
`establishControl`. Accepted bases are `approved_shared_drive`,
`company_created`, and `drive_owner_verified`. An unapproved shared drive, a
shortcut, a trashed file, a file outside the approved parent, a missing edit
capability, and a non-GRID worksheet are rejected. A spreadsheet id already
stored on another client's destination is rejected. No folder or spreadsheet
is created to make a request valid.

## Concurrency and freshness

The transaction locks the client, that client's destination, and that
client's request rows, and takes a share lock on a destination that already
uses the spreadsheet id. It rechecks the request revision and the destination
revision after those locks. The Google metadata read happens before the
transaction. `controlCheckedAt` is that read. A later move, permission
change, or trash is invisible to the stored row. Any future operational
apply must call `establishControl` again and must not treat this row as
authorization.

An expired company access token can be refreshed by the existing
compare-and-set inside the Google read. That refresh does not change the
Google account, scopes, destination, or delivery flags.
