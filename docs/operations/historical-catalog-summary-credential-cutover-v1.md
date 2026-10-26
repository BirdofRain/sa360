# Historical summary credential cutover

Operational plan only. This document does not create roles, change DigitalOcean, install SQL, attach triggers, backfill, or authorize `summary_ready`. The checked-in preparation scripts refuse a database whose name does not contain `test`, so they cannot be pointed at production `defaultdb`.

No password, connection string, or customer row belongs in this repository, in a checker exception, or in a deploy log.

## Roles

| Role | Login | After cutover |
| --- | --- | --- |
| `doadmin` | yes | Migrate job only. Keep the current binding. Do not rotate this password in the cutover deploy |
| `sa360_schema_owner` | no | Owns the five summary tables, their sequences, and, after Boundary C, the summary routines. `INHERIT` is off |
| `sa360_app` | yes | API and worker only. No `CREATEROLE`, `CREATEDB`, `BYPASSRLS`, or `CREATE` on `public`. Inherits `sa360_summary_runtime` with `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE` |
| `sa360_summary_runtime` | no | Execute on the three summary trigger functions only |
| `sa360_summary_operator` | no | Backfill, reconcile, authorize, and `mark_unready`. No direct summary DML |
| `sa360_summary_reader` | no | `readable()` only |

`doadmin` may be a member of `sa360_schema_owner` and `sa360_summary_operator` with `INHERIT FALSE` and `SET TRUE`. `INHERIT TRUE` lets that member update `summary_ready` and disable triggers without `SET ROLE`. `sa360_app` must not be a member of `doadmin`, `sa360_schema_owner`, or `sa360_summary_operator` under any of `INHERIT`, `SET`, or `ADMIN`.

`doadmin` is not a superuser. It has `CREATEROLE` and `BYPASSRLS`. Those attributes stay on the migrate login. They are not granted to `sa360_app`.

## Privilege matrix

`prepare-ownership.sql` is the disposable form of Boundary A. It does not grant `sa360_app` rights on every public table. Every current public table and view is named in exactly one class. The markers in that file are the audited lists.

| Class | `sa360_app` | Objects |
| --- | --- | --- |
| Application DML | `SELECT`, `INSERT`, `UPDATE`, `DELETE`. No `TRUNCATE` | The `GRANT` between `-- app-dml:start` and `-- app-dml:end`. This is the production write set: intake, projection, portal, ordering, fulfillment, reservations, Sheets, worker dispatch, client rekey, and the nested plan and adapter rows those paths create. `historical_catalog_projection` stays in this class because its triggers are invoker and `DELETE` plus `INSERT` the projection |
| Application read | `SELECT` only | `HistoricalCampaignAlias`, `LeadAgeBandDefinition`, `historical_catalog_projection_control`, `historical_catalog_projection_source` |
| Protected | no `SELECT`, `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` | `_prisma_migrations`, `ConsentDisclosureVersion`, `FailedDispatch`, `GuidanceResourceVersion`, `HistoricalCampaignAliasEvent`, `HistoricalResaleAuthorization`, `HistoricalResaleAuthorizationEvent` |
| Summary | no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, or `TRIGGER` | The five `historical_catalog_summary_*` tables. Owner becomes `sa360_schema_owner`. The migration login keeps `SELECT` only |

`sa360_app` also receives:

| Object | `sa360_app` | `sa360_schema_owner` |
| --- | --- | --- |
| `SupportTicket_ticketNumber_seq` | `USAGE`, `SELECT` | unchanged. This is the only application insert sequence |
| Summary sequences | no `USAGE` | owned by `sa360_schema_owner` |
| `LeadInventoryItem`, `SourceLeadEvent`, `InventoryLot`, `historical_catalog_projection`, `historical_catalog_projection_source` | DML on the four tables, `SELECT` on the view | `SELECT` |
| Projection trigger functions, `historical_catalog_projection_refresh_item`, `historical_july_campaign_label_normalize`, `historical_registry_scope_key_kind`, and `historical_campaign_ownership_decision` | `EXECUTE` after `REVOKE` from `PUBLIC` | owner remains the migration login until a later boundary |
| `historical_catalog_projection_backfill_chunk`, `historical_catalog_projection_diff`, and the registry and resale routines | no `EXECUTE`. `PUBLIC` execute is revoked | owner remains the migration login, which keeps `EXECUTE` |
| `pgcrypto` routines | unchanged. Boundary A does not grant or revoke them | whoever installed the extension |
| Summary helpers after Boundary C | no direct `EXECUTE` | owner, and the function runs with that owner's rights |
| `item_trg`, `event_trg`, `lot_trg` after Boundary C | `EXECUTE` | owner-rights. The migration login also keeps `EXECUTE` on these three entrypoints so it can attach them and so a later inventory migration does not fail on the trigger. It does not keep helper, authorize, or backfill execute |
| `public` schema | `USAGE` only | `CREATE` |
| `sa360_summary` schema | no `USAGE` and no `CREATE` | owner |

