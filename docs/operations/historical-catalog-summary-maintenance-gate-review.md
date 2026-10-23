# Historical campaign summary — maintenance gate review

**Not authorized.** This note is the review input for a later trigger-installation gate. Gate 11 does not install these triggers, functions, or procedures.

Gate 12 put the candidate in `prisma/candidates/historical-catalog-summary-maintenance-v1/` and the runbook in `historical-catalog-summary-maintenance-v1.md`. Those files are not migrations. The candidate adds ordered grain advisory locks (`8142004`) before any bucket insert so the insert cannot invert bucket row locks. The hardened candidate keeps apply state in memory instead of creating temporary tables on each write, and it revokes `PUBLIC` execute inside the function-install transaction. Installing either file still requires a separate approval. Backfill, reconciliation, and read-path authorization are later boundaries and are not approved here.

The item-level source of truth remains `historical_catalog_projection` and its three triggers. Fulfillment, eligibility, reservation, resale, and Sheets stay on their own tables. `summary_ready` stays false until a separate authorize step that this note does not implement.

## Trigger order is per table, not global

PostgreSQL runs `AFTER` row triggers of the same event in name order on one table. `historical_catalog_projection_item_refresh` sorts before `historical_catalog_summary_item_apply` because `projection` sorts before `summary`. The same is true on `SourceLeadEvent` and `InventoryLot`. That order is required, and it is not sufficient by itself.

`historical_catalog_projection_refresh_item` deletes the projection row and inserts the new one inside the projection trigger function. That work finishes before the projection trigger returns, and therefore before a later-named trigger on the same inventory or source-event statement. The summary function must read membership for the previous bucket and the projection row for the new bucket. Membership is the previous contribution because the projection row is already gone by the time a summary trigger on the inventory table runs.

Name order does not cross tables. The event trigger calls `historical_catalog_projection_refresh_item` directly. It does not update `LeadInventoryItem`, so the item-table summary trigger does not run. The event-table summary trigger has to apply that item itself, after the event-table projection trigger.

The lot trigger updates `historical_catalog_projection.lot_key` in bulk. It does not call the item refresh. A row trigger on `historical_catalog_projection` would fire once per item in the lot, including a 216,000-row Vet rename. Do not attach summary maintenance to `historical_catalog_projection`.

## Delete-then-insert

The summary apply must be reconcile-to-current-projection, not a blind increment. The projection trigger has already deleted and reinserted the item. The membership row still points at the old bucket. The apply locks that membership, subtracts one from the old bucket, adds one to the new bucket, and moves the membership. Running it twice is a no-op. A trigger that adds one without retiring the old membership double-counts.

Lookups of the requested ids must be joins against `unnest`, not `item_id = ANY(array)`. A generic plpgsql plan turned the array form into a nested loop over the whole membership table.

## Shared buckets and lock order

Different items share one bucket. Two concurrent applies must not both read `n` and both write `n + 1`.

Lock order from the Gate 10 proof:

1. Per-item advisory locks, ordered by `hashtext(item_id)` then item id.
2. Label advisory locks, ordered by `hashtext(md5(token))` then hash.
3. Membership `FOR UPDATE` in item id order.
4. Bucket row locks in `bucket_id` order.

Deltas are one set-based update. A bucket that would go negative raises. Zero-count buckets are deleted only after membership has moved and while the bucket lock is still held. Deadlock (`40P01`) and a vanished bucket retry inside the statement. Exhausting the retries raises.

A hot status bucket is one row lock, not a scan of the historical lot. Concurrent intake into that bucket serializes on the row. That is the lock-contention risk to measure before production. A chunk must stay small enough that its advisory locks fit the session. The local proof used 500 ids. That size is local evidence, not a production budget.

## A failed unready mark rolls back the authoritative write

If bucket maintenance fails, the delta runs in a subtransaction and rolls back. A nested block then sets `summary_ready = false`, increments `summary_epoch`, and records the SQLSTATE. When that control update changes the single control row, the inventory write may commit and the catalog must fail closed. When the control row is missing or the unready update errors, the exception must propagate. Inventory, the projection refresh, and the summary delta all roll back. Swallowing that second failure can leave `summary_ready = true` after an unaccounted change. That outcome is not acceptable.

Lot-key rename does not rebucket. The same transaction clears `summary_ready` and increments the epoch. If that control update fails, the rename rolls back with it. Ordinary item maintenance must not scan the lot.

## How operators see errors

There is no summary trigger in this gate, so there is nothing to observe yet. The later gate should surface:

- `summary_ready`, `summary_epoch`, `reconciled_epoch`, `invalidated_at`, `invalidation`, and `failure_count` on the single control row
- request failure when the unready mark itself fails, because the inventory statement rolls back
- a successful inventory response followed by an unavailable catalog only after the read flag exists and the unready mark committed
- PostgreSQL `40P01` for deadlock, `55P03` for lock timeout, and `57014` for statement timeout
- checkpoint rows left in `running` after a crashed chunk

Production does not have `pg_stat_statements`. Do not install it as part of maintenance. `log_min_duration_statement` is 1 second, so a one-row apply may not be logged. A chunk that approaches the 20-second statement timeout will be.

## Reconciliation is what catches silent drift

The per-page readable check must not scan 216,000 rows. It checks one control row, epoch equality, a reconciliation timestamp, and the absence of a `running` checkpoint. That check does not see corruption that raised no exception.

The later reconcile, under a control-row lock and `SHARE` on the label, membership, and bucket tables, has to report negative counts, zero-count buckets, duplicate grains, bucket `n` against membership, projection rows without accounted membership, accounted membership without a projection row, field mismatches, label denormalization, and `sum(n)` against the projection count. `summary_ready = true` is allowed only from an authorize step that still holds those locks and sees zero issues. A partial backfill, a running checkpoint, an epoch mismatch, or a lot-key invalidation keeps the summary unready.

## Cardinality decides the plan

Do not plan for 534 buckets. That number is a grouped campaign count, not the bucket grain. The grain also splits raw lot, raw niche, origin, July spelling, status, and agreement. Production origin is statistically null, so origin will not multiply rows, but the other dimensions can. The worst case is one bucket per historical item.

The local Gate 10 fixture collapsed 250,448 projection rows to 1,474 buckets. At that size, plpgsql still sequentially scanned the bucket heap twice per update, about 0.3 ms locally. The standalone grain lookup chose the unique index. If production grains approach one bucket per item, those generic plans need to be pinned to `historical_catalog_summary_bucket_grain`. The catalog read uses `(lot_key, raw_lot_key)`. That index still limits the page to one lot, but a one-bucket-per-item lot is about 216,000 bucket rows rather than a few hundred.

Local timings are not a production guarantee. Production bucket cardinality was not measured.
