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
- The whole declared grid, not `A2:AI5001`, must be proven empty beyond the 35 header cells. Row 0 must contain all 35 required headers. For each column index 0 through 34 the cell must exist, be nonblank, and equal the exact v3 header at that index. A missing, blank, shifted, shortened, or incorrect header is `occupied`, never `empty`. The reader asks Google for `gridProperties.rowCount` and `columnCount`, then reads that rectangle with `valueRenderOption=FORMULA`. A formula whose displayed value is blank, including `=""`, is occupied. Row 5002 and column AJ are inside the proof when the grid declares them. A grid taller than 5002 rows or wider than column AZ (52 columns), a missing dimension, or a failed formula read is `unproven`. Approval refuses `unproven`, `truncated`, and `has_rows`. An incomplete scan is never treated as empty. `classifyExactV3Grid` is the same helper used by the execution-time proof.
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

This draft does not add an intake route and does not create a production `SourceLeadEvent`. `recordClass` `onboarding_operator_owned_test` is a label. It is not a quarantine. `operatorOwnedIntake` refuses every current `SourceLeadEvent` shape, including `sourceProvider` `manual_import`, `sourceSystem` `external_vendor`, and `sourceType` `manual_entry`. A `recordClass` label, that source triple, a fake email domain, and a request body that claims operator ownership do not make an event eligible. An unknown future source triple is also refused. Eligibility requires a later, explicitly registered test-only route or a durable authorization record. That creator is not in this release, so a one-shot request for a current event returns `quarantine_not_registered` and does not append.

`saveVerifiedTestIdentity` stores `evidenceJson.method` `operator_confirmed`. That is an attestation. It is not proof of mailbox or phone ownership. A human still confirms the identity. The one-shot phrase refuses `.invalid`, `@example.com`, `synthetic@example.invalid`, `synthetic-preview@example.invalid`, and `sheets-pilot@example.invalid`.

Exclusivity is checked against other clients' `ClientOnboardingVerifiedTestIdentity` rows and against other clients' `SourceLeadEvent` contact email and phone. A match, or a check that was not read, refuses the send. The reservation transaction repeats the identity, provenance, and downstream-count checks before inserting the run.

## 4. Code in this draft

- `approveExactV3TestWorksheet` refuses a non-empty, truncated, or unproven body and refuses the saved production spreadsheet id.
- The worksheet reader uses grid dimensions and a formula-aware full-body read. `empty` is the only proof that the body is empty. A failed or oversized read is `unproven`, not empty.
- Execution requires both `SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED` and `SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED` to be the exact string `true`. Either flag alone, or any other value, does not authorize an external call. The gate runs in `planCapturedTestDelivery` and on the mounted test-run route before the world is loaded.
- `DELIVER ONE GOOGLE SHEETS TEST ROW` with destinations exactly `["google_sheets"]`, isolation `isolated_destination`, and `sheetsContract` `exact_v3_test_worksheet` is the only executing shape. `DELIVER CAPTURED TEST LEAD`, `REPEAT CAPTURED TEST LEAD`, GoHighLevel-only, Sheets plus GoHighLevel, and `synthetic_delivery` return `google_only_pilot_required` and make no external call. The older planner remains in source and is not authorized by this flag pair.
- `appendOnboardingCapturedTestRow` and `enqueueOnboardingCapturedTestJob` call `authorizeGoogleOnlyAppend` before a delivery job is inserted. `executeCompanySheetsDeliveryJob` calls the same function for `onboarding_captured_test` before claim and before any Google token request. The append request has no confirmation field. Authorization reads the persisted `ClientOnboardingTestRun`: both flags exact `true`, idempotency key `onboarding-test:{testRunId}:sheets`, the run id and source event and client, the one-shot snapshot, destinations exactly `["google_sheets"]`, isolation `isolated_destination`, contract `exact_v3_test_worksheet`, the approved isolated worksheet, and no prior succeeded, uncertain, or executing one-shot. A caller-built `OnboardingCapturedTestAppendRequest` cannot supply that proof. `controlledOnboardingCapturedTest` only bypasses the global execution switch. It does not authorize the job.
- A current source event still fails `assertGoogleOnlyReservation` with `quarantine_not_registered` after those checks. This release does not insert a quarantine authorization, so the one-shot does not append. A mismatched run id returns `test_run_not_reserved`. A run owned by another client returns `tenant_mismatch`. A snapshot spreadsheet or worksheet that differs from the approved isolated worksheet returns `test_worksheet_not_approved`. An uncertain or executing prior returns `repeat_blocked_uncertain`. A succeeded prior returns `one_test_already_used`. Those refusals create no delivery job and make no external call.
- While the new flag is exact `true`, the GoHighLevel test adapter refuses before fetch. Replaying a stored request id with a different confirmation returns `google_only_pilot_required` for a current event, because the event is refused before a run is stored. An uncertain onboarding job stays uncertain: `releaseCompanySheetsDeliveryHold` returns `append_outcome_unresolved` and does not clear `appendStartedAt` or the worksheet lock.
- The planned sheet sets `bodyMustBeEmpty`. A reread that is not `empty` returns `worksheet_blocked` and does not append.
- `GET /admin/v1/clients/:clientAccountId/onboarding/google-only-pilot/preflight` is read-only. It accepts only the client id in the path. It requires the Admin API key and rejects portal, workspace, portal-assertion, and observer credentials. A failed or timed-out read is `unavailable` or `unverified`, never an empty success. Table grants are `has_table_privilege('sa360_app', ...)`. The response has no SQL, credentials, emails, or phones. It performs no writes and no Google or GoHighLevel request. `decideGoogleOnlyPilot` still returns `append: "no_go"`.
- The Admin C.O.C. delivery button stays disabled. No Prisma migration. No flag default change.

