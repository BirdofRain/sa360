# Historical DOB correction readiness

This file pins the unapplied 1,015-row correction. It does not apply it.

## Pin

| Item | Value |
| --- | --- |
| Pull request | #267, branch `cursor/dob-historical-correction-156d` |
| Registry file | `apps/api/src/services/source-intake/source-field-alias.registry.ts` |
| Registry git blob | `f653c7f44add2a77e3248206e34382bc16e4f59b` |
| Birthday bindings | 49 mappings of `date` to `date_of_birth`. Two `date_copy` bindings are outside this correction |
| Manifest | `docs/validation/incoming-dob-correction-manifest.json` |
| Manifest SHA256 | `68c4e0881778231ddbb6d934bd52f63bd2f376f28e64fe42ce0fd21bc34f4ea9` |
| Window | `2026-10-26T04:00:00.000Z` through `2026-11-03T15:36:00.000Z` (October 26, 2026 12:00 AM through November 3, 2026 10:36 AM America/New_York) |
| `expectedCount` | 1015 |
| Id uniqueness | 1,015 ids, 1,015 distinct, no empty ids |

The manifest `ids` and `expectedCount` are the only apply scope. The gap assessment below is not part of that scope.

## What apply writes

One transaction per batch of 25 can change only:

- `SourceLeadEvent.normalizedPayloadJson`, and only blank canonical fields: `lead_details.date_of_birth`, `date_of_birth_provenance`, `consumer_age`, `consumer_age_provenance`, `consumer_age_reference_date`, `consumer_age_reference_rule`, and `consumer_age_conflict` when that flag is null. `routing.source_intake.sourceAttributes.date_of_birth` is copied only when the canonical DOB was blank, that object already exists, and that attribute is blank.
- `SourceLeadEvent.updatedAt`, because Prisma `@updatedAt` moves. `receivedAt`, `normalizedAt`, `createdAt`, and `deliveredAt` are checked and the transaction throws if they move.
- One inserted `IncomingDobCorrectionAudit` row in that same transaction.

`historical_catalog_projection_event_refresh` runs after an update of `normalizedPayloadJson`. It looks up a `LeadInventoryItem` by `sourceLeadEventId` and, when one exists, deletes and reinserts that item's `historical_catalog_projection` row from `historical_catalog_projection_source`. The view has no DOB, age, availability, or eligibility column. Its label fields come from `sourceCampaignName`, `normalizedPayloadJson.campaign_name`, and raw `master.lead_type`. This correction fills none of those. The refresh does not change `LeadInventoryItem`, orders, allocations, or delivery history.

The command does not enqueue, replay, change routing, append a spreadsheet, call GHL, or update delivery flags. It does not write `CompanySheetsDeliveryJob`, `CompanySheetsDeliveryRow.valuesJson`, `GhlAssociationDispatchOutbox`, `LeadAllocation`, `ClientSheetsPersonAdmission`, `BuyerDeliveredIdentity`, `rawPayloadJson`, `status`, `routingResultJson`, or `deliveryResultJson`.

## Pending readers

A Sheets append sends `CompanySheetsDeliveryRow.valuesJson`, the snapshot taken when the job was created. It does not re-read the lead. This correction does not update that snapshot, so it does not repair a cell already queued or written, and it does not start an append.

`deliverOutboxRow` does re-read `SourceLeadEvent.normalizedPayloadJson` when it executes a GHL association outbox row. A pending or executing outbox row could therefore send the corrected DOB on its first call. The correction command does not create or drain that outbox. The manifest-scoped census below is the joined count. Settled rows are not executed again by this command.

A later first Sheets enqueue, one that has not snapshotted a row yet, would read the corrected payload. This command does not create that job.

## Delivery evidence

Read-only census from the running `sa360-api` container, database time `2026-11-04T01:14:28.935Z` (November 3, 2026 8:14 PM America/New_York). The container was serving master `f04906e`. The one-off process used that container's existing database connection and did not deploy this branch, start a worker, or run `--apply`. `IncomingDobCorrectionAudit` had 0 rows after the read.

