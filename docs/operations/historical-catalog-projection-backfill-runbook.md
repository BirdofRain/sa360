# Historical catalog projection — Gate 3 backfill runbook

**Status:** HOLD for production execution. The runner and this runbook are preparation only.

Gate 2 is deployed on master `461a80184a2d7860bff6f4a3fdec05b0c20c6424`. The catalog query still reads `SourceLeadEvent`. `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED` stays off. PR #188 stays unmerged. The revert of PR #192 stays in place.

Do not run the backfill, create the lot index, set `ready = true`, switch the catalog query, run the Vet catalog, or change fulfillment eligibility under this runbook. A later approval has to name those steps separately.

## Verified production state

Read on 2026-10-20 through the already-running `sa360-api` console, with `statement_timeout = 20s` and a read-only transaction. No firewall change, no new endpoint, and no call to the backfill procedure. The runner itself uses `SET TRANSACTION READ ONLY`, which is what rejects writes.

| Check | Result |
| --- | --- |
| Migration `20261020200000_historical_catalog_projection_v1` | `finished_at` 2026-10-20T21:05:28.008Z, `rolled_back_at` null, one applied step. Database duration about 157 ms. |
| Tables and source view | `historical_catalog_projection`, `historical_catalog_projection_control`, `historical_catalog_projection_source` |
| Control row | `ready = false`. Source count, projection count, and `verified_at` are null. |
| Triggers | `historical_catalog_projection_event_refresh`, `historical_catalog_projection_item_refresh`, `historical_catalog_projection_lot_refresh`. All `tgenabled = O`. |
| Routines | `historical_catalog_projection_diff` (function), `historical_catalog_projection_backfill_chunk` (procedure), plus the refresh and trigger functions. |
| Projection rows | 0 immediately after the Gate 2 deploy. 1 on the sizing read. 2 after master `980914c` finished deploying. Those rows are trigger maintenance, not a backfill. |
| Inventory ids | 261,560 `LeadInventoryItem` rows. |
| Historical source rows | 250,417 rows from `historical_catalog_projection_source`, counted in 7.6 s. |
| Projection indexes | Primary key only. |
| Lock waits at the time of the count | 0. |
| Association flag | The key is absent on the app spec, so it is off. |

A 50-id sample of `historical_catalog_projection_diff` returned one category, `missing_projection`, with count 50. That is the expected pre-backfill result. Equal totals are not acceptance; the sample shows the projection does not yet contain those source ids.

The sizing queries ran while deployment `c52d4fed-0b22-4c4f-a703-616cb8f1c190` (commit `461a801`) was active. Master then moved to `980914c` (company Google Sheets tables only; it does not alter the projection). After deployment `79c51088-d107-4ab1-baf7-dad54662e10d` was active, a second read-only check found the Gate 2 migration still finished, `ready` still false, all three triggers still enabled, the projection at 2 rows, and the association flag still absent. Do not start a backfill while a deployment is building or deploying. After `980914c` was active, `/health` reported that commit, `/health/db` was connected, `/health/queue` returned PONG, and the portal `/api/health` returned 200.

## Batch size and expected runtime

The runner walks `LeadInventoryItem.id` in keyset order. Each chunk is at most **100** inventory ids. The cap is in the script. Raising it is a reviewed code change after measured production chunks, not an operator flag.

The installed procedure scans `historical_catalog_projection_source` for `item_id > after AND item_id <= until`. It does not lock source rows. `EXPLAIN ANALYZE` of that read, without calling the procedure:

| Window | Join time | Notes |
| --- | --- | --- |
| 100 inventory ids | about 10 ms | Bounds were already resolved. Planning plus a large `OFFSET` to discover a mid-table bound added about 300 ms. The runner does not use a large offset; it reads the next 100 ids after the checkpoint. |
| 500 inventory ids | about 35 ms | Same shape. A separate cold `count(*)` of the first 500 ids, using `id <= <500th id>` rather than this range predicate, took 18.1 s. That is not the statement the runner issues, and it is why a 500-id chunk is not the starting size. |

About 95.7% of inventory ids are historical (250,417 / 261,560), so a 100-id chunk writes on the order of 100 projection rows. The write path was not timed in production.