## 5. Missing database evidence

Production Postgres was not queried. This agent has no DigitalOcean or private-network SQL tool. The available tool namespaces are Datadog, Supabase, Vercel, Figma, Gmail, and Cursor cloud diagnostics. None of them is the SA360 production database. The documented production read path is an authorized App Platform console session. It was not opened.

`readGoogleOnlyPilotPreflight` is the local shape of that future read. A timeout is `state: "unavailable"`. `decideGoogleOnlyPilot` then returns setup `no_go` and does not describe the unread tables as empty. Grants are `has_table_privilege('sa360_app', ..., 'SELECT')` on the onboarding, lock, job, destination, event, and inventory tables. A missing privilege or a grant read that cannot be performed is `unverified`, and the decision is no-go. It is not an empty grant list.

Unread for `alex_gross`, and not assumed empty:

- approved `ClientOnboardingTestWorksheet`
- stored test identities
- prior `ClientOnboardingTestRun` rows
- `CompanySheetsWorksheetLock`
- jobs with `appendStartedAt` set
- unresolved destination jobs
- `SELECT` grants
- live dispatch switches and cutoff

Agent L's earlier read remains the last full production observation: destination workbook "Copy of FaceBook Lead Master - Alex Gross", bound worksheet VET Web Form, schema `company_sheets_campaign_custom_v1`, 15 columns, published custom map; Campaign Leads is exact-v3 and already has production data; campaign and aged dispatch paused; 21 existing events are customer records. Agent J's latest observation is that `SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED` is `true`. Captured-test, Google-only pilot, and GHL adapter approval flags remain unset. This draft does not read or change that custom-writer flag and does not affect its traffic.

## 6. Local proof

Fixtures use a mocked Google client and `sa360_test` on `127.0.0.1`. No production URL, Google account, or GoHighLevel host is called.

With onboarding read and config enabled, Company Sheets enabled with execution and dispatch enabled, captured-test unset, custom writer unset, GHL test-adapter approval unset, and both Alex dispatch switches off:

- captured delivery returns `captured_test_disabled`
- the mock records zero Google calls and zero GHL calls

With only the captured-test flag set, and with only the new pilot flag set, every executing phrase returns `google_only_pilot_required` and the mock records zero Google calls and zero GoHighLevel calls.

With both flags set to the exact string `true` inside the test process, `DELIVER ONE GOOGLE SHEETS TEST ROW` with destinations exactly `["google_sheets"]` still returns `quarantine_not_registered` for a current intake shape:

- the mock records zero Google calls and zero GHL calls
- no `onboarding_captured_test` job is created
- no `ClientOnboardingTestRun` is stored for that forged request
- the production spreadsheet receives zero appends
- the saved destination id, dispatch switches, cutoff, inventory, fulfillment, and dispatch intents stay unchanged
- the same request id, `DELIVER CAPTURED TEST LEAD`, `REPEAT CAPTURED TEST LEAD`, Sheets plus GoHighLevel, GoHighLevel-only, and `synthetic_delivery` also make zero external calls
- a direct append or enqueue without a persisted exclusive run returns `test_run_not_reserved` and creates zero jobs
- a persisted exclusive run of a current `manual_import` event still returns `quarantine_not_registered`
- a mismatched `testRunId` returns `test_run_not_reserved`; a run owned by another client returns `tenant_mismatch`; a snapshot aimed at a different spreadsheet returns `test_worksheet_not_approved`
- an uncertain prior returns `repeat_blocked_uncertain` and a succeeded prior returns `one_test_already_used`, both before a new job
- an already uncertain onboarding job is not retried: `appendStartedAt` and the worksheet lock stay set
- a customer `recordClass`, a synthetic address, another client's event, and the production spreadsheet id are refused before a call
- a missing, blank, shifted, or incorrect header is `occupied`, not `empty`
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

`ghl_location_api` and `ghl_inbound_webhook` are not an authorized shape. They return `google_only_pilot_required` before a destination-specific error. The existing button stays disabled and must not be enabled. `DELIVER CAPTURED TEST LEAD` and `REPEAT CAPTURED TEST LEAD` stay in source and cannot execute under this flag pair.

Both flags and the one-shot phrase are not sufficient while no durable quarantine authorization exists. Do not turn either pilot flag on in production as part of this draft. The custom-writer flag was observed on and is left unchanged.

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

No production flag is changed. No live test run is created. No Google append is authorized. Current intake cannot become a quarantine, so `decideGoogleOnlyPilot` stays `append: "no_go"`. An uncertain result does not release its lock, clear `appendStartedAt`, or authorize a retry.

## 11. Approval-time and execution-time emptiness

Approval calls `classifyExactV3Grid` and refuses anything other than `empty`. Row 0 must hold the exact 35 v3 headers. A missing, blank, shifted, shortened, or incorrect header is `occupied` and is never `empty`. The writer does not trust that approval. `executeCompanySheetsDeliveryJob` takes `CompanySheetsWorksheetLock`, reconciles a row that already contains the stable `delivery_row_id`, and, for an `onboarding_captured_test` job that still has a pending row, calls the same `classifyExactV3Grid` helper on a formula-aware read before `appendStartedAt` and before `values.append`. A non-empty or unproven proof finishes the job retryable with `worksheet_blocked` and does not append.

`CompanySheetsWorksheetLock` serializes SA360 jobs for one worksheet. Google does not provide an atomic worksheet lock to SA360. An editor outside SA360 can still write between the formula read and `values.append`. The database lock does not cover that gap. Grid dimensions can also grow between the metadata read and the values read; a values row or column outside the declared grid is `unproven`, not empty. Approval-time emptiness is not execution-time emptiness.

## 12. Operator-owned event quarantine design

This is the design for the next change. This draft does not implement the creator, does not add a migration, and does not insert a production `SourceLeadEvent`.

A metadata `recordClass` is not a quarantine. The future record is its own table, owned by a later Auth/Account migration, not a customer `SourceLeadEvent`.

Creation:

- Admin C.O.C. API key only. Observer, portal, and workspace credentials are rejected.
- The operator identity is a `ClientOnboardingVerifiedTestIdentity` already stored for that one client. The contact must match it and must not match another client's verified identity or another client's stored lead email or phone.
- One durable source event id, unique per client, created by this admin reservation. It is not a LeadCapture replay and it has no `webhookRequestLogId`.
- Provenance is a dedicated authorization row that customer intake cannot set. It is not `manual_import` / `external_vendor` / `manual_entry`, not a `recordClass` label, and not an email domain. `operatorOwnedIntake` stays false for every current schema enum and for an unregistered future triple until that row exists and a later change teaches the checker to read it.
- `deliveryResultJson` stays null. Inventory, fulfillment, allocation, dispatch intent, and verification-approval audit counts are zero. The reservation transaction re-reads those counts and the identity collisions before commit.
- No campaign or aged dispatch, no provider webhook, no Zapier, no GoHighLevel, no billing, and no automatic retry. The row is not evidence of genuine customer intake.

