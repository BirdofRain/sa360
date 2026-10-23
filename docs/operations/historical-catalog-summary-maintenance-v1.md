# Historical campaign summary maintenance v1

Candidate only. This is not a Prisma migration, and merging it does not install functions, attach triggers, backfill buckets, or set `summary_ready`.

The SQL lives in two files that must stay apart:

| Boundary | File | Effect |
| --- | --- | --- |
| A. Functions only | `prisma/candidates/historical-catalog-summary-maintenance-v1/functions.sql` | One transaction: creates the composite types, functions, and one procedure, then revokes PUBLIC execute. Does not attach triggers and does not write inventory, projection, or summary rows by itself. |
| B. Trigger attachment | `prisma/candidates/historical-catalog-summary-maintenance-v1/triggers.sql` | Attaches three triggers. The next inventory, source-event, or lot-key statement changes summary membership. |
| C. Backfill and reconciliation | Operator calls, not a migration | `historical_catalog_summary_backfill_range`, `historical_catalog_summary_reconcile`. A partial backfill cannot authorize. |
| D. Read-path authorization | Separate from this candidate | `historical_catalog_summary_authorize` plus any future catalog read. `SA360_HISTORICAL_CAMPAIGN_SUMMARY_READ_ENABLED` stays unimplemented. |

Do not copy either file into `prisma/migrations`. Do not apply them in one automatic migration. A later merge of this repository state must not be treated as activation.

The item-level source of truth remains `historical_catalog_projection` and its three triggers. This candidate does not replace `historical_catalog_projection_refresh_item` and does not add a trigger on `historical_catalog_projection`. Fulfillment, eligibility, ordering, resale, and Sheets are unchanged. `SA360_HISTORICAL_CAMPAIGN_SUMMARY_READ_ENABLED` is not implemented.

## PostgreSQL version

The hardened intake and catalog-churn numbers below were measured on PostgreSQL 16.15 at 9:41 AM ET on 2026-10-23. Disposable PostgreSQL 18.6 compatibility, including the grain plans, is recorded in [historical-catalog-summary-role-security-v1.md](historical-catalog-summary-role-security-v1.md). Those results do not authorize installation.

Version-sensitive behavior that was demonstrated on 16.15:

- `IS NOT DISTINCT FROM` has no btree index path. On PostgreSQL 16.15 and again on disposable 18.6, both `force_generic_plan` and `force_custom_plan` sequential-scan that predicate. Equality uses an index. On 18.6 a skewed niche still made the generic plan choose a different index from the custom plan, so `force_custom_plan` stays necessary.
- `CREATE PROCEDURE` with a `SET` clause cannot `COMMIT`. `historical_catalog_summary_backfill_range` sets `search_path` inside each of its transactions instead of a `SET` clause.
- `QUERY_CANCELED` / `statement_timeout` (`57014`) is not catchable inside PL/pgSQL `EXCEPTION`. A probe with `PERFORM pg_sleep` under a 200 ms timeout raised `canceling statement due to statement timeout` and did not return the handler's value. The same abort happens when a bucket update is canceled. The inventory statement rolls back, and `summary_ready` stays as it was, because there is no committed unaccounted change. `failure_count` does not increase. `40P01` and `55P03` are catchable.

`UNIQUE NULLS NOT DISTINCT`, procedures that `COMMIT`, and `plan_cache_mode` were exercised on disposable PostgreSQL 18.6. The 16.15 latency table below was not remeasured.

## Intermediate state

One apply keeps its working rows in an in-memory array of `historical_catalog_summary_apply_desired`, and the bucket deltas in an array of `historical_catalog_summary_apply_delta`. Both composite types are created once when the function file is installed. A single-item write and a chunk of up to 500 ids use that same array. There is no second code path.

The array is rebuilt after label resolution and again after the bucket id lookup. A retry subtransaction discards it. Ordinary writes do not `CREATE` or `DROP` temporary tables, so they do not insert a row into `pg_class` per item.

Session-scoped temporary tables were set aside. The first call on a pooled connection would still be catalog DDL, and `ON COMMIT DROP` would repeat that DDL on every transaction. A statement-sized CTE cannot hold the rows across the ordered advisory-lock steps.

## Routine privileges

`functions.sql` is one transaction. PostgreSQL grants `EXECUTE` to `PUBLIC` on each new routine. The file revokes that grant on each routine it creates before `COMMIT`. It does not change default privileges, and it does not revoke anything on projection or application routines. It does not `CREATE ROLE` and it does not use `SECURITY DEFINER`.

