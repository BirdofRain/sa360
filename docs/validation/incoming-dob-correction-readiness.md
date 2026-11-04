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

`historical_catalog_projection_event_refresh` runs after an update of `normalizedPayloadJson`. It refreshes `historical_catalog_projection` when a `LeadInventoryItem` already points at the event. That function does not insert a job, call GHL, or append a sheet.

The command does not enqueue, replay, change routing, append a spreadsheet, call GHL, or update delivery flags. It does not write `CompanySheetsDeliveryJob`, `CompanySheetsDeliveryRow.valuesJson`, `GhlAssociationDispatchOutbox`, `LeadAllocation`, `ClientSheetsPersonAdmission`, `BuyerDeliveredIdentity`, `rawPayloadJson`, `status`, `routingResultJson`, or `deliveryResultJson`.

## Pending readers

A Sheets append sends `CompanySheetsDeliveryRow.valuesJson`, the snapshot taken when the job was created. It does not re-read the lead. This correction does not update that snapshot, so it does not repair a cell already queued or written, and it does not start an append.

`deliverOutboxRow` does re-read `SourceLeadEvent.normalizedPayloadJson` when it executes a GHL association outbox row. A pending or executing outbox row could therefore send the corrected DOB on its first call. The correction command does not create or drain that outbox. At November 3, 2026 7:24 PM America/New_York, `GET /admin/v1/ghl/association-dispatch` reported pending 0, executing 0, uncertain 0, and failed 0. Settled rows were 158 globally. Those settled rows were not joined to the 1,015 ids, and settled rows are not executed again by this command.

A later first Sheets enqueue, one that has not snapshotted a row yet, would read the corrected payload. This command does not create that job.

## Delivery evidence

Re-read of all 1,015 manifest events at 7:24 PM America/New_York: `deliveredAt` was empty on every row, and `deliveryResultJson.externalCallExecuted` was not true on any row. `heldDeliveredIds` remains empty. That is not proof these leads were never delivered.

Sheets jobs, sheet-row snapshots, lead allocations, person admissions, and buyer delivery identities were not readable. The production database host did not accept a connection from this environment, and the admin API has no job list. Previously delivered rows must not be treated as undelivered. Apply still fills blank canonical fields on a row the writer marks `alreadyDelivered`. It records that flag on the audit row. It does not resend and it does not rewrite a destination snapshot.

## Four stored ages

All four manifest rows that already have `consumer_age` still plan as `fill_blank_canonical`. The stored age equals the age derived with `submitted_at_utc_date_else_received_at_utc_date` from the raw `submitted_at` when that timestamp is valid, otherwise the stored `receivedAt`. None of the four has a stored `consumer_age_reference_date`, reference rule, provenance, or conflict flag, so there is no stored reference to disagree with. No disagreement was found.

`fillBlankCanonical` leaves a nonblank age in place. A conflicting stored age is `stored_age_differs`, the plan action is skip, and the command refuses the whole manifest before any write. On these four, the blank reference, provenance, and conflict flag would be filled because they are null. The age value would stay.

| Event | Binding |
| --- | --- |
| `cmvpc8bcj008fi70u7h9twl02` | Logan Carlisle |
| `cmvq2m47h01cknt0vtunx1a84` | Dom Scalice |
| `cmvrc4gtf00evkh0vntg146bs` | Marcus Turo |
| `cmvsns5w200mylj0vk66jiya9` | Reid Mazzuco |

## Recheck, audit, rollback

Before any transaction, the command reloads the manifest ids. If any id is missing or no longer plans as `apply`, it returns `reviewed_scope_mismatch` and writes nothing. It then passes that canonical before-image into the lock. Inside the transaction the audit schema is checked again, the row is locked with `FOR UPDATE SKIP LOCKED`, and a canonical image that differs from the reviewed before-image is skipped as `changed_under_lock`. A row that is no longer eligible is skipped with its plan reason. An id that was not in the manifest is never added. A lock skip stays in `pendingIds` and the process exits 3.

The payload update and the audit insert commit together. A thrown timestamp check rolls both back. The optional JSONL file is written after commit and is not the source of rollback.

Rollback restores a row only when the current canonical image still equals the audited after-image. A later edit is `rollback_mismatch` and is left in place. The local test `apply fills only blank canonical fields, is idempotent, and rolls back` covers that skip.

A raw-date change that keeps the canonical before-image blank and the row eligible can still be written as the recomputed proposal. That race is limited to a concurrent raw edit during the command. The before-image pin is the canonical fields, not the raw date.

## Deployed audit schema

`incomingDobCorrectionAuditSchemaStatus` was not executed against production. The connection to `sa360-postgres-do-user-1494645-0.k.db.ondigitalocean.com:25060` failed before any query. No session was opened and nothing was written. The #275 migration log is not this check. Apply and rollback call the same function first and refuse with `audit_relation_required` or `audit_relation_incompatible` when the columns, primary key, `eventId`/`createdAt` index, or `apply`/`rollback` check do not match. That gate has not yet returned `ready` from the deployed database.

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

Do not run the apply command until the schema check has returned `ready` on the deployed database. `DATABASE_URL` stays in the environment. It is not an argument.

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
  --limit 1015 \
  --confirm "ROLLBACK CONFIRMED CAMPAIGN DOB CORRECTION"
```

Expected field counts if every manifest row is still eligible at apply time: 1,015 `date_of_birth` fills, 1,011 new `consumer_age` fills, 4 existing `consumer_age` values preserved, 0 conflicting rows, 0 invalid rows, one audit row per written event, 0 destination writes.

## Blocker

The deployed audit schema has not been read. Everything else required for this pinned scope is reviewed. The 27 gap rows and 14 `date_copy` rows stay outside this manifest.