Enforcement belongs at every side-effect entrypoint, not only at creation. Each of these must refuse the quarantine id: inventory registration, allocation, fulfillment outbox, verification-approval audit, company-sheets dispatch intent creation, provider webhook dispatch, Zapier and GoHighLevel delivery, and the campaign and aged dispatch planners.

Future files and tables, not part of this pull request:

- Prisma migration and model for the quarantine table. Auth/Account lane. Suggested columns: id, clientAccountId, sourceEventId unique, provenance, contact email and phone, verifiedIdentityId, createdByActor, deliveryResultJson null, createdAt.
- Admin route and service that insert only that table.
- Guards in the inventory, fulfillment, allocation, billing audit, dispatch-intent, webhook, Zapier, GoHighLevel, campaign, and aged entrypoints.
- Tests for cross-client identity collision, a forged customer label, a non-zero downstream count inside the reservation transaction, and a refused call at each entrypoint.
- Tables read by those checks: `ClientOnboardingVerifiedTestIdentity`, `SourceLeadEvent`, `LeadInventoryItem`, `FulfillmentOutbox`, `LeadAllocation`, `CompanySheetsDispatchIntent`, `LeadVerificationApprovalAuditEvent`.

## 13. Preflight route contract

`GET /admin/v1/clients/:clientAccountId/onboarding/google-only-pilot/preflight`

- Authority: `x-sa360-admin-key` via `verifyAdminApiKey`. Missing key is 401.
- Rejected before verify: `x-sa360-client-portal-key`, portal assertion, `x-sa360-workspace-key`, and cookie `sa360_admin_session=observer`. Status 403. The path is not on the observer allowlist.
- Input: the path client id only. Empty, longer than 120 characters, or containing whitespace or quotes is 400. No request body and no SQL.
- Tenant: the report's client id must equal the path id, or the response is 403 `tenant_mismatch`.
- Reports: approved test worksheet presence, schema, control, and whether it is the same spreadsheet as the saved destination; verified identity presence and evidence method strings; conflict counts; prior run count, one-shot consumption, and uncertain or executing runs; worksheet locks with worksheet id, owner job id, and held; held `appendStartedAt` and unresolved job ids; both dispatch switches and both cutoffs; quarantine eligibility. Eligible count is 0 in this release because no dedicated quarantine table exists.
- Read failure is `unavailable`. A grant or production read that cannot be performed is `unverified`. Neither is an empty list. Grants use `has_table_privilege('sa360_app', c.oid, 'SELECT')`.
- Response excludes credentials, emails, phones, payloads, and spreadsheet titles. `writes` is false. `externalCalls.sheets` and `externalCalls.ghl` are false. `decision.append` is `no_go`.

## 14. Published column-map preview follow-up

The production mapping workflow is unchanged: browse the approved folder, select an authorized spreadsheet, choose a worksheet, read columns in their stored order, suggest and edit mappings, save a draft, and publish. Publishing does not call Google and does not rewrite historical rows or formulas. Changing the target or the published map while campaign delivery is active returns "Pause campaign Sheets delivery before changing the target or the column map."

Follow-up, not implemented here: "Preview selected stored lead through the published custom column map, read-only." Show the exact field-to-column value, a blank mapping, and missing source data. Do not append a row to preview a mapping. Do not use the isolated 35-column test writer for that preview.

## 15. Review and merge decisions

| Question | Result |
| --- | --- |
| Agent J re-review of this draft | **GO** to re-review the corrected draft. The draft is not an approval to append, and it is not a merge approval. |
| Merge while the captured-test and Google-only pilot flags stay unset | **NO-GO** until that re-review. Enabling the existing captured-test flag alone does not authorize execution. The new pilot flag also defaults unset. `SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED` was observed `true` in production and is not changed by this draft. |
| Pilot setup and an external append | **NO-GO**. There is no quarantine creator, so current intake cannot become eligible. There is no human-created empty file and no authorized production read. `decision.append` remains `no_go`. |

Residual: when the new pilot flag is unset, the separately reviewed GoHighLevel loopback adapter can still post if its own flags are set. That path is not an authorized pilot route. The captured-test service never reaches it under this flag pair, and the adapter refuses when the pilot flag is exact `true`. Google does not give SA360 an atomic lock. An editor outside SA360 can still change the grid between the post-lock formula read and `values.append`. The custom-writer flag stays at its observed production value. This draft does not query production Postgres.