All 1,015 manifest events were present. `deliveredAt` was empty on every row, and `deliveryResultJson.externalCallExecuted` was not true on any row. `heldDeliveredIds` remains empty. That is not the delivery census.

| Evidence | Rows | Events |
| --- | --- | --- |
| Sheets jobs, status `succeeded`, `rowsWritten` > 0 | 43 | 43 |
| Sheets row snapshots, status `written` | 43 | 43 |
| Sheets jobs with `appendStartedAt` set | 0 | 0 |
| Sheets dispatch intents, status `completed`, each with a job | 42 | 42 |
| Sheets intents that are not `completed` | 0 | 0 |
| GHL outbox `settled` and `externalCallExecuted` true | 42 | 42 |
| GHL outbox `settled` and `externalCallExecuted` false | 6 | 6 |
| GHL outbox `pending`, `executing`, or `uncertain`, manifest and global | 0 | 0 |
| Lead allocations | 0 | 0 |
| `ClientSheetsPersonAdmission`, status `admitted`, origin `delivery_index` | 84 | 42 |
| `BuyerDeliveredIdentity` | 0 | 0 |
| Events with a succeeded sheet, an executed GHL call, or a person admission |  | 48 |
| Events with none of those and no settled-unexecuted GHL row |  | 961 |

The 43 succeeded jobs are prior Sheets delivery. Their `CompanySheetsDeliveryRow.valuesJson` snapshots are already written. This correction does not update those snapshots and does not enqueue a job, so it does not cause another Sheets append. No non-completed dispatch intent is waiting to snapshot the corrected payload.

The 42 executed GHL rows are prior delivery. Settled rows are not executed again. The 6 settled rows with `externalCallExecuted` false are closed without a GHL call. They are not an open send. Open outbox rows, the only rows that re-read `normalizedPayloadJson` at execution, were 0 at 8:14 PM. Recheck pending and executing rows immediately before any later apply. This zero is a point-in-time observation.

The 48 events with prior channel evidence are still eligible for the canonical fill. Apply records `alreadyDelivered` on the audit row. It does not resend and it does not rewrite a destination snapshot. A later first Sheets job or a later new GHL outbox row, created by something other than this command, would read the corrected payload. No such row is open now.

## Four stored ages

All four manifest rows that already have `consumer_age` still plan as `fill_blank_canonical`. The stored age equals the age derived with `submitted_at_utc_date_else_received_at_utc_date` from the raw `submitted_at` when that timestamp is valid, otherwise the stored `receivedAt`. None of the four has a stored `consumer_age_reference_date`, reference rule, provenance, or conflict flag, so there is no stored reference to disagree with. No disagreement was found.

`fillBlankCanonical` leaves a nonblank age in place. A conflicting stored age is `stored_age_differs`, the plan action is skip, and the command refuses the whole manifest before any write. On these four, the blank reference, provenance, and conflict flag would be filled because they are null. The age value would stay.

| Event | Binding |
| --- | --- |
| `cmvpc8bcj008fi70u7h9twl02` | Logan Carlisle |
| `cmvq2m47h01cknt0vtunx1a84` | Dom Scalice |
| `cmvrc4gtf00evkh0vntg146bs` | Marcus Turo |
| `cmvsns5w200mylj0vk66jiya9` | Reid Mazzuco |

## Recheck, audit, and partial apply

Before any transaction, the command reloads the manifest ids. A missing id, or any plan other than `apply` or `already_canonical`, returns `reviewed_scope_mismatch` and writes nothing in that invocation. Rows that plan as `already_canonical` are already satisfied. They are printed as skips and are not rewritten. The command then passes the fresh canonical before-image of the remaining `apply` rows into the lock.

