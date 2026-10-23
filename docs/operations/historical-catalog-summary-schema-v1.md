# Historical campaign summary — Gate 11 schema

**Status:** schema only. Not merged. `summary_ready` stays false. No triggers, no backfill, no catalog read.

Production baseline for the design is `000f46d9229cf86d3152260bc4c9498f1836cc15`. This migration is the schema half of the Gate 10 summary design. Maintenance functions and triggers are a later gate. See `docs/operations/historical-catalog-summary-maintenance-gate-review.md`.

## What a merge does

Merging `prisma/migrations/20261022170000_historical_catalog_summary_schema_v1` into `master` does not wait for another switch. The next API deployment runs the `sa360-migrate` `PRE_DEPLOY` job:

`pnpm migrate:deploy` → `prisma migrate deploy`

That job applies this file before traffic switches. If the migration errors, the deployment fails and traffic stays on the previous release. The file is the reason this pull request stays a draft until that application is reviewed.

The migration SQL owns its transaction. The first statement is `BEGIN;` and the last statement is `COMMIT;`. `SET LOCAL lock_timeout = '3s';` is the next statement, so the timeout covers every lock taken until `COMMIT`. It does not change the database default.

`prisma migrate deploy` (Prisma 6.19, the `sa360-migrate` path) sends the file with `simple_query`. It does not add its own `BEGIN` or `COMMIT`. Generated migrations receive those statements from the schema renderer; a hand-written file has to include them. If any statement fails before `COMMIT`, PostgreSQL rolls the whole schema change back. None of the five summary tables, their indexes, or the control row remain.

Prisma still records the failed attempt in `_prisma_migrations` from a later bookkeeping transaction (`finished_at` null). Retrying requires `prisma migrate resolve --rolled-back 20261022170000_historical_catalog_summary_schema_v1`, then another deploy. Confirm the five `to_regclass` results are null before resolving. This schema gate does not authorize that resolution, or any other cleanup, on production.

On success the migration:

- creates empty `historical_catalog_summary_label`
- creates empty `historical_catalog_summary_bucket`
- creates empty `historical_catalog_summary_membership`
- creates `historical_catalog_summary_control` and inserts one row with `summary_ready = false`, `summary_epoch = 0`, and null reconciliation fields
- creates empty `historical_catalog_summary_checkpoint`
- adds the Gate 10 indexes and the `UNIQUE NULLS NOT DISTINCT` bucket grain

It does not create a trigger, function, or procedure. It does not set `summary_ready = true`. It does not read or write `LeadInventoryItem`, `SourceLeadEvent`, `InventoryLot`, `historical_catalog_projection`, or `historical_catalog_projection_control`. The projection catalog query is unchanged. No environment variable is added. No worker job is added.

## Locks

`CREATE TABLE` takes `ACCESS EXCLUSIVE` on the new relation only. No other session can see that relation until the migration transaction commits. `CREATE INDEX`, the foreign keys, the check constraints, and the one control-row insert run while that lock is already held.

This file does not lock `LeadInventoryItem`, `SourceLeadEvent`, `InventoryLot`, or `historical_catalog_projection`. A local proof held `SHARE` on all four and the migration still applied. `SHARE` conflicts with `ACCESS EXCLUSIVE` and with trigger installation, so that result is the check that this file does not take those locks.

Prisma's migrate bookkeeping inserts into `_prisma_migrations` and takes its own advisory lock. That bookkeeping is outside the SQL file's `BEGIN`/`COMMIT`. It is the only existing application table this deploy writes. A statement error before `COMMIT` rolls the summary DDL back and leaves the failed migration row for the resolution command above. This gate does not authorize running that command, or any destructive cleanup, against production.

The 3-second `lock_timeout` cancels the migration if a lock it does need is not granted. The expected lock is the new-table lock plus Prisma's migration bookkeeping, not a populated inventory lock.

## PostgreSQL version

The local proof ran on PostgreSQL 16.15. Production is PostgreSQL 18.6. PostgreSQL 18 was not installed in the local environment, so 18 was not executed. `UNIQUE NULLS NOT DISTINCT` exists in PostgreSQL 15 and later, including 16 and 18. The migration does not use a PostgreSQL 18-only feature.

## Prisma

`schema.prisma` maps the five tables, the foreign keys with `ON DELETE RESTRICT` and `ON UPDATE RESTRICT`, and the Gate 10 indexes. Prisma 6.19 cannot express `UNIQUE NULLS NOT DISTINCT` or the check constraints. The bucket `@@unique` lists the same columns under the name `historical_catalog_summary_bucket_grain` so a diff does not drop the constraint. If a later Prisma version regenerates it, keep `NULLS NOT DISTINCT`. `label_hash` stays a non-unique index.

A diff from a database that has this migration applied to `schema.prisma` must not mention `historical_catalog_summary_`.
