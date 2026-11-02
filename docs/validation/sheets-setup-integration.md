# Sheets setup integration

Integration of campaign DOB/age delivery (PR #260), the Google Sheets mapping
workflow (PR #262), and client Sheets person admission (PR #261). This note
is the rollout record. It does not migrate production, backfill, replay,
change Zaps, activate delivery, or repair a historical spreadsheet. Alex
stays paused.

## What this build changes

- One DOB projection: `campaign-dob-age.ts` from PR #260. Reference rule
  `submitted_at_utc_date_else_received_at_utc_date`. Invalid nonempty
  `submitted_at` does not block the stored receipt. Date-only DOB keeps the
  written token. `ageUnavailableReason` is `no_valid_reference` or
  `future_date_of_birth`. The browser renders `sheet.values` and
  `sheet.dobAge`. It does not calculate age.
- Worksheet headers are stored literally, including `""`. A header that is
  only U+200B stays U+200B. Fingerprints, publication, and writer validation
  compare those literals by column index. The old U+200B blank sentinel is
  not decoded on read, so a leftover sentinel fails `exactHeader` against a
  truly empty Google cell.
- Draft warnings come from `sheetsColumnMapIssues` on the current
  assignments. A saved issue list is not what the editor shows.
- Campaign lead execution calls `leadJobMayAppend` before any worksheet lock
  or Google append. The quarantine planner still returns `ran: false` and
  does not stop a job by itself.
- Intent copy: `recovered` only for `pending` + `person_hold_recovered`.
  `delivered` only for `completed`. `scheduled` is never delivered.
- Operator routes, admin key required:
  - `POST /admin/v1/clients/:clientAccountId/google-sheets/person-holds/:sourceLeadEventId/recover`
  - `POST /admin/v1/clients/:clientAccountId/google-sheets/person-reservations/:sourceLeadEventId/release`
  The Google Sheets panel buttons are "Re-evaluate hold" and "Release
  known-dead reservation". Both responses include `googleCalled: false`.

## Migration order

Apply these in filename order, after the migrations already on master. Do
not edit them. Do not run them against production in this task.

1. `20261102180000_client_sheets_person_admission`
2. `20261102190000_client_sheets_person_recovery`
3. `20261102200000_client_sheet_header_literal`

The first two are additive tables and columns. The third replaces
`ClientSheetColumnMap_scope_chk` so a header cell may be length 0, then
rewrites cells whose entire text is U+200B to `""` without reordering the
array. Empty strings were invalid under the previous check, so the
constraint change has to land before that rewrite.

The third migration is not sufficient by itself while the previous app is
still serving. That app writes a new blank header as U+200B. This app does
not decode it. A row written by the old app after the rewrite fails closed
as `header_changed` until an operator republishes against the live header.

## Execution window

Disabling new intent creation does not stop a job that is already queued,
retryable, or running. The execute guard exists only in this build.

1. Set `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED` false.
2. Wait until no lead job is `running`. A request that already passed the
   execution-off check can still append. Do not deploy over that request.
3. Apply the three migrations.
4. Deploy this build.
5. Leave execution off until the post-deploy checks below are read.
6. Turning execution on is a separate decision. It is not part of this
   integration. When it is turned on, `leadJobMayAppend` covers queued and
   retryable lead jobs and a lead job whose claim is resumed. History and
   transient assessment gaps go back to `queued` with no Google call. Other
   holds become conclusive pre-send failures (`appendStartedAt` null,
   `rowsWritten` 0) and are not indexed. An `uncertain` job returns
   `uncertain` before the claim. Do not mark an uncertain append safe to
   retry.

`SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED` false stops new intents. It
does not stop `executeCompanySheetsDeliveryJob`.

## Queue reconciliation

Before execution is turned on, an operator can call
`planPreMigrationLeadJobQuarantine` per client and read the list. That call
does not change jobs. With this build deployed and execution still off, the
list is informational. With execution on, the guard is what stops an
unadmitted lead job. Do not treat a job on that list as already quarantined.

History indexing does not create a duplicate of the same event
(`replay_allowed`). It does not treat a queued job, or a failed job that
never started an append, as a successful delivery.

## Rollback

- Do not roll this app back while queued or retryable lead jobs exist unless
  execution stays off. The previous app would execute those jobs without
  the admission guard.
- The person tables are additive. Leaving them in place is compatible with
  the previous app. Dropping them while this app is running breaks the gate.
- Do not restore the old header check while any `headerSnapshot` contains
  `""`. The previous writer would also start storing new blanks as U+200B
  again.
- A U+200B cell left after the rewrite is a failed-closed header mismatch,
  not a blank. Republish from the live header. Do not decode it in the app.

## Post-deploy checks

- Count maps that still contain a U+200B header cell:

```sql
SELECT COUNT(*)
FROM "ClientSheetColumnMap"
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements("headerSnapshot") AS item
  WHERE item #>> '{}' = E'\u200b'
);
```

- Confirm Alex's campaign dispatch is still paused and destination delivery
  is still off. Do not enable either.
- Read `ClientSheetsHistoryCoverage` for any client whose execution would be
  turned on. `indexedCount` is not completeness. Completeness is `status`
  plus `completenessProof` (`cursor_exhausted` or `no_eligible_jobs`).
- Count lead jobs in `queued`, `retryable`, or `running` with no
  `ClientSheetsPersonAdmission` for that event. Those jobs are not safe to
  execute on the previous build.
- An `uncertain` lead job stays uncertain. Do not release it with the
  known-dead route. That route returns `uncertain_append_held`.

## Save and publish proof

The successful publish in
`column-maps.integration.test.ts` goes through
`POST /admin/v1/clients/:clientAccountId/onboarding/column-maps/:mapId/save-and-publish`
with `readExistingWorksheet` injected. The response is
`worksheetRead: "controlled_fixture"` and `cellsWritten: false`. That is a
controlled Google read, not a live Google write. A refused reader stays a
draft, with the same `cellsWritten: false` and `worksheetRead` value.

When the route is mounted without `readExistingWorksheet`, `worksheetRead`
is `live_google`. That path reads Google and still does not write cells
(`cellsWritten: false`, `headerRewritten: false`). A live Google write was
not performed in this task.

## Missing production DOB evidence

No production event body was read for this integration. Deployed health at
the time of PR #260 was `commitSha`
`73eac95d75f8e10069cad1fd2d3152aa5a419591`. This environment has no
authorized production database session. Datadog was not used.

The remaining read, without replay, is one redacted `alex_gross`
`SourceLeadEvent`: the original DOB key, its JSON type, the value,
`sourceAttributes`, `unmappedSourceFieldsJson`, `lead_details`, and the
published custom-map Age and DOB targets. Do not write the event, do not
re-drive the webhook, and do not append a sheet row. See
`docs/validation/campaign-dob-age-delivery.md`.
