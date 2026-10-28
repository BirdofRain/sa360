# Google-only pilot preparation

Client: `alex_gross`.
Production baseline reviewed: `abc1638bec57b9b021cf458c21e972210f770e80`.
This document prepares one future Google Sheets-only controlled test. It does not run that test, create a Google file, append a row, call GoHighLevel, change a flag, activate a client, or move a cutoff.

## Decision

| Question | Result |
| --- | --- |
| Separate test spreadsheet supported | Yes, after this draft is reviewed. Approval and append already address a spreadsheet id that is not `CompanySheetsDestination`. This draft refuses the saved production file and any worksheet body that is not empty. |
| Execute the test-worksheet setup now | **NO-GO** |
| Execute an external append | **NO-GO** |

Setup stays no-go until a human has created the empty file in approved company storage, a human has confirmed an operator-owned identity, and a later change reserves one operator-owned `SourceLeadEvent`. That reservation is not in this draft. `decideGoogleOnlyPilot` always returns `append: "no_go"`.

## 1. Separate test spreadsheet

A new worksheet inside Alex's saved workbook is not the safe path. `createMissingCompanySheetsTab` writes a header onto the bound spreadsheet and binds a campaign, aged, or canary role. `tab_already_bound` blocks a second campaign tab. That would touch the production Google file.

`createCompanySpreadsheetForClient` can create a file and returns `destinationSaved: false`. It does not write the 35 exact-v3 headers, and it must not be called for this pilot. The supported destination is a spreadsheet a human creates in approved company storage, with one empty exact-v3 GRID tab. `PUT /admin/v1/clients/:id/onboarding/test-worksheet` then stores `ClientOnboardingTestWorksheet` only. It does not update `CompanySheetsDestination`, the tab contract, dispatch switches, or the cutoff.

The reader `readExplicitOnboardingTestWorksheetHeader` reads only the named spreadsheet and worksheet. It does not fall back to VET Web Form, Campaign Leads, or the first tab. Another client's destination spreadsheet, or another client's test worksheet, returns null before Google is called.

## 2. Worksheet structure and ownership

Row 1 must be these 35 cells, exact text and order, from `COMPANY_SHEETS_V3_HEADER`:

`Date`, `Client Name`, `Phone`, `Email`, `State`, `Lead Type`, `Age`, `DOB`, `Military Status`, `Branch of Service`, `Marital Status`, `Desired Coverage`, `Primary Reason`, `Primary Concern`, `Beneficiary`, `Time to Call`, `Disability Rating`, `Healthcare Profession`, `Rig Type`, `Company or Independent`, `Homeowner`, `House Type`, `Notes`, `First Name`, `Last Name`, `Sex`, `Provider Lead ID`, `Completion Minutes`, `Phone Verified`, `Email Verified`, `TrustedForm Status`, `delivery_row_id`, `client_account_id`, `source_lead_event_id`, `received_at`.

`delivery_row_id` is column AF (header index 31).

Also required:

- Sheet type `GRID`.
- Body range `A2:AI5001` empty. Any non-empty cell in those 35 columns is `has_rows`. A read of 5001 rows is `truncated`. A failed body read is not empty. Approval returns `test_worksheet_not_approved` for all three. Cells past column AI are not scanned.
- Spreadsheet id different from the saved `CompanySheetsDestination.spreadsheetId`. VET Web Form and Campaign Leads fail this check even when Campaign Leads already has the exact-v3 header.
- Control basis `company_created`, `drive_owner_verified`, or `approved_shared_drive`. Stats titles and the Canary header are refused.
- Approved storage, when used, is `COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID` together with `COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID`. The API process reads those values. This draft does not set them.

Production setup that is still required, and was not performed:

1. Create a new spreadsheet in the approved shared drive or approved parent folder.
2. Put the 35 headers on row 1 of one GRID tab and leave every other cell empty.
3. Do not bind that file as the campaign destination.

## 3. Test source event

The captured-test send requires an existing client-owned `SourceLeadEvent`. None of the current paths is safe for Alex.

| Option | Result |
| --- | --- |
| A. One submission through Alex's LeadCapture form | Creates inventory. A real form can fire Zapier. The event looks like a customer lead. |
| B. An isolated test source that cannot create inventory, fulfillment, billing, or delivery | No such source exists for `alex_gross`. |
| C. `submitCompanySheetsCampaignPilot` or the custom-writer sample | The pilot is fixed to the internal test client unless `allowTestClient` is set, requires dispatch to be armed, creates a campaign dispatch intent, and uses `sheets-pilot@example.invalid`. Captured delivery returns `internal_pilot_not_client_proof` for any other client. `sendCompanySheetsCampaignTestRow` does not create a `SourceLeadEvent`. `synthetic@example.invalid` is a sample address, not a stored lead. |

