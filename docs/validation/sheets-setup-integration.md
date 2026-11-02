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

## Release sequence

Production at this preflight is unchanged. The candidate is PR #263. Deploy
it only with the sequence below. `prisma migrate deploy` applies every
pending migration in one pre-deploy job. Do not split that job into "apply
two, deploy, apply the third". Do not insert a `_prisma_migrations` row.
Do not change a migration checksum.

### What the platform does

Live App Platform app `sa360` (`2c381355-37a1-415f-bf06-ad477add164e`),
read during this preflight:

- Job `sa360-migrate`, `kind: PRE_DEPLOY`, `run_command: pnpm migrate:deploy`.
  The job has no env of its own and inherits the app database binding.
  `pnpm migrate:deploy` is `prisma migrate deploy`.
- Service `sa360-api`, `instance_count: 1`. This process appends.
- Worker `sa360-worker`, `instance_count: 1`. It does not append. It POSTs
  `POST /admin/v1/company-sheets/internal/process-dispatch` when its
  dispatch flag is `true`.
- `deploy_on_push` is true on `sa360-api` and on `sa360-migrate`. The
  worker tracks `master` and that field is absent on its component. The
  active deployment still deployed the worker in the same attempt. One
  deployment replaces the single API instance, the worker, and the migrate
  job together.
- Active deployment `ea8ec950-6d27-4247-abb9-8f605f92233f` is `ACTIVE` from
  commit `73eac95` on `master` (created 9:42 AM ET, updated 9:49 AM ET on
  Nov 2, 2026). `GET https://api.lifeagentlaunch.com/health` returned
  `commitSha` `73eac95d75f8e10069cad1fd2d3152aa5a419591`.
- `sa360-admin-coc` (`2075694a-ed30-4e7c-ae59-87b3ebfa9db7`) is a separate
  app. Its spec has no jobs. It does not append.

A normal deployment runs `sa360-migrate` because its kind is `PRE_DEPLOY`.
`prisma migrate deploy` applies every pending migration in that one job. A
non-zero exit fails the deployment and leaves the previous deployment
serving. That is the supported migration step. The progress payload for
`ea8ec950-6d27-4247-abb9-8f605f92233f` lists the API, the worker, and the
migrate job under one deploy phase and does not include per-component start
times, so this preflight did not measure migrate's exit against the API
health change on that attempt. Do not invent a manual split to compensate.
The previous deployment keeps its process and its env until the new
deployment is `ACTIVE`. Putting the flag change and this code in one
deployment would leave today's process, with execution and Sheets setup
still on, serving through the migration.

### Why all three migrations fit that job

Apply these in filename order. They are the only pending migrations this
PR adds. Do not edit them.

1. `20261102180000_client_sheets_person_admission`
2. `20261102190000_client_sheets_person_recovery`
3. `20261102200000_client_sheet_header_literal`

The first creates `DuplicateRiskAssessmentFailure`,
`ClientSheetsPersonAdmission`, and `ClientSheetsDedupeDecision`. The second
adds columns on that new failure table and creates
`ClientSheetsHistoryCoverage` and `ClientSheetsPersonRelease`. Deployed
master does not read or write those tables. The third replaces
`ClientSheetColumnMap_scope_chk` so a header cell may be length 0 through
200. It updates no map and no delivery job.

Master stores `headerSnapshot` from the worksheet read (`column-maps.ts` on
`73eac95d`). The writer that stored a blank header as U+200B is only on
unmerged PR #262. It is not on master, so this migration does not convert
U+200B cells. No separate repair is included. A later repair would have to
name verified rows and keep the snapshot, assignments, revision, binding,
and audit evidence together. A published map's header must not change
meaning, and a job `headerContract` is not edited to satisfy a check.

Empty strings were invalid under `client_onboarding_v2_string_array_ok`
(length 1–200). Rows that already pass that check still pass the relaxed
check. After this migration, a new map can store `""`. A header that is
already U+200B stays U+200B. The master process stores the Google text and
does not encode a blank as U+200B. It does not insert `""`.

The header file does not wrap its three statements in `BEGIN`/`COMMIT`.
`prisma migrate deploy` sends the file with `simple_query` and does not add
a transaction. Existing rows already satisfy the relaxed check, so the new
constraint does not depend on a data rewrite. If the job exits non-zero,
the deployment does not switch. Leave the failed migration failed. Do not
mark it applied and do not edit its checksum.

Confirm the header file on the release commit is the constraint-only file.
Its sha256 is `b146283733ccd027360889d38aab0989cb8e03a66b39eba1b0e52f886de4f6fe`.
That hash identifies the file. It is not a row to write into
`_prisma_migrations`. An earlier draft of this same filename rewrote every
U+200B cell to `""`. That draft must not be applied. Deployed master
`73eac95d` does not contain this file, so the normal pre-deploy job has not
applied it. This preflight did not open the production database and did not
read `_prisma_migrations`. Do not insert a row for this file.

