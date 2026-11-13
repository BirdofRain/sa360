# Historical Vet catalog read-model review

**Status:** READY FOR PRODUCTION CHANGE APPROVAL of the gated Option B sequence. Execution is still NO-GO. Option A is rejected.

This document is a local schema review. It does not apply a migration, change the catalog query, raise the 20-second statement timeout, enable `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED`, or write to production. PR #188 stays on HOLD. PR #192 stays reverted.

The catalog that timed out in production is the lot-scoped query shipped by PR #196 (`02241825e9f3f376a26730742f66c247360ac774`). Production cancelled it at 20,362 ms with SQLSTATE `57014` (`statement_timeout`) during the `catalog` operation at `2026-10-20T17:31:12.209Z`. This review did not run that production query again.

## Recommendation

Use a separate historical-catalog projection (Option B). Keep `SourceLeadEvent` unchanged.

The projection stores one narrow row per historical inventory item and serves only the catalog aggregate. `historical_campaign_ownership_decision` stays a live read of `HistoricalCampaignAlias` for the page being returned (at most 50 rows). LO-1053 reservation counts stay a live read of `LeadAllocation`. Fulfillment, sellability, reservation, and buyer eligibility continue to read `LeadInventoryItem` and `LeadAllocation` only.

Option A, stored generated columns plus a covering index on `SourceLeadEvent`, is the higher-risk change. On the local fixture it rewrote the intake table under `ACCESS EXCLUSIVE`, and a concurrent insert waiting with `lock_timeout = 1500ms` was cancelled. After event updates dirtied the visibility map, the index-only plan heap-fetched the fat rows again and the runtime returned to the current query.

## What was measured

Disposable database: `sa360_catalog_bench` on local PostgreSQL 16.15 (`127.0.0.1`). Settings: `shared_buffers = 128MB`, `work_mem = 4MB`, `random_page_cost = 4`. No production connection was opened.

Fixture, all on lot `bench-lot-key`:

| Shape | Count |
| --- | ---: |
| Historical inventory rows | 200,000 |
| Rows with an incompressible ~16 KB `normalizedPayloadJson` | 10,000 |
| Probe row, stored vs detoasted | 16,590 vs 16,761 bytes (`benchevt0000020`) |
| July labels of 4,000 characters | every 800th row (`n % 800 = 3`) |
| Missing July labels | 4,000 |
| Conflicting workbook or raw labels | 1,736 |
| Campaign groups | 1,179 |
| Unlabeled groups (one per import request) | 3 |
| Available / reserved / origin-stamped rows | 7,000 / 5,000 / 4,000 |
| Other-lot historical row excluded by the lot predicate | 1 |
| Live row on the same lot excluded by the historical predicate | 1 |

Import identity is the catalog expression, not `LeadInventoryItem.metadataJson`: `importRequestId`, then `bulkImportId`, then `(none)`. Aged-bulk commits leave `SourceLeadEvent.bulkImportId` null and carry `importRequestId` inside `rawPayloadJson`.

Plans were taken with `enable_seqscan = off` and `max_parallel_workers_per_gather = 0` so the planner used the lot unique index, the `(inventoryLotId, status)` item index, and the event primary key or covering index. That is the plan shape PR #196 uses when the selected lot is a subset of inventory. Those settings were session-local. They are not proposed as database defaults.

"Cold" in the table below means the scanned index reported `shared read` rather than `shared hit` at the start of the plan, so `shared_buffers` did not already hold those pages. It does not prove the operating-system page cache was empty. On this SSD the warm and cold times are close. The production margin is the number of pages, not the local millisecond time. Local times must not be quoted as production times. The production cancel was 20.4 seconds; the same current query on this fixture was about 2 seconds.

## Current catalog

`buildHistoricalCampaignCatalogQuery` materializes every historical item in the lot, extracts the July column and two JSON labels, normalizes and classifies them, then aggregates. Scope totals rescan that set. The page calls `historical_campaign_ownership_decision` only after `LIMIT`/`OFFSET`. The ownership function is not the 20-second cost.

