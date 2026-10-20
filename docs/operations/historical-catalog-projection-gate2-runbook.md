# Historical catalog projection — Gate 2 runbook

**Status:** deployed on master `461a80184a2d7860bff6f4a3fdec05b0c20c6424`. Backfill execution, the lot index, `ready = true`, and the catalog switch remain NO-GO. The operator runner is `docs/operations/historical-catalog-projection-backfill-runbook.md`.

This migration is the Gate 2 schema from the Option B review (PR #199). Generated columns and indexes on `SourceLeadEvent` are not part of it. The lot covering index, the backfill execution, `ready = true`, and the catalog query switch are not part of it.

## What a merge does

Merging this migration to `master` does **not** wait for another switch. The next API deployment runs the `sa360-migrate` `PRE_DEPLOY` job:

`pnpm migrate:deploy` → `prisma migrate deploy`

That job applies `prisma/migrations/20261020200000_historical_catalog_projection_v1/migration.sql` before traffic switches. If the migration errors, the deployment fails and traffic stays on the previous release.

The file is applied in the transaction Prisma Migrate opens around the migration. Its first statement is:

```sql
SET LOCAL lock_timeout = '3s';
```

`SET LOCAL` is rejected outside an explicit transaction block (`SQLSTATE 25001`), so a runner that autocommits each statement stops before creating any object. Inside Prisma's transaction the setting covers every later lock, including `CREATE TRIGGER`, and it ends when that transaction ends. It does not change the database default.

On success the migration:

- creates empty `historical_catalog_projection` and `historical_catalog_projection_control`
- inserts the control row with `ready = false`
- creates the source view, refresh functions, the bounded diff function, and the backfill procedure
- creates three `AFTER` triggers

It does not `CALL` the backfill procedure, does not create an index, does not set `ready = true`, and does not `INSERT`, `UPDATE`, or `DELETE` inventory or source-event rows.

The catalog query keeps reading `SourceLeadEvent`. `HISTORICAL_CATALOG_STATEMENT_TIMEOUT_MS` stays 20000. `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED` is unchanged and stays off.

## Locks

On PostgreSQL 16, `CREATE TRIGGER` takes `SHARE ROW EXCLUSIVE` on its table. This migration creates triggers on `LeadInventoryItem`, `SourceLeadEvent`, and `InventoryLot`. Those locks are held until the migration transaction commits, immediately after the three trigger statements. There is no backfill inside the transaction.

`SHARE ROW EXCLUSIVE` conflicts with `ROW EXCLUSIVE`, so INSERT, UPDATE, and DELETE wait. It does not conflict with `ACCESS SHARE`, so a plain SELECT proceeds, including a SELECT that starts while a writer is already waiting. It does conflict with `SHARE`. The 3-second `lock_timeout` cancels the migration if a required lock is not granted in time, and PostgreSQL rolls that transaction back.

Measured on local PostgreSQL 16.15:

- A transaction that only runs `CREATE TRIGGER` holds `ShareRowExclusiveLock` on the target table. `AccessExclusiveLock` is absent.
- A concurrent `SELECT` from `SourceLeadEvent` completes.
- A concurrent `INSERT` into `SourceLeadEvent` fails with a lock timeout.
- A second `SELECT` started while that `INSERT` is waiting also completes.
- `DROP TRIGGER` takes `ACCESS EXCLUSIVE` and does block `SELECT`. The migration does not drop triggers. The rollback script does, so removing them blocks readers and writers until the 3-second timeout or the drop commits.
- A `SHARE` lock held on `SourceLeadEvent` makes `prisma migrate deploy` fail after 3949 ms with SQLSTATE `55P03`. The projection table, control table, view, functions, and triggers are absent after that failure. `prisma migrate resolve --rolled-back` followed by another deploy installs the empty read model with `ready = false` and all three triggers.

## If predeploy fails on the lock

1. Confirm the deployment did not switch traffic.
2. Confirm the projection objects are absent:

```sql
SELECT to_regclass('public.historical_catalog_projection') AS projection,
       to_regclass('public.historical_catalog_projection_control') AS control;
SELECT tgname FROM pg_trigger
WHERE tgname LIKE 'historical_catalog_projection_%' AND NOT tgisinternal;
```

Both tables must be null and the trigger query must return no rows. Do not continue while any of those objects exist.

3. Prisma records the attempt as a failed migration even though the DDL rolled back. Clear that record only after the check above:

```bash
pnpm exec prisma migrate resolve --rolled-back 20261020200000_historical_catalog_projection_v1
```

4. Retry the deployment when the conflicting transaction is gone. Do not raise `lock_timeout` and do not edit the applied migration file.

An interrupted connection rolls the open transaction back as well. The same absence check and `migrate resolve --rolled-back` apply if `_prisma_migrations` shows this migration with `finished_at` null.

DigitalOcean point-in-time recovery builds a new cluster. It is not required for a rolled-back migration that created no objects.

## Projection consistency

Equal counts are not acceptance. `historical_catalog_projection_diff(after_id, until_id, limit)` compares, for a required id range and at most 200 returned rows:

- lot key
- import identity (`importRequestId`, then `bulkImportId`, then `(none)`)
- trimmed July label and its normalized form
- attribution agreement
- inventory status
- origin client
- niche

It sets `statement_timeout` to 20 seconds for that call. It does not scan by running the Vet catalog query. Keep each range small.

Triggers maintain those fields from item status, niche, origin, lot, source provider, and source event; from the event's July column, payloads, bulk import id, system, and provider; and from `InventoryLot.lotKey`. Deletes of an item remove its projection row. Non-historical rows are not projected. Registry decisions and LO-1053 allocation counts are not copied.

The backfill procedure is installed and not called. It writes projection rows only. Its upsert may replace a projection row only when `refreshed_at` is strictly older than the backfill transaction's `transaction_timestamp()`. An equal timestamp keeps the existing row, so a trigger write in the same microsecond is not replaced by the chunk's snapshot. Trigger writes use `clock_timestamp()`, so a trigger that commits during the chunk is kept. A following delete removes a chunk row that is no longer historical only when its `refreshed_at` is still from this backfill transaction or older. Do not call the procedure in production until backfill approval. Calling it does not set `ready` and does not change the catalog query.

The procedure does not take `FOR UPDATE` on inventory or events. A chunk-long row lock would stall intake updates for up to the 20-second statement timeout. The timestamp guard is what prevents a stale upsert from winning.

## Index, later and separately

Do not create this index in Gate 2.

On PostgreSQL 16, btree rejects an index tuple that does not fit with `SQLSTATE 54000`. Local measurement with incompressible labels, including the other proposed payload columns:

| Included label shape | Result |
| --- | --- |
| July label only, 2400 bytes | index builds |
| July label only, 2704 bytes | `54000` |
| July and normalized label, 1200 bytes each | index builds |
| July and normalized label, 1400 bytes each | `54000` |
| `repeat('V', 8000)` in both labels | index builds, because the value compresses |

`sourceCampaignName` is unbounded text. A legitimate incompressible label of about 2704 bytes makes the previously proposed `INCLUDE (july_label, ...)` index fail, including `CREATE INDEX CONCURRENTLY`. Repeated characters hide the failure.

The operator index, after a later approval, is only:

```sql
CREATE INDEX CONCURRENTLY historical_catalog_projection_lot_idx
  ON historical_catalog_projection (lot_key);
```

A local `CREATE INDEX` and `CREATE INDEX CONCURRENTLY` on `(lot_key)` succeed while an incompressible July label longer than the btree maximum sits in the heap. Campaign labels are not part of the index tuple, so their length does not fail index creation. `CONCURRENTLY` cannot run inside a Prisma migration transaction, which is another reason it stays out of this file.

## Fulfillment

`HistoricalCatalogProjection` has no foreign key to `LeadInventoryItem`. Intake deletes do not depend on a projection row. No fulfillment, sellability, reservation, or buyer-eligibility query reads the projection, the source view, or the control row. `ready = false` is the additional gate for the catalog switch, which is not in this release.

## Rollback after a successful Gate 2 deploy

The catalog behavior is unchanged while `ready` is false, so leaving the objects in place is safe. To remove them, in a later approved change and not by editing this migration:

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP TRIGGER historical_catalog_projection_item_refresh ON "LeadInventoryItem";
DROP TRIGGER historical_catalog_projection_event_refresh ON "SourceLeadEvent";
DROP TRIGGER historical_catalog_projection_lot_refresh ON "InventoryLot";
DROP PROCEDURE historical_catalog_projection_backfill_chunk(text, text);
DROP FUNCTION historical_catalog_projection_diff(text, text, integer);
DROP FUNCTION historical_catalog_projection_item_trg();
DROP FUNCTION historical_catalog_projection_event_trg();
DROP FUNCTION historical_catalog_projection_lot_trg();
DROP FUNCTION historical_catalog_projection_refresh_item(text);
DROP VIEW historical_catalog_projection_source;
DROP TABLE historical_catalog_projection;
DROP TABLE historical_catalog_projection_control;
COMMIT;
```

Dropping a trigger takes `ACCESS EXCLUSIVE` and blocks readers and writers. The 3-second timeout fails the script instead of waiting. This rollback does not restore source rows because Gate 2 does not modify them. Do not mark the original migration rolled back after it has successfully committed; add a new migration for the drop. Prisma will not forget a finished migration.

`refreshed_at` and `verified_at` are `timestamptz(6)`. The guard compares absolute instants. A later `prisma migrate dev` must not convert them to `timestamp` without time zone. A local diff from the migrated database to `schema.prisma` does not drop the view, the functions, or the procedure. If a future Prisma version emits those drops, delete them before saving the migration. The same diff also reports older unrelated index renames and column defaults; do not fold that drift into a projection migration.