Planning budget, not a guarantee:

- 2,616 chunks cover 261,560 ids.
- Budget **2 seconds** per chunk, including the diff and the health checks. That is about **90 minutes** if chunks run back to back.
- If measured chunk time stays near the 10–50 ms read, the database portion is shorter. Do not speed up from that guess.
- The first approved execution is **one** chunk. Stop after it.

The full source count took 7.6 s. The runner does not repeat that count on every chunk.

## What the runner does

Script: `scripts/historical-catalog-projection-backfill.mjs`

Command: `pnpm historical-catalog:backfill`

It runs outside `prisma migrate deploy`. Nothing in the API or worker start path calls it. Merging the script deploys a file that stays idle.

Default mode is dry-run:

- one database connection
- `SET TRANSACTION READ ONLY` before any other statement, so PostgreSQL rejects writes in that transaction
- `SET LOCAL statement_timeout = '20s'`
- `SET LOCAL lock_timeout = '3s'`
- counts for the next id window
- `historical_catalog_projection_diff(after, until, 200)`, aggregated by category so item ids and field values stay in the database
- duplicate source-id count
- `ready`, trigger, and lock-wait checks

`--execute` is refused unless all of these are present:

- `--confirm "BACKFILL HISTORICAL CATALOG PROJECTION"`
- `--expected-db-host` matching the `DATABASE_URL` host, or host and port
- `--checkpoint` outside the git repository
- `--init-checkpoint` only when that file does not exist yet
- `--api-health-url` when the database host is not loopback

Execute calls `historical_catalog_projection_backfill_chunk(after, until)` and then repeats the diff in the same transaction. Any discrepancy, a full 200-row diff cap, a duplicate source id, or `ready` other than false throws and rolls the chunk back. The checkpoint moves only after that transaction commits.

The runner never disables triggers, never updates `historical_catalog_projection_control`, and never updates `LeadInventoryItem`, `SourceLeadEvent`, or `InventoryLot`.

Stdout is counts, discrepancy categories, cursors, durations, and the checkpoint recovery document. It does not print campaign labels, import ids, raw payloads, contact fields, or database driver text.

A database failure returns `reasonCode`, an allowlisted `driverCode` such as `57014` or `55P03` when PostgreSQL supplied one, a Prisma code such as `P2010` when that code is the `P` plus four digits form, and `durationMs`. The runner does not print the driver message, the SQL, or bound parameters.

## Load, connections, and stop conditions

- Database connections: **1**.
- Health checks are HTTP, not extra database sessions: `GET /health`, `GET /health/db`, and `GET /health/queue` on `--api-health-url`. Each must return 200 within 5 seconds before an execute chunk. For production the origin is `https://api.lifeagentlaunch.com`.
- Also check `https://portal.lifeagentlaunch.com/api/health` before the first production chunk. The script does not call the portal.
- Chunk lock scope is the projection rows in that id window. Inventory writes outside the window do not take those row locks. Inventory writes inside the window wait until the chunk commits or hits `lock_timeout` (3 seconds) / `statement_timeout` (20 seconds).
- Stop, and do not start the next chunk, when any of these are true:
  - a health check is not 200
  - `pg_stat_activity.wait_event_type = 'Lock'` is non-zero at chunk start
  - the chunk returns `chunk_failed` or `chunk_not_accepted` (timeout, lock timeout, or a non-empty diff)
  - `ready` is anything other than false
  - any of the three maintenance triggers is missing or not enabled
  - duplicate source ids in the window are non-zero
  - API intake responses during the chunk are failing, or queue health is not `PONG`
- `--chunks` defaults to 1 and cannot exceed 20. `--pause-ms` can insert up to 10 seconds between executed chunks. Production execution should start at `--chunks 1`.

## Checkpoint storage

The checkpoint is a version 2 JSON file. It records the database host, port, database name, and database oid taken from the connection, plus the last committed inventory-id cursor. It does not record credentials.

DigitalOcean App Platform replaces the container filesystem when a deployment rolls or the container restarts. A file written under `/tmp` or the app directory inside `sa360-api` disappears with that container. Do not keep the only copy there, and do not add a database table or another service to hold it.