| Plan | Time | Event pages read from the OS | Heap fetches |
| --- | ---: | ---: | ---: |
| Packed heap, warm | 1,441 ms | 20,491 (~160 MB) | primary-key heap fetch per row |
| Packed heap, cold shared buffers | 1,591 ms | 20,491 (~160 MB) | primary-key heap fetch per row |
| Fragmented heap, cold shared buffers | 2,030 ms | 40,023 (~313 MB) | primary-key heap fetch per row |

Fragmentation was half the events receiving a long `errorSummary`, which dropped the primary-key correlation and doubled the event pages read. Ten thousand toasted payloads are included. The nested-loop buffer counts elsewhere in those plans are loop-multiplied; the page counts above are the event index or heap scan's own `shared read` figure.

## Option A — generated columns and a covering index

`ALTER TABLE "SourceLeadEvent" ADD COLUMN ... GENERATED ALWAYS AS (...) STORED` for the trimmed July label, import request, workbook label, and raw label:

- Rewrite time: **4,794 ms**.
- Lock: the rewrite requested `AccessExclusiveLock`. A concurrent `INSERT` into `SourceLeadEvent` with `lock_timeout = 1500ms` failed with `canceling statement due to lock timeout`.
- The lock snapshot showed that exclusive request still waiting behind an existing `ShareUpdateExclusiveLock`. Intake is blocked for the whole rewrite, not for a metadata update.
- A covering index on `SourceLeadEvent (id) INCLUDE (...)` can produce an index-only scan. An expression index on the JSON extracts did not, in the earlier local plans: PostgreSQL 16 still visited the heap.

| Visibility | Time | Event index `shared read` | Heap fetches |
| --- | ---: | ---: | ---: |
| Clean visibility map, warm | 1,052 ms | fits in cache | 0 |
| Clean visibility map, cold shared buffers | 1,088 ms | 2,113 (~16 MB) | 0 |
| 25% of event rows touched, warm | 1,246 ms | dirty pages | 194,214 |
| Every event row touched, warm | 1,351 ms | dirty pages | 309,497 |
| Every event row touched, cold shared buffers | 1,775 ms | 37,211 (~291 MB) | 200,001 |

Visibility is per page. Touching a quarter of the event rows cleared all-visible on enough pages that the "index-only" scan heap-fetched essentially every catalog row. Item status updates do not dirty `SourceLeadEvent` pages. Event updates do: recovery, consumer-age rewrites, and payload corrections. Those are existing intake and maintenance paths. After they run, Option A reads the fat heap, including toasted JSON, which is the cost that cancelled the production query.

`CREATE INDEX` takes `SHARE` and blocks writes. `CREATE INDEX CONCURRENTLY` cannot run inside the transaction Prisma wraps around a migration. Putting Option A in `prisma/migrations` would make the next `sa360-migrate` predeploy job rewrite `SourceLeadEvent` on production merely because that PR merged.

The current event relation on the fixture, after the rewrite, toasted payloads, and later updates, is **533 MB** (heap 283 MB, indexes 72 MB, toast and free space 178 MB). A stored-generated rewrite copies the heap and toast. This review does not have a retained WAL LSN bracket for that `ALTER` alone, so it does not quote a WAL byte count for Option A. The rewrite is not a metadata-only change.

## Option B — projection

The benchmark projection was one row per historical item, with a lot-key index that included the aggregate columns. Build, measured before the visibility experiment:

| Step | Result |
| --- | --- |
| `CREATE TABLE` | 10 ms |
| `INSERT` of 200,043 historical rows | 2,024 ms |
| Lot-key covering index | 166 ms, 27 MB |
| Relation total at that point | 68 MB |
| WAL recorded for that build | 80 MB |
| Concurrent `SourceLeadEvent` insert during the insert | committed (`INSERT 0 1`) |