The deployed execution-off drain does not settle stale `running` claims.
Settlement is in this build. Run it after the new API is up, with execution
off and dispatch on. The migrations do not need the running-job query to be
empty first.

### Controls, then one code deployment

Alex's destination was read during this preflight with
`GET /admin/v1/clients/alex_gross/google-sheets/dispatch`. No activation
request was sent. Preserve these values:

- `campaignDispatchEnabled`: false
- `campaignDispatchNotBefore`: `2026-10-27T14:43:39.233Z` (10:43 AM ET)
- `agedDispatchEnabled`: false
- `agedDispatchNotBefore`: null

That response listed 42 intents, all `completed`, and the latest lead job
`succeeded` with `finishedAt` `2026-11-02T14:24:02.924Z` (9:24 AM ET). The
live process also reported `dispatchFlagEnabled: true`, matching the spec.
This route is not a census of every `CompanySheetsDeliveryJob`. Rows for
other clients, and any running job the route does not return, were not
queried. The production database URL was not opened. Do not call dispatch
activation. Do not move the cutoff.

Then change env on the current spec and let that deployment finish while
`master` is still `73eac95d`. Wait until it is `ACTIVE` and `/health` still
reports that commit. There is one API instance. Component env overrides an
app-level key of the same name. The worker does not append, so a flag only
on the worker does not stop a sheet write.

On component `sa360-api`:

- `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED=false`. This stops
  `executeCompanySheetsDeliveryJob`, including
  `POST /admin/v1/company-sheets/delivery-jobs/:jobId/execute`. It does not
  stop Send Test Row, the captured-event test, the onboarding captured
  append, or header provisioning. Those either pass `controlledCampaignTest`
  / `controlledOnboardingCapturedTest` or never consult the execution flag.
- `SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED=false`. This stops
  `sendCompanySheetsCapturedEventTestRow` before a sheet write.

At app level, where `SA360_COMPANY_GOOGLE_SHEETS_ENABLED` is set today and
is not overridden on the API component:

- `SA360_COMPANY_GOOGLE_SHEETS_ENABLED=false`. This stops
  `sendCompanySheetsCampaignTestRow`,
  `sendCompanySheetsCapturedEventTestRow`,
  `enqueueOnboardingCapturedTestJob` (and therefore
  `appendOnboardingCapturedTestRow`), `bindCompanySheetsTab`, and
  `createMissingCompanySheetsTab`. The last two call
  `provisionBlankSheetHeader`, which appends a header on an empty sheet. A
  tab contract in `setupState = 'creating'` is that claim and stays in
  progress for 120 seconds. This flag does not stop
  `executeCompanySheetsDeliveryJob` and does not stop the drain.

Leave these as they are:

- `SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED=true` on both `sa360-api`
  and `sa360-worker`. The worker skips the POST when this is false. The API
  drain returns `dispatch_disabled` before settlement when this is false.
  Settlement with Sheets setup disabled was run locally: dispatch `true`,
  execution `false`, `SA360_COMPANY_GOOGLE_SHEETS_ENABLED=false`. An expired
  pre-append run became `retryable`, an expired run with `appendStartedAt`
  set became `uncertain` (`worker_lost`), a run inside the lease stayed
  `running`, and the drain did not call Google.
- `SA360_CLIENT_ONBOARDING_GOOGLE_ONLY_PILOT_ENABLED` stays absent. It is
  not in the app, API, or worker env. `appendOnboardingCapturedTestRow`
  requires that flag and the captured-test flag to both be the exact string
  `true`. Do not set the pilot flag.
- `SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED` stays `true`. It does
  not bypass the execution check.
- `SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED` stays `true`. Draft and
  publish do not append a sheet row.

The flag deployment's pre-deploy job runs `prisma migrate deploy` against
current master. Those three files are not on that commit, so the job must
log that nothing is pending. If it names one of the three files above, stop.
Master has moved and this sequence no longer matches it. After the flag
deployment is `ACTIVE`, the replaced process is gone.
A request that already passed its check on the previous process can append
until that process exits. Wait one execution lease, 380 seconds
(`COMPANY_SHEETS_EXECUTION_LEASE_MS`). The master drain will not clear a
`running` job while execution is off. Leave those rows. Do not turn
execution on.

Deploy this PR only after that. Keep the flags above. `sa360-migrate`
applies all three files, in the order listed, before the new API and worker
receive traffic. If migrate fails, the flag-off master deployment stays
active.

### Settlement and uncertainty