This draft does not add an intake route. The smallest later change is an admin-only reservation that inserts one `SourceLeadEvent` with `enrichmentMetadataJson.recordClass` `onboarding_operator_owned_test`, contact equal to a `ClientOnboardingVerifiedTestIdentity` already stored for that client, `deliveryResultJson` null, and zero inventory, fulfillment, allocation, and dispatch-intent rows. It must not call Google, GoHighLevel, or Zapier, and it must not arm dispatch. Local tests insert that row directly in `sa360_test`. They do not submit a form.

`saveVerifiedTestIdentity` stores `evidenceJson.method` `operator_confirmed`. That is an attestation. It is not proof of mailbox or phone ownership. A human still confirms the identity. The one-shot phrase refuses `.invalid`, `@example.com`, `synthetic@example.invalid`, `synthetic-preview@example.invalid`, and `sheets-pilot@example.invalid`.

Exclusivity is checked against other clients' `ClientOnboardingVerifiedTestIdentity` rows, matched on email or phone. An event for another client is refused as `tenant_mismatch` before that check. The check does not scan every other client's customer leads. The human confirmation in step 4 covers that gap.

## 4. Code in this draft

- `approveExactV3TestWorksheet` refuses a non-empty or unreadable body and refuses the saved production spreadsheet id.
- The worksheet reader classifies `A2:AI5001` as `empty`, `has_rows`, or `truncated`. A failed body read returns null.
- `DELIVER ONE GOOGLE SHEETS TEST ROW` is an additional confirmation. `DELIVER CAPTURED TEST LEAD` is unchanged.
- The one-shot phrase requires destinations exactly `["google_sheets"]`, isolation `isolated_destination` plus `exact_v3_test_worksheet`, both dispatch switches off, an approved spreadsheet different from the production file, record class `onboarding_operator_owned_test`, a null delivery result, identity match, `testIdentitySharedWithOtherClient === false`, a non-synthetic email, and downstream counts that were read and are all zero.
- A successful one-shot records warning `google_only_one_shot`. A later overlapping send returns `one_test_already_used`. An uncertain or in-flight prior returns `repeat_blocked_uncertain` or `repeat_blocked_in_flight` before that phrase can select another destination.
- The planned sheet sets `bodyMustBeEmpty`. A reread that is not `empty` returns `worksheet_blocked` and does not append.
- `readGoogleOnlyPilotPreflight` is a library. It has no HTTP route. Timeout or throw is `unavailable`, never an empty list.
- The Admin C.O.C. delivery button stays disabled. No Prisma migration. No flag default change.

## 5. Missing database evidence

Production Postgres was not queried. This agent has no DigitalOcean or private-network SQL tool. The available tool namespaces are Datadog, Supabase, Vercel, Figma, Gmail, and Cursor cloud diagnostics. None of them is the SA360 production database. The documented production read path is an authorized App Platform console session. It was not opened.

`readGoogleOnlyPilotPreflight` is the local shape of that future read. A timeout is `state: "unavailable"`. `decideGoogleOnlyPilot` then returns setup `no_go` and does not describe the unread tables as empty. Grants are `has_table_privilege(..., 'SELECT')` on the onboarding, lock, job, destination, event, and inventory tables. A missing privilege is no-go, not unavailable.

Unread for `alex_gross`, and not assumed empty:

- approved `ClientOnboardingTestWorksheet`
- stored test identities
- prior `ClientOnboardingTestRun` rows
- `CompanySheetsWorksheetLock`
- jobs with `appendStartedAt` set
- unresolved destination jobs
- `SELECT` grants
- live dispatch switches and cutoff

Agent L's read remains the last production observation: destination workbook "Copy of FaceBook Lead Master - Alex Gross", bound worksheet VET Web Form, schema `company_sheets_campaign_custom_v1`, 15 columns, published custom map; Campaign Leads is exact-v3 and already has production data; captured-test, custom-writer, and GHL adapter flags unset; campaign and aged dispatch paused; 21 existing events are customer records.

## 6. Local proof

Fixtures use a mocked Google client and `sa360_test` on `127.0.0.1`. No production URL, Google account, or GoHighLevel host is called.

With onboarding read and config enabled, Company Sheets enabled with execution and dispatch enabled, captured-test unset, custom writer unset, GHL test-adapter approval unset, and both Alex dispatch switches off:

- captured delivery returns `captured_test_disabled`
- the mock records zero Google calls and zero GHL calls

With only the captured-test flag set inside the test process:

- the approved separate spreadsheet receives one 35-cell append
- the idempotency key starts with `onboarding-test:` and is not `lead:` or `campaign:`
- the production spreadsheet receives zero appends
- GHL is not called
- the saved destination id, VET Web Form binding, dispatch switches, cutoff, inventory, fulfillment, and dispatch intents stay unchanged
- the same request id does not append again
- an uncertain append stays one call; a second send returns `repeat_blocked_uncertain` even if the retry adds `ghl_location_api`
- a customer `recordClass`, a synthetic address, another client's event, and the production spreadsheet id are refused before a call
- Campaign Leads, an empty tab in the production file, and a separate occupied file are refused at approval

## 7. Single-test authorization

The operator mechanism is one API request, not the Admin button.

```text
POST /admin/v1/clients/:id/onboarding/test-runs
confirmation: DELIVER ONE GOOGLE SHEETS TEST ROW
kind: captured_event_delivery
destinations: ["google_sheets"]
isolation.mode: isolated_destination
isolation.sheetsContract: exact_v3_test_worksheet
```

`ghl_location_api` and `ghl_inbound_webhook` return `ghl_destination_not_allowed` for that phrase. The existing button stays disabled and must not be enabled. `DELIVER CAPTURED TEST LEAD` remains able to name GHL when the captured-test flag is on. Do not use that phrase for this pilot, and do not turn the flag on in production as part of this draft.

The captured-test flag is shared by both phrases. A human authorizes the flag only for the single one-shot request, after the worksheet and the operator-owned event exist.

Operations, and whether they write:

| Step | Operation | Writes |
| --- | --- | --- |
| Save a test identity | `PUT .../onboarding/test-identities` → `saveVerifiedTestIdentity` | Database only. Needs the config flag. |
| Approve the isolated worksheet | `PUT .../onboarding/test-worksheet` with both ids | Google metadata, header, body, and Drive control are reads. The write is the `ClientOnboardingTestWorksheet` upsert and an audit row. Production binding is not updated. |
| Read the header | `readExplicitOnboardingTestWorksheetHeader` / `rereadOnboardingCapturedTestSheet` | Google reads. |
| Verify company control | `establishControl` | Drive metadata read. |
| Reserve the test run | `POST .../onboarding/test-runs` with the one-shot phrase | Database test run, attempt, and `CompanySheetsDeliveryJob` kind `onboarding_captured_test`. Needs the captured-test flag. |
| Append one row | `createOnboardingCapturedTestSheetsAppend` → `executeCompanySheetsDeliveryJob` | The only Google write on this path: `values.append` with `RAW` and `INSERT_ROWS`. The stable key is `onboarding-test:{testRunId}:sheets`. |

Do not call `createCompanySpreadsheetForClient`, `createMissingCompanySheetsTab`, campaign-test, the internal pilot, destination profile PUT, or `POST .../onboarding/activate`. Activation stays `activation_disabled`.

## 8. Operator sequence

1. Verify production baseline `abc1638bec57b9b021cf458c21e972210f770e80` and no unresolved destination jobs. Human. Use `readGoogleOnlyPilotPreflight` from an authorized private session. A timeout is unavailable, not an empty queue.
2. Obtain explicit approval to create the test spreadsheet. Human. This repository does not create the file.
3. Obtain explicit approval for one operator-owned source event. Human. The reservation route is not implemented. Do not submit the LeadCapture form and do not reuse a customer event.
4. Confirm the test identity is owned by the operator and is not stored for another client. Human. The stored method `operator_confirmed` does not prove the mailbox or phone.
5. Approve that exact worksheet with `PUT .../onboarding/test-worksheet` and both ids. Human operator. The server refuses the production file and a non-empty body.
6. Preview the 35-column row without writing. Existing preview/replay. Needs the config flag. Does not need the captured-test flag and does not append.
7. Independently authorize exactly one Sheets-only send with the phrase in section 7. Human. Do not use the disabled Admin button and do not include a GHL destination. Set the captured-test flag only under that separate authorization.
8. Inspect the returned stable row id `onboarding-test:{testRunId}:sheets` and the recorded receipt. The source event id stays the original event id.
9. Verify the production destination, cutoff, inventory, billing, and Zapier state are unchanged.
10. Stop permanently on an uncertain append. The response is `repeat_blocked_uncertain`. Do not clear `appendStartedAt` or `CompanySheetsWorksheetLock`. Do not send a second row.

Steps 2, 3, 4, 5, and 7 require a person. Steps 1, 6, 8, 9, and 10 are checks. Step 10 is a stop, not a retry.

## 9. Setup go / no-go

**NO-GO** to perform the setup now.

The separate-spreadsheet approval path is implemented and covered by local tests. It is not enough to start. Still missing: the human-created empty exact-v3 file, a human-confirmed operator identity, the unimplemented event reservation, and a fresh authorized read of the production rows listed in section 5.

## 10. Append go / no-go

**NO-GO.**

No production flag is changed. No live test run is created. No Google append is authorized. An uncertain result blocks every later send, including a retry that adds GoHighLevel.