The backfill took `ACCESS SHARE` on the source tables. It did not take `ACCESS EXCLUSIVE` on `SourceLeadEvent`. The projection count is 200,043 rows: 200,000 on the benchmark lot, 1 other historical lot row, and 42 historical rows already present in the local template. The live row on the benchmark lot is absent.

| Visibility | Time | Projection `shared read` | Heap fetches |
| --- | ---: | ---: | ---: |
| Clean visibility map, warm | 282 ms | 3,441 (~27 MB) | 0 |
| Clean visibility map, cold shared buffers | 297 ms | 3,442 (~27 MB) | 0 |
| 25% of projection rows updated, warm | 328 ms | dirty pages | 250,179 |
| That same 25% update, cold shared buffers | 367 ms | 9,078 (~71 MB) | 200,000 |

The 25% update (50,178 rows) was enough to make the cold plan heap-fetch every indexed row, because those rows share pages. The heap it fetched is the narrow projection. Dirty Option B stayed at 367 ms and about 71 MB. Dirty Option A returned to 1,775 ms and about 291 MB of event pages.

The projection aggregate sorts, because the catalog's exact output uses `COUNT(DISTINCT origin_id)` and `array_agg(DISTINCT origin_id ORDER BY origin_id)`. That sort spilled about 17 MB of temp files and is included in the times above. Removing the ordered distinct aggregate would change the response. The plan stays a single lot-key index scan plus that sort. It does not nest back into `SourceLeadEvent`.

The proposed index omits the workbook and raw label text. Agreement is stored instead, which is all the catalog aggregate reads. Replayed on the same fixture, inside a transaction that was rolled back, the narrower relation was heap **27 MB**, lot index **22 MB**, total **59 MB**. The benchmark index was wider than the index this review proposes.

### How the 20-second ceiling moves

A disk that made the fragmented current plan take about ten times longer than this SSD would put today's query at the observed 20-second cancel. The same multiplier applied to Option B's dirty scan (about 71 MB and 100 ms of the 367 ms) leaves the scan at roughly a second, plus the in-memory sort of 200,000 narrow rows. That sort is CPU, and it was about a quarter of a second here. This is a bound, not a production measurement. It is the reason Option B has a margin and Option A does not: Option A's dirty plan reads the fat event heap again, so the multiplier applies to the same pages that already missed the timeout.

The census on 2026-10-19 counted 250,417 historical rows across all lots. The Vet lot's exact row count was not re-measured. The fixture is the same order of magnitude as the whole historical population, loaded into one lot, with oversized labels and toasted payloads.

## Parity with the current catalog

Group rows compared by SQL `EXCEPT`, including display label, inventory counts, available and reserved counts, consistent and conflicting attribution, origin stamps, the first eight origin ids, whitespace variants, and niche:

| Comparison | Mismatched groups |
| --- | ---: |
| Current query vs Option A, at measurement time | 0 |
| Current query vs benchmark Option B, at measurement time | 0 |
| Proposed SQL vs a fresh execution of the current grouping, replayed later | 0 |

Page 2 (`LIMIT 25 OFFSET 25`) mismatched **0** rows. Ownership decisions on the first page mismatched **0**. One confirmed lot alias for `Label 0001` resolved to `eligible_lot_only`. The other 23 campaigns on that page resolved to `no_coverage`. Scope totals stayed **200,000** inventory rows, **4,000** missing July labels, and **1,736** conflicting labels. The label search `Label 0001` matched **3** campaigns while the scope sum stayed **200,000**, which is the current rule: the label filter limits the campaign list, not the scope counts.

The proposed chunk procedure, triggers, and narrower index were then created on the disposable database and rolled back. The chunk locked 200,048 inventory rows and upserted 200,043 historical projection rows. `ready` remained `false`. An item status update to `withdrawn` appeared on that item's projection row. A July-label update to `Relabeled Campaign` became `normalized_label = 'Relabeled Campaign'` and `july_column_conflicts`, because the workbook and raw labels were left unchanged. Renaming the other lot's `lotKey` updated the projection row for that lot's item. The live benchmark event was not present in the projection.