Column `UPDATE` on `historical_catalog_projection_control.ready`, `verified_at`, `source_row_count`, and `projection_row_count` stays denied. The migration login still owns that table and can refresh its verification state.

These protected tables have no writer in the API, worker, or portal. DML is withheld on purpose, not because a live path was guessed away:

- `_prisma_migrations` is Prisma's history. Only the migration login writes it.
- `historical_catalog_projection_control` is read by the ownership preview. Production code does not update it.
- `ConsentDisclosureVersion` and `FailedDispatch` have no production reference. Worker failure state that does exist is `MetaDispatchAttempt`, and that table stays writable.
- `GuidanceResourceVersion` is written by `prisma/seed-guidance.ts` as the seed login, not by `sa360_app`.
- `HistoricalCampaignAlias` is read by the ownership preview, so `sa360_app` keeps `SELECT`. `HistoricalCampaignAliasEvent` is the append-only registry log and has no production writer.
- `HistoricalResaleAuthorization` and `HistoricalResaleAuthorizationEvent` have no production writer. Client rekey already refuses to rewrite them.

A later registry, consent, or seed path that runs as `sa360_app` needs its own explicit `GRANT` before that path ships. That grant is not part of Boundary A.

New public tables are not covered by Boundary A. Each later migration adds its own `GRANT` for the table and sequence it creates. New summary tables are created in `sa360_summary` and are not granted to `sa360_app`. There is no `ALTER DEFAULT PRIVILEGES` grant to `sa360_app`.

The application login does not own tables, sequences, views, or functions. Prisma `migrate deploy` stays on `doadmin` and does not `SET ROLE`.

## Default routine privileges

PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function. That built-in default is global. On disposable PostgreSQL 18.6, `ALTER DEFAULT PRIVILEGES FOR ROLE ... IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC` records nothing in `pg_default_acl` and leaves `PUBLIC` execute in place on a function created afterward. A schema-scoped revoke is not a control, and Boundary A does not contain one.

A global `ALTER DEFAULT PRIVILEGES` revoke, with no `IN SCHEMA`, does apply to functions that role creates afterward. It does not change a function that already exists. Boundary A does not install that global revoke. It would change every future routine the migration login creates, including ordinary application functions, and it would not lock down a routine created before the statement.

The control for a privileged routine is `REVOKE EXECUTE FROM PUBLIC` in the same transaction as `CREATE`. `functions.sql` already does that for every maintenance routine and does not change default privileges. Keep those statements. A migration that adds another privileged routine has to revoke `PUBLIC` in that same transaction. Assuming the schema-scoped revoke is enough leaves the new routine publicly executable.

Table and sequence `ALTER DEFAULT PRIVILEGES ... IN SCHEMA ... REVOKE` lines in Boundary A only clear a recorded grant for this role. They are not a substitute for the explicit table lists, and they do not mention functions.

## Boundary A transaction

On PostgreSQL 18.6, `CREATE ROLE` and `GRANT` membership roll back with the surrounding transaction. `prepare-ownership.sql` is one `BEGIN` ... `COMMIT`. Role creation, membership, grants, ownership, and the installer `SELECT` are inside that transaction.

A failure before `COMMIT` leaves no `sa360_%` role, no `sa360_summary` schema, no application grant, and no ownership change. Disconnect rolls the open transaction back. That was proven by cutting the script at role creation, after membership, after the application grants, after summary ownership, and immediately before `COMMIT`, then raising. Each cut left the summary control table owned by the migration login.

Do not describe an earlier statement as rolled back when that statement already committed. This script has no committed prefix. If a production operator splits the file and commits a prefix, the remaining work is a new change, not a rollback of the prefix. Recovery of that case is a separate approval. Do not run a recovery script against production as part of this change. The disposable proof never commits the injected failures.

## Search path

Every summary function uses:

```text
search_path = pg_catalog, public, pg_temp
```