If these roles already exist, the same transaction grants only the listed routines:

| Routine | PUBLIC | runtime | reader | operator | owner |
| --- | --- | --- | --- | --- | --- |
| Trigger chain: `apply_item`, `apply_items_work`, `apply_items_once`, `label_id`, `label_token`, `failure_reason`, `chunk_cap`, `item_trg`, `event_trg`, `lot_trg` | no | yes | no | yes | yes |
| `mark_unready` | no | yes | no | yes | yes |
| `readable` | no | no | yes | yes | yes |
| `reconcile_issues` | no | no | no | yes | yes |
| `backfill_chunk`, `checkpoint_open`, `checkpoint_complete`, `backfill_range`, `chunk_bounds`, `lock_for_reconcile`, `reconcile`, `authorize` | no | no | no | yes | yes |

`readable` checks the control row and running checkpoints. `reconcile_issues` scans the projection. The reader grant is only `readable`.

The table above is the invoker superset in `functions.sql`. While the routines run as the caller, the lot trigger and the fail-closed handler need the caller to be able to execute `mark_unready`. The operator receives that list as well because backfill and authorize call those routines as the current user. The runtime role is not a member of the operator role.

That superset is not the production allowlist. After `transform-owner-rights.sql`, the functions run with the schema owner's rights, `search_path` is `pg_catalog, public, pg_temp`, and `sa360_app` keeps direct execute only on the three trigger functions. The owner-rights chain calls the helpers. `postconditions.sql` rejects a runtime grant on `mark_unready`, authorize, backfill, or the checkpoint helpers.

The function owner can execute every routine after the revoke. That is PostgreSQL ownership, not a grant in this file. Skipping a grant when a role is absent does not remove the owner's path. The production installer has to fail closed instead. See [historical-catalog-summary-role-security-v1.md](historical-catalog-summary-role-security-v1.md).

Production App Platform binds one `${sa360-postgres.DATABASE_URL}` to `sa360-api`, `sa360-worker`, and the `sa360-migrate` pre-deploy job. That login owns the summary tables. `INHERIT FALSE` on a privilege role does not take ownership away. Boundary A stays held until the role-security sequence is approved and the runtime login is no longer the table owner.

## What one apply does

`historical_catalog_summary_apply_items_work` reconciles the given item ids to the current projection. It does not add one to a bucket because a row was updated. A second call with the same ids and the same projection is a no-op.

A chunk larger than `historical_catalog_summary_chunk_cap()` (500) is rejected before any write. Null ids are rejected. If none of the ids have a projection row and none have an accounted membership, the function returns without advisory locks, bucket writes, or a control-row write. That is the live non-historical path. It does not scan a lot.

Lock order inside one attempt:

1. Item advisory locks `pg_advisory_xact_lock(8142003, hashtext(item_id))`, ordered by hash then id.
2. Label advisory locks `pg_advisory_xact_lock(8142002, hashtext(label_hash))`, ordered by hash.
3. Membership `FOR UPDATE`, one row at a time, in `item_id` order.
4. Grain advisory locks `pg_advisory_xact_lock(8142004, hashtext(grain token))`, ordered by hash, then bucket `FOR UPDATE` in `bucket_id` order.

The grain advisory lock is taken before any bucket insert. An insert locks its new row immediately. Inserting before a shared order can deadlock two sessions that also need each other's existing buckets. Lookups are joins against `unnest`, not `item_id = ANY(array)`.

`historical_catalog_summary_apply_items_once` sets `plan_cache_mode = force_custom_plan`. On the 20,237-bucket fixture, the custom plan for the real Vet grain (`vet-historical`, null origin, shared import) was an index scan of `historical_catalog_summary_bucket_grain`, with `origin_id IS NULL` inside the index condition. The generic plan for that same statement used `historical_catalog_summary_bucket_niche`, because 20,000 synthetic niches made niche look selective. The function pins the custom plan so maintenance does not depend on that statistic. A distinct-form lookup sequential-scanned the same table.

Only `deadlock_detected` and SQLSTATE `SB001` (bucket vanished) retry, at most three attempts, each in its own subtransaction. A failed attempt does not leave a partial `n` update. Other errors, including underflow `SB004`, do not retry. Notices name the retry. There is no fault-injection GUC in the candidate.

## Failure policy

`historical_catalog_summary_apply_item` runs the work in a subtransaction. On a catchable error it rolls that subtransaction back, which releases the advisory and row locks, then calls `historical_catalog_summary_mark_unready`. The stored reason is an allowlisted token from `historical_catalog_summary_failure_reason`. `SQLERRM` is never stored.

