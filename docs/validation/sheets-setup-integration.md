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
- Worksheet headers are stored literally, including `""` and a header whose
  only character is U+200B. Fingerprints, publication, and writer validation
  compare those literals by column index. U+200B is not decoded and is not
  rewritten. A remaining U+200B cell is the stored header text. It is not
  labeled a sentinel or a defect by this migration.
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
`ClientSheetColumnMap_scope_chk` so a header cell may be length 0 through
200. It does not update `ClientSheetColumnMap` or any delivery job.

Master stores `headerSnapshot` from the worksheet read
(`column-maps.ts` on `73eac95d`). The writer that stored a blank header as
U+200B is only on unmerged PR #262. It is not on master, so this migration
does not convert U+200B cells. No separate repair is included. A later
repair would have to name verified rows and keep the snapshot, assignments,
revision, binding, and audit evidence together. A published map's header
must not change meaning, and a job `headerContract` is not edited to satisfy
a check.

Empty strings were invalid under `client_onboarding_v2_string_array_ok`
(length 1–200). After this migration, a new map can store `""`. A header
that is already U+200B stays U+200B. The previous app on master also stores
the Google text and cannot insert `""` until this check is in place. It does
not encode blanks as U+200B.

This file was corrected before any shared database applied it. Production
has no `_prisma_migrations` row for it. Do not update a production checksum.
An earlier draft of this same file rewrote every U+200B cell to `""`. That
draft must not be applied.

## Execution window

The worker does not append. It POSTs the drain. The API process appends.
Setting `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED` false does not stop
every writer, and it does not change a process that already started.

Appends from this API:

- `executeCompanySheetsDeliveryJob` when the execution flag is `true`. That
  is the lead, aged, and canary path, and the admin execute route.
- `sendCompanySheetsCampaignTestRow` and
  `sendCompanySheetsCapturedEventTestRow`. Both pass
  `controlledCampaignTest` and append while the execution flag is false.
  The captured-event test also requires
  `SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED=true`. Both require
  `SA360_COMPANY_GOOGLE_SHEETS_ENABLED=true`.
- `appendOnboardingCapturedTestRow` appends while the execution flag is
  false when `SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED` and
  `SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED` are both `true`.
- `bindCompanySheetsTab` and `createMissingCompanySheetsTab` call
  `provisionBlankSheetHeader`, which `values.append`s a header on an empty
  sheet. They check `SA360_COMPANY_GOOGLE_SHEETS_ENABLED` only. A tab
  contract in `setupState = 'creating'` is that claim, and it stays in
  progress for 120 seconds.

Disabling new intent creation does not stop a job that is already queued,
retryable, or running. `SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED` false
stops the drain, including the settlement below. It does not stop
`executeCompanySheetsDeliveryJob` or the test-row and tab-provision paths.

Before the header migration:

1. Set `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED` false. Set
   `SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED` false and
   `SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED` false. Leave Alex's
   campaign dispatch paused. Do not call Send Test Row, captured-test
   append, bind tab, or create tab.
2. Restart every API instance so it loaded those values. Record each
   instance's start time. A platform env edit does not prove an old process
   stopped. A request that already passed its check can still append until
   that process exits.
3. Let an in-flight request finish before the process is killed. Then wait
   one execution lease, 380 seconds.
4. Read the rows. Migrate only when this is empty:

```sql
SELECT id, kind, "startedAt", "appendStartedAt"
FROM "CompanySheetsDeliveryJob"
WHERE status = 'running';
```

And this is empty:

```sql
SELECT id, role, "updatedAt"
FROM "CompanySheetsTabContract"
WHERE "setupState" = 'creating'
  AND "updatedAt" > now() - interval '120 seconds';
```

5. If a restart aborted a request, the job can still say `running` after the
   lease. Do not turn execution on to clear it. That can append. Do not
   edit `headerContract`. Apply the two person migrations (they do not
   change jobs or headers), deploy this build with execution still off,
   and run one drain with dispatch enabled. That drain settles an expired
   pre-append run back to `retryable` and an expired run with
   `appendStartedAt` set to `uncertain` (`worker_lost`). It does not call
   Google. A run still inside the lease stays `running`; wait, then drain
   again. If the drain errors, read the running query and retry the drain.
   Repeat the queries. Apply the header migration only after both are empty.
6. If step 4 was already empty, apply all three migrations, then deploy
   this build with execution still off, then run the same drain and read
   the queries again.
7. Leave execution off until the post-deploy checks below are read.
   Turning execution on is a separate decision. When it is turned on,
   `leadJobMayAppend` covers queued and retryable lead jobs and a lead job
   whose claim is resumed. History and transient assessment gaps go back to
   `queued` with no Google call. Other holds become conclusive pre-send
   failures (`appendStartedAt` null, `rowsWritten` 0) and are not indexed.
   An `uncertain` job returns `uncertain` before the claim. Do not mark an
   uncertain append safe to retry.

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
  `""`. The master app stores the Google text and rejects length 0. It does
  not encode a blank as U+200B.
- Leave a U+200B header cell as stored. It matches a Google cell with that
  same text. It is not rewritten to `""`.

## Post-deploy checks

- A U+200B header cell is stored text. This count is not a defect count
  and it is not a sentinel count:

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