Run the script from a durable operator workstation that already has authorized database access. Keep `--checkpoint` on that workstation. Each committed chunk also prints `checkpointRecovery`, which is the same document as the file. If a console session is the only place the command can run, copy `checkpointRecovery` out of the session before it ends and store that JSON outside App Platform. The next run reads it back with `--checkpoint`.

The runner writes the file only after the chunk transaction commits. It writes a temporary file, `fsync`s it, and renames it over the checkpoint. A crash during the chunk leaves the previous file in place, and PostgreSQL rolls the open transaction back. The next start repeats the uncommitted window. If the commit succeeds and the file write fails, the report uses `checkpoint_write_failed` and includes `checkpointRecovery` for the committed cursor. Saving that document and resuming does not repeat the window. Resuming from the older file repeats the window, which is safe.

A checkpoint whose host, port, database name, or oid does not match the current connection is refused with `checkpoint_database_mismatch`. The report names the fields that differ and does not print the other database.

## Failed chunk, restart, and resume

The procedure does not commit internally. A timeout or a failed post-check rolls the open transaction back. The checkpoint's `appliedAfterId` stays on the last committed window, or on the start cursor when the first chunk fails.

Restart is the same command without `--init-checkpoint`. The next chunk repeats the uncommitted window. Repeating a committed window is also safe: the upsert replaces a projection row only when `refreshed_at` is strictly older than the chunk, so a trigger write from live intake is kept. The delete removes projection rows in the window that are not in the historical source and are not newer than the chunk.

A dry-run does not move `appliedAfterId`. `--after` must match the checkpoint cursor when both are set.

`outcome: COMPLETE` means the keyset walk found no inventory id after the cursor. A single applied chunk is `outcome: APPLIED` and `complete: false` while ids remain.

## Rollback

Do this only under a separate approval. While `ready` is false, application code does not read the projection.

To drop a committed window's projection rows:

```sql
DELETE FROM historical_catalog_projection
WHERE item_id > '<after>' AND item_id <= '<until>';
```

That statement does not modify inventory or source events. Leave the three triggers enabled. `DROP TRIGGER` takes `ACCESS EXCLUSIVE` and blocks readers; it is not the backfill rollback. Do not set `ready`. New inventory updates still refresh their own projection rows through the triggers.

The runner has no delete mode.

## Production steps that still need approval

These steps are not authorized yet.

1. Confirm no DigitalOcean deployment is in progress and the association flag is still absent.
2. Re-read, with the same read-only transaction settings:
   - migration `20261020200000_historical_catalog_projection_v1` finished and not rolled back
   - `ready = false`
   - the three triggers enabled
   - projection row count (trigger inserts may have increased it)
3. Deploy or otherwise place the reviewed `scripts/historical-catalog-projection-backfill.mjs` where it will run. A merge to `master` deploys that file with the API image and does **not** call it. `sa360-migrate` does not call it either.
4. Dry-run one 100-id chunk from the environment that already has `DATABASE_URL`. Example shape, with the real host and a checkpoint path outside the repo:

```bash
pnpm historical-catalog:backfill -- \
  --expected-db-host <host:port> \
  --checkpoint "$HOME/sa360-historical-catalog-backfill.json" \
  --init-checkpoint \
  --chunk-size 100 \
  --chunks 1
```

5. Stop. Inspect category counts only. Do not execute on that result alone.
6. After a separate GO, run one chunk:

```bash
pnpm historical-catalog:backfill -- \
  --execute \
  --confirm "BACKFILL HISTORICAL CATALOG PROJECTION" \
  --expected-db-host <host:port> \
  --api-health-url https://api.lifeagentlaunch.com \
  --checkpoint "$HOME/sa360-historical-catalog-backfill.json" \
  --chunk-size 100 \
  --chunks 1
```

7. Require `ready: false`, an empty `diff`, `duplicateSourceIds: 0`, HTTP 200 from the three API health routes and the portal health route, and no new intake failures. Then stop again.
8. Further chunks, a larger chunk size, the lot index, `ready = true`, and the catalog switch are additional approvals. They are not implied by a one-chunk GO.