Allowlisted tokens: `lot_key_rename`, `maintenance`, `reconcile_failed`, `authorize_rejected`, `deadlock_detected`, `lock_not_available`, `query_canceled`, `bucket_vanished`, `bucket_underflow`, `grain_too_long`, `label_unresolved`, `unique_violation`, `check_violation`, `foreign_key_violation`, `index_row_too_large`, `membership_incomplete`, and `sqlstate_` plus five characters. Any other reason raises `SB007`.

When the control update changes the single row, the inventory statement may commit. The projection refresh from the earlier trigger stays committed with it. The bucket delta does not. `summary_ready` is false, `summary_epoch` increases by one, `invalidated_at` and `invalidation` are set, and `failure_count` increases by one. The catalog must fail closed until a later reconcile and an explicit authorize.

When the control row is missing, the unready update waits until `lock_timeout` (`55P03`), or the unready update raises, the handler re-raises. The inventory statement, the projection refresh, and the summary delta all roll back. A missing control row uses `SB008`.

A lot-key rename calls `historical_catalog_summary_mark_unready('lot_key_rename', false)` once. It does not read projection rows and does not walk the lot. `failure_count` does not increase. If that control update fails, the rename rolls back with it.

Indexed grain text is rejected at a combined 2,400 bytes (`SB005`) before insert, short of the btree tuple limit near 2,704 bytes (`54000`). July text is not in the grain index. Label identity is the hash plus both texts, so two different strings can share a hash and still resolve to different rows.

`historical_catalog_summary_readable` reads the control row and looks for a `running` checkpoint. It does not scan membership or the projection. It is not called by application code.

`historical_catalog_summary_reconcile` and `historical_catalog_summary_authorize` are explicit operator functions. Triggers do not call them. Authorize sets `summary_ready` only when reconcile reports no data defects and no blocking checkpoint, and only while it still holds the control row lock and `SHARE` locks. A partial backfill, a `running` checkpoint, a `complete` checkpoint with a null finish, or a `failed` checkpoint that was not superseded and has no later `complete` for the same range cannot authorize. `ok` does not require epoch alignment; the report still includes `epochMismatch`, `failureCount`, `invalidation`, and `openInvalidation`.

`historical_catalog_summary_backfill_range` commits a `running` checkpoint, applies one id range, then commits `complete`. It has no exception handler, because PostgreSQL rejects `COMMIT` inside an `EXCEPTION` block. A chunk error leaves the checkpoint `running` and rolls the chunk back. The next call marks that running row `failed` with note `superseded` and applies the same ids again. Apply reconciles to the projection, so the retry does not double-count. The chunk function refuses to run while `summary_ready` is true and sets a local 20-second statement timeout.

## Trigger order

PostgreSQL runs `AFTER` row triggers for one event on one table in name order, and it finishes those triggers for a row before the next row. On each table, `historical_catalog_projection_*` sorts before `historical_catalog_summary_*`.

| Statement | Order that was proved |
| --- | --- |
| `LeadInventoryItem` insert, update, delete | Projection refresh deletes and inserts that item's projection row, then summary membership is written from that projection. |
| `SourceLeadEvent` campaign, payload, import, system, or provider update | The event projection trigger calls `historical_catalog_projection_refresh_item` directly. The item row is not updated. The event summary trigger then applies that item. |
| `InventoryLot` `lotKey` update | The projection trigger rewrites `lot_key` for the lot. The summary trigger invalidates readiness once. Bucket rows stay on the old grain. A 30-item rename changed 30 projection rows and 0 bucket rows. |
| Multi-row item update | For each of three items, the projection trace id is less than that item's membership trace id. |

Summary maintenance is not attached to `historical_catalog_projection`. A lot rename must not rebucket the lot inside the rename transaction.

## Catalog churn, 10,000 ordinary updates

Same host, PostgreSQL 16.15, one connection, 10,000 historical items on one lot and one campaign. Each measured statement is the first status change for that item, so the apply inserts membership and moves the bucket. The reviewed SQL is `c6579af7979a3e426cd058241a7fbf5125009f50`. The hardened SQL is the array path. Neither run deadlocked. `summary_ready` stayed false. Accounted membership and `sum(n)` both equaled 10,000.