Inside each batch transaction the audit schema is checked again, the row is locked with `FOR UPDATE SKIP LOCKED`, and a canonical image that differs from that before-image is skipped as `changed_under_lock`. A row that is no longer eligible is skipped with its plan reason. An id that was not in the manifest is never added. A lock skip stays in `pendingIds` and the process exits 3.

Committed rows are the `IncomingDobCorrectionAudit` rows with `action = apply`, inserted in the same transaction as the payload update. `writtenIds` in the process JSON repeats that committed set. Skipped rows, including `changed_under_lock`, are recorded only in that process JSON. They are not audit rows. Siblings in the same batch still commit, so one batch can be a partial result. A thrown timestamp or schema check rolls back only that batch. Earlier batches stay committed. The process then exits 1 with `outcome` `FAILED`. The optional JSONL file is written after commit and is not the source of rollback or resume.

Safe resume is the same manifest command. Satisfied rows plan as `already_canonical` and are left alone. Rows that still plan as `apply`, including a prior `changed_under_lock` or `pendingIds` row, are attempted again. If any remaining row is missing or plans as anything else, including a conflict, that invocation writes nothing. Earlier commits stay. Continuing past that one row requires a new reviewed manifest of only the still-eligible unwritten ids, with `expectedCount` equal to that shorter list. Do not edit the pinned 1,015-id file and do not add the gap ids.

There is no correction-run column. The durable committed set is the open apply audit rows for these event ids.

A raw-date change that keeps the canonical before-image blank and the row eligible can still be written as the recomputed proposal. That race is limited to a concurrent raw edit during the command. The before-image pin is the canonical fields, not the raw date.

## Rollback selection

`readDobCorrectionAuditsFromDb` reads every `IncomingDobCorrectionAudit` row `ORDER BY "createdAt" ASC, id ASC`. `selectDobCorrectionRollbackTargets` walks that list. An `apply` stores the latest row for its `eventId`. A later `rollback` removes it. The result is the latest unrolled apply per event. The audit table has no manifest id, operator-run id, or correction-run id, so this walk is not by itself scoped to one run.

Without `--manifest` or `--id`, rollback then keeps the first `limit` targets from that list. A shorter limit silently omits the rest. That is the unscoped command.

With the manifest, the command keeps only targets whose `eventId` is in that id list. `--limit` must be at least `expectedCount`. A shorter limit returns `reviewed_count_mismatch` and writes nothing. A named id with no open apply is skipped as `no_open_audit` and is not restored. An event outside the manifest is not selected, even when it has an open apply.

The after-image guard is unchanged. Rollback restores a row only when the current canonical image still equals the audited after-image. A later edit is `rollback_mismatch` and is left in place. `manifest rollback leaves other runs in place and keeps the after-image guard` covers the manifest filter, the short-limit refusal, and that skip.

## Deployed audit schema

`incomingDobCorrectionAuditSchemaStatus` returned `ready`. It ran inside the existing `sa360-api` container against the production database, as a read-only session, using the function body from `9c88b5154bd3843b8d909e5af69eed1501cdf6a7`. That container was still serving master `f04906e`. No worker was started and `--apply` was not used. The same function checks the relation, the 12 documented columns and types, `NOT NULL`, the primary key, an index whose definition contains `"eventId"` and `"createdAt"`, and a check constraint containing `'apply'` and `'rollback'`.

## Catalog projection

901 manifest events have one linked `LeadInventoryItem` each. All 901 are `pending_review`. None match `historical_catalog_projection_source`, which only includes `csv_import` or `manual_import` events or a `manual_import` inventory item. `historical_catalog_projection` has 0 rows for these items. `LeadEligibilityAssessment` has 0 rows for these events. Lead allocations are 0.

A DOB or age fill therefore does not change projected age, availability, or eligibility. The trigger still runs for the 901 linked items. Its refresh deletes any existing projection row and inserts only a view row. There is nothing to delete and nothing to insert. Item status, orders, allocations, and delivery history stay as they are. The other 114 manifest events have no inventory item, so the trigger finds nothing to refresh.