`pg_temp` is last. Omitting it makes PostgreSQL search the session's temporary schema first for tables, sequences, and types. Summary relations, composite types, and nested routine calls are also qualified with `public`. The candidate has no dynamic SQL. Built-in operators resolve in `pg_catalog` first. `CREATE` on `public` is revoked from the runtime so a session cannot plant a function, operator, or cast there.

`historical_catalog_summary_backfill_range` stays an invoker because it commits. It sets the same search path with `pg_catalog.set_config` at the start of each of its transactions. Checkpoint writes live in owner-rights helpers.

## Boundaries

Do not combine two boundaries in one deploy.

### Boundary A — roles and ownership

Inspect the unprepared database with `inspect-before-boundary-a.sql`. That file is a single read-only transaction and does not include `preconditions.sql`. It is not an installer: it has no test-database guard because the authorized use is a read-only production session, and it still contains no grant, revoke, or install. `prepare-ownership.sql` still refuses a database whose name does not contain `test` and refuses a non-loopback server address. `preflight.sql` is for the later function install, after these roles exist. Do not run `preflight.sql` or `preconditions.sql` against the unprepared database.

Production inspection, read-only. Record the result. Do not treat an unverified item as already true:

- `current_user` and `server_version`. Boundary A expects the migration login. The disposable proof used PostgreSQL 18.6.
- Every `sa360%` role and its login, superuser, createrole, createdb, bypassrls, and inherit attributes.
- The summary control row: `summary_ready`, `summary_epoch`, `reconciled_epoch`, and `failure_count`, plus the five summary table counts.
- Whether any summary function, procedure, type, or trigger exists, and who owns the five summary tables and their sequences.
- The historical projection triggers and whether they are enabled.
- Projection control `ready`, `source_row_count`, `projection_row_count`, and `verified_at`.
- `pg_default_acl`.
- Unfinished or failed Prisma migrations.
- Every public routine: name, identity arguments, owner, `SECURITY DEFINER`, and `EXECUTE` ACL, including whether `PUBLIC` can execute it.
- Do not record passwords, hashes, or customer rows.

Then, in an approved window only:

Run the approved equivalent of `prepare-ownership.sql` as one transaction. Do not commit between role creation and the final checker.

- Create `sa360_schema_owner`, `sa360_summary_runtime`, `sa360_summary_operator`, and `sa360_summary_reader` as `NOLOGIN`.
- Create `sa360_app` as `LOGIN` with no password in git. Boundary A is already applied and did not set a password. The later Boundary B procedure installs it with client-side encryption. Do not set it in the database control panel and do not submit a plaintext password statement.
- Confirm the new login can connect from a non-production client before any service uses it. DigitalOcean may require the user to exist in the database control panel before the cluster accepts it.
- Grant the matrix above. Do not grant `sa360_app` write on `_prisma_migrations`, projection readiness, or any summary table.
- Transfer ownership of the five summary tables and their three sequences to `sa360_schema_owner`.
- Create schema `sa360_summary` owned by `sa360_schema_owner`. Do not grant it to `sa360_app`.
- Grant `sa360_schema_owner` and `sa360_summary_operator` to `doadmin` with `INHERIT FALSE`, `SET TRUE`.
- Grant `sa360_summary_runtime` to `sa360_app` with `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`.
- Commit only after `preconditions.sql` passes. The checker itself rolls back when it passes and raises when it fails.

Stop Boundary A if `sa360_app` owns a summary table, can update `summary_ready` or projection `ready`, can write `_prisma_migrations`, can `CREATE` in `public`, inherits or can `SET ROLE` to the owner or operator, or if the control row is not exactly one unready row. If the transaction fails before commit, the open transaction is the rollback. Do not start Boundary B.

The API and worker still use `doadmin` after Boundary A. Inventory ownership does not move. Projection triggers stay enabled. No summary trigger exists, so application behavior does not change.

### Boundary B — API and worker credentials

The executable procedure is `historical-catalog-summary-boundary-b-v1.md`. The `sa360` API app has no database component. `sa360-migrate` inherits that app's app-level `DATABASE_URL`, whose user is `doadmin`. `${sa360-postgres.DATABASE_URL}` belongs to the separate `sa360-admin-coc` app and is not the migrate job. Do not replace the app-level binding.

App Platform change, not made by this repository:

- Add a secret for the `sa360_app` connection string. Do not commit it and do not print it in build logs.
- Bind that secret to `DATABASE_URL` on `sa360-api` and `sa360-worker` only.
- Leave `sa360-migrate` with no component `DATABASE_URL`, so it keeps inheriting the app-level `doadmin` binding.
- Do not change `REDIS_URL`, webhook secrets, or Sheets flags.
- Deploy API and worker. Do not attach summary triggers in this deploy.

Order:

1. Confirm Boundary A checkers still pass.
2. Confirm the previous `doadmin` binding is still present on the migrate job. Recovery is the Boundary B controller: App Platform deployment rollback first, then one saved-spec restore. Do not depend on a file inside the API container.
3. Deploy the credential change.
4. `sa360-migrate` runs `pnpm migrate:deploy` as `doadmin`. No pending migration is success. A failed migrate fails the pre-deploy and does not switch traffic.
5. Check API `/health` and the admin service health route.
6. Check the worker process is consuming the existing queue and is not crash-looping.
7. Portal sign-in for a known internal test account, without printing the session.
8. Intake smoke: one non-production lead reaches `SourceLeadEvent` and does not get a summary membership when it is not a historical import.
9. Sheets smoke: dispatch remains off unless the existing spec already sets it. Do not enable it here. Read the worker log line that says dispatch is disabled.
10. Ordering and fulfillment smoke: an existing portal order page and a fulfillment queue page load, and a reservation write commits.

Fail the boundary and roll back if any smoke check returns permission denied, if projection refresh fails, if a summary routine appears, if `summary_ready` becomes true, or if the migrate job used `sa360_app`.

Rollback for Boundary B: from the operator host, roll the `sa360` app back to the recorded pre-change deployment with `skip_pin true`. If that rollback cannot be used, restore the saved spec once. Do not rotate the `doadmin` password. Do not drop the new roles. Roles that are unused by the services can stay until a later cleanup approval. The password procedure is only the Boundary B runbook.

### Boundary C — functions only

Run `preflight.sql` first. It must fail closed if a summary routine or trigger is already installed, if the owner role is missing, or if the control row is not exactly one unready row.

Apply `functions.sql`, then `transform-owner-rights.sql`, as `doadmin`. Do not apply `triggers.sql` in this boundary. Run `postconditions.sql`. It requires owner-rights functions, `search_path=pg_catalog, public, pg_temp`, trigger execute for the runtime, and no direct helper, authorize, or backfill execute for `sa360_app`.

Stop if `postconditions.sql` raises. Drop the new summary routines only if no summary trigger was attached. Do not drop projection functions.

### Boundary D — triggers

Apply `triggers.sql` in its own approval. Projection triggers stay enabled. Name order keeps the projection trigger ahead of the summary trigger.

Stop and drop only the three `historical_catalog_summary_*` triggers if an inventory write commits while the summary bucket does not follow, or if the control row becomes ready, or if the app can disable a trigger.

### Boundary E — backfill

The operator role runs `historical_catalog_summary_backfill_range` and reconcile. `authorize` is not called. `summary_ready` stays false. A partial backfill is not success.

### Boundary F — authorization

The operator calls `historical_catalog_summary_authorize` only after reconcile is clean. `sa360_app` must still be unable to call it. A catalog read flag is a separate approval and stays off in this plan.

## Stop conditions

Stop the open boundary, and do not start the next one, when any of these are true:

- The expected owner role is missing, or `sa360_app` owns a protected summary table.
- `sa360_app` or `sa360_summary_runtime` inherits the owner or operator, can `SET ROLE` to either, or has `ADMIN` on either.
- `sa360_app` can update `summary_ready`, the epoch, the reconciliation columns, or projection `ready`.
- `sa360_app` can read or write `_prisma_migrations`.
- `sa360_app` or the runtime role has `CREATE` on `public`.
- A required projection, intake, sequence, or function privilege from the matrix is missing.
- A summary routine or trigger exists before the boundary that is allowed to install it.
- The control table is not exactly one row, or `summary_ready` is true before Boundary F.
- API, worker, portal, intake, ordering, fulfillment, or Sheets smoke checks fail.
- The migrate job is no longer using the previous `doadmin` binding.
- A checker prints a credential or a customer row. That is itself a stop.

## What stays in place for rollback

The current `doadmin` database binding remains on `sa360-migrate` through every boundary. Boundary B's rollback is a redeploy of the previous API and worker spec onto that same binding. Point-in-time recovery creates a new cluster and is not the credential rollback. Projection, fulfillment, ordering, and Sheets triggers are not disabled. Summary triggers are dropped only if Boundary D is the boundary being undone, and only those three triggers.