| | Reviewed temporary tables | Hardened arrays |
| --- | --- | --- |
| Median | 3.671 ms | 1.837 ms |
| p95 | 4.600 ms | 2.382 ms |
| Wall | 44.6 s | 21.7 s |
| `pg_class` inserts / deletes | 50,000 / 50,000 | 0 / 0 |
| `pg_attribute` inserts / deletes | 420,000 / 420,000 | 0 / 0 |
| `pg_type` inserts / deletes | 40,000 / 40,000 | 0 / 0 |
| `pg_depend` inserts / deletes | 110,000 / 110,000 | 0 / 0 |
| `pg_namespace` inserts | 2 | 0 |
| Dead `pg_class` tuples added | 58,243 | 0 |
| Dead `pg_attribute` tuples added | 420,729 | 0 |
| `tup_returned` | 53,255,803 | 282,176 |
| `tup_inserted` | 680,089 | 30,002 |
| `tup_updated` | 40,194 | 30,000 |
| `blks_hit` | 9,943,446 | 1,181,562 |
| `temp_files` / `temp_bytes` | 0 / 0 | 0 / 0 |

The reviewed path's temporary tables are gone at commit (`ON COMMIT DROP`), and a count of live `summary_apply_*` relations is 0. The catalog rows they created are dead. Ten thousand writes left about 58,000 dead `pg_class` tuples and 421,000 dead `pg_attribute` tuples, so a catalog vacuum would be required to keep that path from bloating the system catalogs. The array path added no catalog inserts and no catalog dead tuples in that window. It does not need a catalog vacuum for ordinary item maintenance. The two composite types are created once, at install.

The array path was also faster on this host (median 1.837 ms versus 3.671 ms). That is a local result, not a production budget. The lock order, the retry rule, and the fail-closed handler are the same function as the chunk path.

## Local measurements

Fixture: 216,000 Vet rows on one lot, 34,000 rows across 34 other lots, 1,000 live non-historical rows. 250,000 projection rows. After backfill, 236 buckets. Plan checks added 20,000 more buckets (20,237 total). Cache was warm. `synchronous_commit` stayed at the server default for the timed writes. These numbers are the array path on this host. They are not a production budget.

| Workload | Median | p95 | n |
| --- | --- | --- | --- |
| Item status change, projection trigger only | 0.120 ms | 0.290 ms | 200 |
| Live niche touch, no summary trigger | 0.071 ms | 0.483 ms | 100 |
| Item status change, both triggers | 1.836 ms | 2.081 ms | 200 |
| Same-status historical update (no bucket move) | 1.410 ms | 1.931 ms | 100 |
| Live niche touch, summary trigger installed | 0.085 ms | 0.594 ms | 100 |
| Source-event campaign refresh | 1.963 ms | 3.111 ms | 20 |
| Item moved to another lot | 1.917 ms | 5.082 ms | 10 |
| 8 sessions, 25 status changes each, shared Vet buckets | 10.666 ms | 18.700 ms | 200 |

The 8-session run finished in 414 ms of wall time. Retries: 0. Deadlocks: 0. Peak connections on that database: 9 (8 writers plus the sampler). Peak ungranted locks: 6, which is the hot bucket serializing writers.

Across the 200 status changes, the following 100 same-status updates, and the 100 live touches: control-row updates 0, bucket updates 400 (2 per status change), membership updates 200 (1 per status change). The same-status and live paths added no bucket or membership updates. `summary_ready` stayed false. Reconcile after the concurrent run reported `ok` with no negative counts, zero-count buckets, missing or extra membership, field mismatches, or bucket/member mismatches.

The `pg_stat_database` window covering those maintained, same-status, live, event, lot, and concurrent writes: `tup_returned` 713,407, `tup_fetched` 430,573, `tup_inserted` 1,162, `tup_updated` 1,890, `blks_hit` 142,840, `blks_read` 87.

Backfill used the 500-id cap: 500 chunks, median 28.6 ms, p95 57.0 ms, wall 17.3 s. One chunk holds the buckets it touches until it commits. A chunk of the hot grain can make live writers wait on that row for about that long.

Initial production chunk size: **100** ids, one backfill connection. The local rule in the bench would allow 250 because chunk p95 was 57 ms and the 8-way p95 stayed under 50 ms, and the function cap remains 500. Start at 100 anyway. This host is not PostgreSQL 18.6, and the run used 9 connections rather than the production pool of 25. Raise the chunk only after production lock waits stay boring. Stop the backfill if a chunk exceeds 250 ms, `pg_stat_database.deadlocks` increases, `failure_count` increases, or a checkpoint stays `running`. The custom plan for the real Vet grain still used `historical_catalog_summary_bucket_grain`. `IS NOT DISTINCT FROM` still sequential-scanned at 20,237 buckets.