## Uncovered interval

Separate read, completed November 3, 2026 7:24 PM America/New_York. Interval: after `2026-11-03T15:36:00.000Z` through each binding's deploy-active time. Pagination of the list crossed that start on one page, 111 LeadCapture details. None of these ids are in the 1,015-row manifest.

Deploy-active times are the API deploy step end:

- Julia Dodge, `2026-11-03T15:00:08.363Z` (10:00 AM America/New_York), before the historical window ended, so this interval has no Julia gap.
- Eriks Veidemanis, `2026-11-03T17:42:27.523Z` (12:42 PM).
- Alex Gross, Jean Perez, Alex Feuerstein, Andru Duranso, `2026-11-03T20:52:29.927Z` (3:52 PM).
- The eight #274 pages, `2026-11-03T23:02:38.122Z` (6:02 PM).
- The #275 catalog, including `date_copy`, `2026-11-03T23:29:50.235Z` (6:29 PM).

27 rows are eligible `date` recoveries before their own deploy: Andrew Walters 1, Caleb Farina 1, Daniel Gvili 5, Dom Scalice 4, Jacob Zapata 3, James Laird 1, Logan Carlisle 1, Louie Mezzone 1, Michael Coulter 1, Rob Arden 4, Tori Haskell 3 (`routing_unmatched`), Vernon Baker 2. Recoverable DOB 27 and recoverable age 27. Conflicts 0. Invalid 0. They are not added to the manifest.

`date_copy` is separate. Chandler Conrad and Zach Busch account for 14 rows in the interval, all with a raw `date_copy`, all missing canonical DOB and age, all `routing_matched`, none in the manifest. The current writer reads the raw key `date` only, so these 14 would not be corrected by the 1,015-row command.

Events after a binding was already active are live intake. In this read that includes 2 Eriks rows and 1 Rob Arden row already canonical, and 1 learn-nick-agents row already canonical and `routing_unmatched`.

## Commands

The schema check has returned `ready`. Do not run apply until this correction is separately authorized, and recheck open GHL outbox rows first. `DATABASE_URL` stays in the environment. It is not an argument.

```sh
pnpm source-intake:dob-correction -- \
  --apply \
  --expected-db-host sa360-postgres-do-user-1494645-0.k.db.ondigitalocean.com:25060 \
  --operator <name> \
  --manifest docs/validation/incoming-dob-correction-manifest.json \
  --limit 1015 \
  --confirm "APPLY CONFIRMED CAMPAIGN DOB CORRECTION"
```

```sh
pnpm source-intake:dob-correction -- \
  --rollback \
  --expected-db-host sa360-postgres-do-user-1494645-0.k.db.ondigitalocean.com:25060 \
  --operator <name> \
  --manifest docs/validation/incoming-dob-correction-manifest.json \
  --limit 1015 \
  --confirm "ROLLBACK CONFIRMED CAMPAIGN DOB CORRECTION"
```

The rollback command without `--manifest` is not the command for this run. It selects every open apply, then the first `limit` rows.

Expected field counts if every manifest row is still eligible at apply time: 1,015 `date_of_birth` fills, 1,011 new `consumer_age` fills, 4 existing `consumer_age` values preserved, 0 conflicting rows, 0 invalid rows, one audit row per written event, 0 destination writes. 48 of the 1,015 already have sheet, GHL, or person-admission evidence. Those rows are still canonical fills. They are not new deliveries.

## Blocker

The schema check returned `ready`. No production correction was applied. `IncomingDobCorrectionAudit` had 0 rows at 8:14 PM America/New_York.

Before any later apply, read pending and executing `GhlAssociationDispatchOutbox` rows again. The zero count above is only the 8:14 PM observation. An open row would send the corrected payload on its first execution. This command does not create or drain that row.

The 27 gap rows and 14 `date_copy` rows stay outside this manifest.