## Consistency without taking fulfillment authority

Grain: one projection row per historical `LeadInventoryItem`. `sourceLeadEventId` is unique, so an event update refreshes at most one item.

Maintained columns are the ones the catalog groups on:

- item: `status`, `nicheKey`, `originClientAccountId`, `inventoryLotId`, `sourceProvider`, `sourceLeadEventId`
- event: `sourceCampaignName`, `rawPayloadJson`, `normalizedPayloadJson`, `bulkImportId`, `sourceSystem`, `sourceProvider`
- lot: `lotKey`

Inserts and deletes of an item refresh that item. A non-historical item is removed from the projection. Other item writes (fingerprints, commerce exclusion, cost fields, `availableAt`) do not fire the trigger. Registry changes do not write the projection; the page still calls `historical_campaign_ownership_decision`. Allocation changes do not write the projection; LO-1053 counts still come from `LeadAllocation`.

A lot-key rename is a set-based update of the projection rows in that lot. It is rare and must not be folded into a catalog request.

Measured trigger cost on this fixture, with the generated columns already present: 100 item status updates took 16 ms before the trigger and 20 ms after it. Two hundred live event inserts with no inventory item took 13 ms before and 9 ms after. The following status check matched 100 of 100 updated rows. That is the intake overhead to budget: about 0.04 ms per status change on this machine, and no added work for an event that has no inventory row.

Drift can occur if a session sets `session_replication_role = replica` or disables the triggers. The backfill procedure below is the repair. That drift changes catalog accuracy only. It cannot change who may be sold a lead, because fulfillment does not read the projection.

Each backfill chunk runs in its own `READ COMMITTED` transaction, takes `FOR UPDATE` on the item ids in the range, deletes projection rows in the range that are no longer historical, and upserts the rest. A status change that arrives during the chunk waits on the row lock, then the trigger writes the committed status after the chunk commits. A new item inserted during the chunk is maintained by the trigger and is not overwritten by the chunk's older snapshot. The chunk sets `statement_timeout` to `20s`. It does not raise the database timeout. The local full load of this fixture fit in one chunk (2.0 seconds). Production chunks should still be bounded, on the order of 50,000 items, so a slow chunk fails at the existing 20-second limit.

## Deployment gates

`sa360-migrate` is a `PRE_DEPLOY` job. Its command is `pnpm migrate:deploy`, which runs `prisma migrate deploy` for every file under `prisma/migrations` before traffic switches. A failing migration fails the deploy. Merging a migration is execution.

This pull request contains no file under `prisma/migrations` and does not change `schema.prisma`. Merging it leaves production on the PR #196 query. The proposed statements live in:

- `docs/operations/sql/historical-catalog-projection.schema.proposed.sql`
- `docs/operations/sql/historical-catalog-projection.backfill.proposed.sql`

| Gate | Who runs it | What production does |
| --- | --- | --- |
| 0. This review | merge only if the review is accepted | No database change. Catalog SQL unchanged. Flag stays off. |
| 1. Production change approval | a separate explicit approval | Still nothing, until the following PRs are merged on purpose. |
| 2. Schema migration | a later PR whose only DDL is the schema statement, plus a matching Prisma model | `sa360-migrate` creates an empty table, the control row with `ready = false`, and the triggers. `SET LOCAL lock_timeout = '3s'` aborts the deploy if the trigger lock cannot be granted. There is no backfill and no `SourceLeadEvent` rewrite. |
| 3. Backfill | operator script, not a migration | Chunks outside `prisma migrate deploy`. Triggers stay enabled. `ready` stays false. |
| 4. Index | `CREATE INDEX CONCURRENTLY` in the operator script | Builds the lot index without holding a long lock on `SourceLeadEvent`. `CONCURRENTLY` is illegal inside a Prisma migration transaction, so it stays out of gate 2. |
| 5. Catalog code | a later PR with no migration | The catalog reads the projection only when the control row exists and `ready = true`. Otherwise it keeps the current SQL. A missing table is the current SQL, not a 500. |
| 6. Ready | one approved `UPDATE` of the control row | Issued only after the projection count equals the sum of the historical counts recorded by the chunks. Do not verify by repeating the production Vet catalog scan. |
| 7. Operator retest | a separate flag approval | `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED` stays off until that approval. This review does not enable it. |

