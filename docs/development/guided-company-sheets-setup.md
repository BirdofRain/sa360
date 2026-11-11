# Guided Company Sheets setup

Team Workspace can show an operator the company Google connection, approved
storage, the client folder, spreadsheets in that folder, and worksheet ids.
It does not save a destination, create a Drive file, or turn delivery on.

Life Agent Launch owns the Google account. This guide does not ask a client
to connect Google and does not show account credentials.

The flags `NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED`,
`SA360_TEAM_WORKSPACE_ENABLED`, and `SA360_NATIVE_CLIENT_SETUP_ENABLED` stay
default-off. This document does not turn them on, and it does not change
`SA360_COMPANY_GOOGLE_OAUTH_ENABLED`, `SA360_COMPANY_GOOGLE_SHEETS_ENABLED`,
`SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED`, or
`SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED`.

## States

Configured, verified, and active are separate.

- Configured means a `CompanySheetsDestination` row is already saved.
- Verified means this session read that saved spreadsheet through
  `establishControl` and the bound campaign worksheet id is on that file.
  A stored control basis, a readable URL, or a file merely listed in a folder
  is not verification.
- Active means `campaignDispatchEnabled` or `agedDispatchEnabled` is already
  true. The destination presenter hard-codes `enabled`, `liveDeliveryEnabled`,
  and `deliveryExecution` to disabled. Those fields are not the dispatch
  switches. The execution flag is not in the dispatch read, so this page does
  not claim to know it.

## What is safe to call

| Call | Class | Gate | Writes | Google |
| --- | --- | --- | --- | --- |
| `GET /admin/v1/integrations/google/company` | Read | Admin key. Works with the OAuth and setup flags off. | None. Tokens are not in the body. | None |
| `GET .../google-sheets/destination` | Read | Admin key. Works with the setup flag off. | None | None |
| `GET .../google-sheets/tabs` | Read | Admin key. Stored contracts only. | None | None |
| `GET .../google-sheets/dispatch` | Read | Admin key. | None | None |
| `POST .../google-sheets/column-mapping` | Read | `SA360_COMPANY_GOOGLE_SHEETS_ENABLED` exact `true` after trim and lower-case. | None. It does not publish a map. | None |
| `POST .../google-sheets/folder` with `intent: "inspect"` | Metadata read | Setup flag. | None when the decision stays `select`. Any other outcome is shown as a storage change and is not treated as success. | Drive metadata and a child-name list. An expired access token can be refreshed by the existing compare-and-set. |
| `GET .../google-sheets/folder/spreadsheets` | Metadata read | Setup flag. | None | Lists children of the recorded folder. Shortcuts, trashed files, and files outside the approved drive are skipped. |
| `POST .../google-sheets/folder/resolve` | Metadata read | Setup flag. | None | Drive metadata, ancestry, shortcut, and capability checks. |
| `POST .../google-sheets/resolve` | Metadata read | Setup flag. | None. It does not save the destination. | Spreadsheet metadata plus `establishControl`. A readable URL is rejected unless those checks pass. |

Loading the guide calls only the first four reads, plus column-mapping when
setup is already enabled. Storage and worksheet reads run only after the
operator clicks Check storage or Read worksheets.

## What is not safe to expose

A disabled delivery flag does not make these safe. Several of them change the
row a later dispatch would use, or they change Google Drive, while dispatch
is off.

| Call | Class | Why it stays out of the guide |
| --- | --- | --- |
| `GET .../oauth/start` and the company OAuth callback | Credential write | Starts or stores company Google credentials. |
| `POST .../company/disconnect` | Credential write | Revokes or wipes the company token. With the OAuth flag off it still wipes the local credential. |
| `PUT` or `DELETE .../company/folder` | Destination metadata write | Stores or clears the company parent folder. |
| `POST .../google-sheets/folder` without `intent`, or with `link` or `create` | Drive and database write | Can create a folder, link one, or hold a create claim. |
| `POST .../folder/unlink` | Database write | Marks the client folder unlinked. |
| `POST .../google-sheets/create` | Drive write | Creates or reuses a spreadsheet file and can insert `CompanySpreadsheetCreation`. |
| `PUT` or `DELETE .../google-sheets/destination` | Destination write | Saves or deletes the operational destination. A spreadsheet change is refused while dispatch is on, but a worksheet change on the same spreadsheet is not, and a first save creates the operational row. Unresolved jobs block only a spreadsheet-id change. |
| `POST .../tabs/inspect` | Contract write | Can mark a bound tab incompatible and clear `boundAt` while a job is open. `googleMutations: 0` does not make the database write safe. |
| `POST .../tabs/bind` | Contract write | Binds a tab, can provision a header, and bumps the destination revision. |
| `POST .../tabs/create` | Drive write | Adds a worksheet. |
| `POST .../google-sheets/test` | Destination write | Updates `accessStatus` on the saved destination. |
| `POST .../write-probe` | Destination write | Can set `writeReadiness` on the bound campaign destination. It does not append a row. |
| `POST .../campaign-test`, `.../canary`, delivery enqueue, execute, and dispatch activation | Delivery | Sends a row, enqueues a job, or turns a dispatch switch on. |
| `POST .../internal/process-dispatch` | Delivery | Drains due intents. |

Concurrent risks that this guide avoids: folder creation uses a short claim
lock; spreadsheet placement uses another lock; tab inspect and bind rewrite
the contract the writer snapshots at enqueue; a worksheet-only destination
save changes the target for the next job; token refresh uses
compare-and-set and can race with another refresh.

## Configuration request

An authorized operator can save an intended spreadsheet id and GRID worksheet
id through `CompanySheetsDestinationConfigurationRequest`. The Team Workspace
guide calls:

`GET /admin/v1/clients/:clientAccountId/company-sheets-destination-configuration`

`POST /admin/v1/clients/:clientAccountId/company-sheets-destination-configuration`

`SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED` must be the exact string `true`
after trim. It stays default-off. The flag does not turn on OAuth, Sheets
setup, execution, or dispatch.

The saved operational destination, the stored request, the unsaved selection,
and this session's Google metadata read stay separate. A stored request is
not a destination. A previous read is not verification after the spreadsheet
selection changes. POST sends `requestId`, `expectedRevision`,
`expectedDestinationRevision`, `spreadsheetId`, and `worksheetId`. It does
not send titles, control basis, or credentials. The guide does not call
destination save or delete, tab bind, column-map publish, folder or file
creation, access tests, write probes, or delivery.