On the new API, still with execution off, Sheets setup off, and dispatch on,
let the worker post one drain, or post one
`POST /admin/v1/company-sheets/internal/process-dispatch` with an empty
JSON body. That is the drain. It is not activation and it does not execute.

The execution-off drain locks `company_sheets_dispatch_drain` and calls
`quarantineExpiredRuns`, then marks due intents `scheduled` without calling
`executeCompanySheetsDeliveryJob`:

- Expired `running` with `appendStartedAt` null becomes `retryable`, and
  the worksheet lock is released.
- Expired `running` with `appendStartedAt` set becomes `uncertain` with
  `uncertainReason` `worker_lost`. The lock stays.
- A run still inside the 380 second lease stays `running`. Wait, then drain
  again.
- The claim transaction timeout is 5 seconds. If the drain errors, read the
  running query and retry the drain. Do not turn execution on.

Then read:

```sql
SELECT id, kind, "startedAt", "appendStartedAt"
FROM "CompanySheetsDeliveryJob"
WHERE status = 'running';
```

```sql
SELECT id, role, "updatedAt"
FROM "CompanySheetsTabContract"
WHERE "setupState" = 'creating'
  AND "updatedAt" > now() - interval '120 seconds';
```

The running query should be empty after the lease and one successful drain.
The creating-tab query should be empty once Sheets setup has been off for
120 seconds. An `uncertain` job stays `uncertain`. Do not edit
`headerContract`. Do not release an uncertain append with the known-dead
route. That route returns `uncertain_append_held`.

Leave execution off. Turning it on is a separate decision. When it is later
turned on, `leadJobMayAppend` covers queued and retryable lead jobs and a
lead job whose claim is resumed. History and transient assessment gaps go
back to `queued` with no Google call. Other holds become conclusive pre-send
failures (`appendStartedAt` null, `rowsWritten` 0) and are not indexed. An
`uncertain` job returns `uncertain` before the claim. Do not mark an
uncertain append safe to retry.

### Paused post-deploy verification

- `/health` `commitSha` is the release commit, not `73eac95d`.
- The migrate log names `20261102180000_client_sheets_person_admission`,
  `20261102190000_client_sheets_person_recovery`, and
  `20261102200000_client_sheet_header_literal`.
- API execution is still `false`, Sheets setup is still `false`, captured
  test is still `false`, dispatch is still `true` on the API and the worker,
  and the google-only pilot key is still absent.
- Alex is unchanged: `campaignDispatchEnabled` false,
  `campaignDispatchNotBefore` `2026-10-27T14:43:39.233Z`,
  `agedDispatchEnabled` false, `agedDispatchNotBefore` null.
- A U+200B header cell is stored text. This count is not a defect count and
  it is not a sentinel count:

```sql
SELECT COUNT(*)
FROM "ClientSheetColumnMap"
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements("headerSnapshot") AS item
  WHERE item #>> '{}' = E'\u200b'
);
```

- Read `ClientSheetsHistoryCoverage` before any later execution. `indexedCount`
  is not completeness. Completeness is `status` plus `completenessProof`
  (`cursor_exhausted` or `no_eligible_jobs`).
- Count lead jobs in `queued`, `retryable`, or `running` with no
  `ClientSheetsPersonAdmission` for that event. Those jobs are not safe to
  execute on the previous build.

### Rollback

- Redeploy the previous API and worker commit only with execution still
  `false` and Sheets setup still `false`. `prisma migrate deploy` has no
  down migration. The three applied migrations stay. Master can keep serving
  beside the new tables, and it stores literal headers that still satisfy
  the relaxed check.
- Do not roll this app back while queued or retryable lead jobs exist unless
  execution stays off. The previous app would execute those jobs without the
  admission guard.
- The person tables are additive. Leaving them in place is compatible with
  the previous app. Dropping them while this app is running breaks the gate.
- Do not restore the old header check while any `headerSnapshot` contains
  `""`. The master app stores the Google text and rejects length 0. It does
  not encode a blank as U+200B.
- Leave a U+200B header cell as stored. It matches a Google cell with that
  same text. It is not rewritten to `""`.
- Do not turn execution on to clear a `running` or `uncertain` job.
- A point-in-time restore creates a new cluster. It is not an in-place undo
  of this deployment.

## Queue reconciliation

Before execution is turned on, an operator can call
`planPreMigrationLeadJobQuarantine` per client and read the list. That call
does not change jobs. With this build deployed and execution still off, the
list is informational. With execution on, the guard is what stops an
unadmitted lead job. Do not treat a job on that list as already quarantined.

History indexing does not create a duplicate of the same event
(`replay_allowed`). It does not treat a queued job, or a failed job that
never started an append, as a successful delivery.

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