Gate 2 does take a brief `ACCESS EXCLUSIVE` lock to create triggers on `LeadInventoryItem`, `SourceLeadEvent`, and `InventoryLot`. In PostgreSQL that request also queues new reads and writes behind it. The 3-second lock timeout bounds that stall and rolls the migration back if the lock is not granted. That is a different event from Option A's rewrite, which held the exclusive lock for the whole table copy and cancelled an insert at 1.5 seconds.

Adding the Prisma model belongs in the gate 2 PR, together with the migration. Adding the model in this PR would make `schema.prisma` diverge from the migrations. Leaving the table unmodeled until that PR avoids a later generated `DROP TABLE`.

## Rollback and forward recovery

Before gate 6, `ready` is false and the catalog SQL is the current query. Rollback of an unused projection is `ready = false` (already the case), drop the three triggers, then drop the two tables. Dropping a trigger takes a brief `ACCESS EXCLUSIVE` lock; use the same 3-second lock timeout.

After gate 6, rollback of the read path is setting `ready = false` or deploying the previous catalog SQL. The projection can be dropped later. Fulfillment does not need to be restored, because it never consulted the projection.

Forward recovery of a partial or drifted projection is to run the chunk procedure again with triggers left enabled, then set `ready` only after the counts match. Do not point the catalog at a partial backfill. DigitalOcean point-in-time recovery creates a new cluster; it is not the rollback for this read model.

## Code that a later approved PR would change

`buildHistoricalCampaignCatalogQuery` would aggregate `historical_catalog_projection` for the selected `lot_key` (and import request or niche, when those filters are present) instead of joining `SourceLeadEvent`. The `groups` select list, the scope scalars, the label `strpos` filter, the sort, and the lateral ownership join stay as they are. `HISTORICAL_CATALOG_STATEMENT_TIMEOUT_MS` stays `20_000`. Preview metrics that re-read source rows for a handful of selected identities can keep the current SQL; they were not the timeout. LO-1053 stays on `LeadAllocation`.

No current inventory or buyer-eligibility predicate changes.

## Live-service impact of the recommended sequence

- This PR: none.
- Gate 2: empty objects, plus a trigger-lock attempt bounded at 3 seconds. New historical inventory starts maintaining the projection immediately. The catalog does not read it.
- Gate 3: reads the source tables in chunks and writes only the new table. The local full load was 2.0 seconds and 80 MB of WAL for 200,043 rows. Intake inserts are not blocked by an exclusive lock on `SourceLeadEvent`. Each status change pays the one-row trigger measured above.
- Gate 6: the catalog stops scanning `SourceLeadEvent` for the lot aggregate. Expected local shape is the Option B table: a few tenths of a second and tens of megabytes even with a fully dirty visibility map, against the current plan's 1.6–2.0 seconds and 160–313 MB. The 20-second timeout stays in place.

## Separate production authorization

Approval to merge this review is not approval to run gates 2 through 7. A production authorization has to name the schema statement, accept the bounded trigger lock, accept the operator backfill outside `sa360-migrate`, and require `ready = false` until the chunk counts match. It must forbid generated columns and new indexes on `SourceLeadEvent`, forbid raising `statement_timeout`, forbid enabling the association flag, and forbid another production Vet catalog scan as the verification query.