## Boundary A — functions only

Preflight:

- The reviewed SQL matches the file that will be applied.
- The five summary tables already exist. Record `summary_ready`, `summary_epoch`, `failure_count`, and the label, bucket, membership, and checkpoint counts.
- Record the projection control row (`ready`, counts, `verified_at`) and confirm the three projection triggers are enabled.
- Confirm `pg_proc` has none of the `historical_catalog_summary_` maintenance functions yet, and `pg_trigger` has none of the three summary trigger names.
- Apply `functions.sql` as the script's own transaction. It creates the routines and revokes `PUBLIC` before commit. Do not call any function. Do not run the procedure. Do not attach `triggers.sql`. Do not create `sa360_summary_runtime`, `sa360_summary_operator`, or `sa360_summary_reader` in this step.

Stop and roll back the install transaction if any `CREATE` errors, if a summary trigger appears, if `summary_ready` or the projection control row changes, or if any summary table count changes.

After commit, observe `pg_proc` and confirm the trigger count is still zero. Inventory and source-event writes must behave as they did before the install.

Rollback: `DROP FUNCTION` / `DROP PROCEDURE` for the maintenance routines, then `DROP TYPE historical_catalog_summary_apply_desired` and `DROP TYPE historical_catalog_summary_apply_delta`, inside a transaction. Do not drop the five tables. Do not change `summary_ready`. Projection triggers stay. Do not `REVOKE` privileges on unrelated routines.

## Boundary B — attach triggers

Attaching the triggers changes the next write. Do this only after Boundary A is present and a separate approval names this file.

Preflight:

- Functions from Boundary A are the reviewed definitions.
- `summary_ready` is false. No checkpoint is `running`.
- Projection triggers are still enabled.
- The session that creates the triggers uses a short `lock_timeout`.
- An operator can `DROP TRIGGER` the three summary triggers immediately.
- Do not start a backfill in the same step.

Stop if trigger creation errors, if the first inventory or source-event writes start failing, if `failure_count` increases on ordinary successful-looking traffic, if `summary_ready` becomes true, if deadlocks appear, or if item-write latency leaves the range agreed from a production measurement. The local uncontended p95 was 2.1 ms and the local 8-way p95 was 18.7 ms. Those are not the production stop line by themselves. `log_min_duration_statement` is 1 second, so a normal apply will not be in the slow log. Retry notices are client notices; production `log_min_messages` will not keep them. Watch `failure_count`, `invalidation`, `summary_epoch`, and `pg_stat_database.deadlocks`.

Rollback: `DROP TRIGGER historical_catalog_summary_item_apply ON "LeadInventoryItem"`; `DROP TRIGGER historical_catalog_summary_event_apply ON "SourceLeadEvent"`; `DROP TRIGGER historical_catalog_summary_lot_invalidate ON "InventoryLot"`. Writes return to projection-only behavior. Existing bucket rows are left as they are. Do not set `summary_ready` true during rollback. Dropping triggers does not repair a summary that was invalidated. Functions may stay until a separate Boundary A rollback.

Backfill and authorize are not part of Boundary B. A partial backfill cannot authorize. Authorize stays an explicit later call, after reconcile reports `ok`, and it is outside this gate.

## Boundary C — backfill and reconciliation

Not approved. After A and B, an operator calls `historical_catalog_summary_backfill_range` one chunk at a time, then `historical_catalog_summary_reconcile`. Start at 100 ids. A `running` checkpoint blocks authorize. A retry supersedes that checkpoint and reconciles to the projection, so it does not double-count a live update that landed during the chunk. Stop on the conditions in the measurement section. Do not call `historical_catalog_summary_authorize` in this boundary.

## Boundary D — read-path authorization

Not approved. `historical_catalog_summary_authorize` is the only routine that sets `summary_ready` true, and only when reconcile reports no data defects and no blocking checkpoint. The catalog read flag is not implemented. Turning a read path on is a separate performance check on PostgreSQL 18.6, after C. Merging this file does not authorize the summary.

## What this gate does not do

- No file under `prisma/migrations` creates these functions or triggers.
- No application code calls apply, reconcile, or authorize.
- Production is not modified. `summary_ready` on production stays false.
- Projection readiness, catalog flags, fulfillment, ordering, eligibility, resale, and Sheets are unchanged.
- Local proof is not permission to install boundaries A, B, C, or D.
