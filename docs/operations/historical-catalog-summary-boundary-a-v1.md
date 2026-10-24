# Historical summary Boundary A

Draft execution package. This document does not create roles, change DigitalOcean, install SQL, attach triggers, backfill, or authorize `summary_ready`. Do not run `production-boundary-a.sql` until a separate approval names the commit and the execution owner.

Boundaries B through F remain unapproved. Boundary A does not change the API, worker, or migrate database binding.

## Pin

| Item | Value |
| --- | --- |
| Package base | master `5f5352abeb86db86a0a493c6b6efd0f9c100e647` |
| Production script | `prisma/candidates/historical-catalog-summary-role-security-v1/production-boundary-a.sql` |
| SHA256 | `6650bddd3f930c0ea0d35afc9ac062693e7e9fbc167e679090cc5b0520e585b5` |
| Preflight | `production-boundary-a-preflight.sql`, SHA256 `014153b31d7e40c746e7e173db53ca1eb6cf13d63f25e0976a52d3f2ab0d36bb` |
| Postconditions | `production-boundary-a-postconditions.sql`, SHA256 `3f310efaa500944df564d2bb99a854c4b106a93c4606e6ab9f060e8a05735174` |
| Privilege checker | existing `preconditions.sql`, run after the postcondition file |
| Execution owner | The reviewer who approves this package in writing. This draft does not appoint one. |
| Approved commit | Record the reviewed commit SHA at approval. It must contain this exact script checksum. |

`prepare-ownership.sql` remains the disposable script. It still refuses a database whose name does not contain `test` and a non-loopback server. Do not point it at `defaultdb`.

The script is not under `prisma/migrations` and no package script, workflow, or application startup runs it. Deploying the commit that contains the file does not execute it.

## What the approved transaction does

One `BEGIN` … `COMMIT` on PostgreSQL 18, with `statement_timeout` 30 seconds and `lock_timeout` 3 seconds.

- Creates `sa360_schema_owner`, `sa360_summary_runtime`, `sa360_summary_operator`, and `sa360_summary_reader` as `NOLOGIN`.
- Creates `sa360_app` as `LOGIN` with no password clause.
- Grants `sa360_summary_runtime` to `sa360_app` with `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`.
- Grants `sa360_schema_owner` and `sa360_summary_operator` to `doadmin` with `INHERIT FALSE`, `SET TRUE`, `ADMIN FALSE`.
- Applies the audited table, sequence, and routine allowlist from `prepare-ownership.sql`.
- Moves only the five summary tables and their three sequences to `sa360_schema_owner`.
- Creates empty schema `sa360_summary` owned by `sa360_schema_owner`, with no grant to `sa360_app`.
- Leaves `summary_ready` false, summary data empty, and the three projection triggers enabled.
- Installs no summary routine, summary trigger, backfill, reconciliation, or authorization.

Before any change, the script fails closed unless all of these are true:

- Database `defaultdb`, session user `doadmin`, PostgreSQL 18.
- `doadmin` is not a superuser and has `CREATEROLE`, `CREATEDB`, `REPLICATION`, and `BYPASSRLS`.
- Login roles are exactly `_doadmin_monitor`, `_dodb`, `_dodb_repl`, `_dodb_rewind`, `doadmin`, and `postgres`.
- `doadmin` is a member of `doadmin_group`.
- No `sa360%` role and no `sa360_summary` schema exist.
- The 106 public tables and views and the 4 public sequences match the audited names and are owned by `doadmin`.
- The 61 public routines match the audited names, identity arguments, and owners. Application routines are owned by `doadmin`. `pgcrypto` routines are owned by `postgres`. `PUBLIC` execute is still the default.
- One unready summary control row, epoch 0, and empty summary data tables.
- One ready projection control row whose source and projection counts match and are greater than zero. The count is not pinned to 250,417.
- The three projection triggers are enabled and no summary trigger exists.
- No unfinished migration, no `pg_default_acl` row, and no other session idle in a transaction.

## Database consumers

Read-only inspection at 7:49 PM America/New_York on October 23, 2026. The Gate 15 baseline at 5:46 PM America/New_York the same day was unchanged: PostgreSQL 18.6, `defaultdb`, `doadmin`, no `sa360%` roles, summary unready, projection ready with equal counts, 91 finished migrations, 61 routines, and three enabled projection triggers.

Login roles on the cluster:

| Login | Superuser | Observed sessions | After `PUBLIC` execute is revoked |
| --- | --- | --- | --- |
| `doadmin` | no | API and worker pools, plus the inspection client. `application_name` empty on the pools | Keeps execute as the owner of the 24 application routines |
| `postgres` | yes | `management-agent`, `pg_cron` launcher, replication launcher, failover slots, Timescale launcher | Keeps execute as superuser |
| `_dodb` | yes | `pghoard` WAL sender | Keeps execute as superuser |
| `_doadmin_monitor` | no | none | Loses default execute on the 24 application routines |
| `_dodb_repl` | no | none | Loses default execute on the 24 application routines |
| `_dodb_rewind` | no | none | Loses default execute on the 24 application routines |

`pg_cron` is not installed, so there is no scheduled command calling these routines. `pgcrypto` `PUBLIC` execute is not revoked.

Application consumers of the 24 routines:

- The API calls `historical_campaign_ownership_decision`, `historical_july_campaign_label_normalize`, and, through the decision function, `historical_registry_scope_key_kind`.
- Inventory writes from the API and worker fire the three projection trigger functions. Those triggers are invoker functions, so the writing login needs execute.
- `scripts/historical-catalog-projection-backfill.mjs` calls `historical_catalog_projection_backfill_chunk` and `historical_catalog_projection_diff`. It is an operator script, not the API or worker process.
- The registry and resale routines are trigger and operator functions on tables the application login must not write.

The API, worker, and migrate job all use the app-level `DATABASE_URL` whose user is `doadmin` and whose database is `defaultdb`. That binding is unchanged by Boundary A. `doadmin` remains able to perform those writes and to execute every application routine it owns.

Admin C.O.C. has no database client in its source. Its spec contains an encrypted `DATABASE_URL` and an attached database component named `sa360-postgres`; the encrypted value was not decoded. The cluster has no application login other than `doadmin`, and the session list showed no other client login. Admin C.O.C. is not a second database identity on this cluster.

No idle transaction was open during the inspection. `public` already grants `USAGE` to `PUBLIC` and `CREATE` only to `pg_database_owner`. The database owner is `doadmin`.

## Routine privilege impact

`REVOKE ALL` from `PUBLIC` on the 24 application routines removes the default execute grant. It does not remove the owner's execute. `sa360_app` then receives execute only on the seven runtime functions: the three projection triggers, `historical_catalog_projection_refresh_item`, `historical_july_campaign_label_normalize`, `historical_registry_scope_key_kind`, and `historical_campaign_ownership_decision`.

Operator routines, including backfill and diff, stay executable by `doadmin` and stop being executable by `PUBLIC`, `sa360_app`, and the three non-superuser platform logins. `postgres` and `_dodb` still can execute them because they are superusers. `pgcrypto` is untouched.

Because the API and worker remain `doadmin` for this boundary, intake, projection refresh, ordering, fulfillment, Sheets, portal API calls, and worker dispatch do not depend on the new `sa360_app` grants. Those grants are the future login's allowlist, proven on disposable PostgreSQL 18.6, and they are not switched on here.

## Managed role provisioning

DigitalOcean's managed PostgreSQL documentation, verified October 1, 2026, says additional users are added from the control panel, `doctl`, or the database user API. A user created there receives a DigitalOcean-stored password and minimal permissions. Privileges are then changed with SQL. That control-plane create is a separate operation. A PostgreSQL `ROLLBACK` does not undo it, and deleting the user in the control panel is a separate operation as well.

`doadmin` has `CREATEROLE`. The reviewed script therefore creates `sa360_app` inside the Boundary A transaction and does not set a password. DigitalOcean does not have to create the role before that transaction. Do not create `sa360_app` in the control panel as part of Boundary A.

Password issuance belongs to a later approval, not this package:

1. Generate the password outside Git. Do not put it in the repository, a pull request, a log, or this runbook.
2. From an authorized console, apply it with `ALTER ROLE sa360_app PASSWORD` using a psql variable that is not echoed.
3. Store that same value only as an App Platform secret for the future API and worker binding.
4. Prove a non-production client can connect before any service uses the role.
5. Leave the migrate job on the existing `doadmin` binding.

If that later connection test shows the managed endpoint rejects a SQL-created login, stop. A control-panel create or password reset is then its own approval. It must be checked against the postconditions afterward, because the control plane can attach its own grants and a control-plane delete is not a transaction rollback. No service binding changes until that approval exists.

## Disposable proof

The proof runs on loopback PostgreSQL 18.6. It creates a database named `defaultdb`, a non-superuser `doadmin`, and the same platform login names observed in production, migrates the current schema, and gives `postgres` ownership of the `pgcrypto` routines. It then runs this production script, not `prepare-ownership.sql`.

The proof covers a full commit, a failed summary-control precondition, an unexpected login, rollback at every stage marker, a decoy database name, `sa360_app` runtime grants, denied migration and control writes, `doadmin` migration authority, unchanged projection triggers, no summary routine or trigger, and unchanged summary readiness. `doadmin` still inserts intake, order, fulfillment, Sheets, and worker rows. A live `leadcapture_io` item stays out of `historical_catalog_projection`, which is the existing source filter. A `manual_import` / `csv_import` item still receives one projection row from the existing item trigger. Non-superuser platform logins lose application execute and keep `pgcrypto`. `sa360_app` has no password.

## Execution procedure

Run this only after the written approval records the commit SHA, this checksum, and the execution owner.

1. Confirm `git rev-parse HEAD` is the approved commit and `sha256sum` of `production-boundary-a.sql` is the checksum above.
2. Confirm the API and Admin C.O.C. deployments are active on that commit, with no deployment in progress. Health checks for the API, database, queue, and portal succeed.
3. Open the existing `sa360-api` component console. Do not change firewall rules, trusted sources, the app spec, or credentials.
4. Confirm `command -v psql` and the checksum of the three SQL files inside the container. If either file is absent or the checksum differs, stop. Do not install packages and do not copy a different file into the container.
5. Run `production-boundary-a-preflight.sql` as the existing `doadmin` session with `ON_ERROR_STOP=1`. It is `REPEATABLE READ READ ONLY` and ends in `ROLLBACK`. A raised exception means stop. Do not edit the database to make it pass.
6. Re-check health and that no deployment started while the preflight ran.
7. Run `production-boundary-a.sql` with `ON_ERROR_STOP=1`, a statement timeout of 30 seconds, and the lock timeout in the file. Do not open a second session that issues `COMMIT`.
8. On any error, stop. An aborted PostgreSQL transaction rejects a later `COMMIT` and rolls back when the session ends. Do not retry with a modified script.
9. After a reported `COMMIT`, run `production-boundary-a-postconditions.sql` and then `preconditions.sql`. Both must raise nothing and roll back.
10. Confirm API, worker, and portal health, queue health, and that migrate was not rerun. Confirm the app spec still has the same database binding and no new launch flag.

## Postcondition checklist

- `doadmin` is still the non-superuser migrate login, and the only new login is `sa360_app`.
- `sa360_app` has no password and is not a member of `doadmin`, `sa360_schema_owner`, or `sa360_summary_operator`.
- `sa360_app` inherits `sa360_summary_runtime` without `SET` or `ADMIN`.
- The five summary tables and three summary sequences are owned by `sa360_schema_owner`.
- `LeadInventoryItem` and projection control are still owned by `doadmin`.
- Summary control is one unready row. Summary data tables are empty.
- Projection control is ready and its two counts still match.
- The three projection triggers are still enabled. No summary trigger or summary routine exists.
- `PUBLIC` cannot execute the 24 application routines. `doadmin` can. `sa360_app` can execute the seven runtime routines and cannot execute backfill, diff, or resale authorization.
- `_doadmin_monitor`, `_dodb_repl`, and `_dodb_rewind` cannot execute those application routines. `postgres` and `_dodb` still can. `PUBLIC` can still execute `gen_random_uuid`.
- `sa360_app` cannot read or write `_prisma_migrations` and cannot update `summary_ready` or projection `ready`.
- `doadmin` can still insert migration history and update projection control.
- No `pg_default_acl` entry grants `sa360_app` future rights.

## Failure and recovery

Stop without retrying when the preflight fails, a deployment is in progress, health is not green, the checksum differs, or an error is raised before `COMMIT`.

If the session reports `COMMIT` and the postconditions pass, Boundary A is in its intended state. Leave it. Do not start credential cutover, function installation, trigger attachment, or backfill.

If the session reports `COMMIT` and a postcondition fails, stop. Do not drop roles, revoke grants, or recreate the user from the control panel in the same window. The script is one transaction, so a PostgreSQL commit is the whole body; a failed postcondition means the catalog is not the approved shape and needs a new reviewed recovery script. The API and worker are still on `doadmin`, which owns the application routines and the inventory tables.

If a control-panel user named `sa360_app` was created outside this script, do not treat `ROLLBACK` as removing it. Stop and review that user separately. The preflight fails closed while any unexpected login, including that user, exists.

## Dependency and security review

- No application code, Prisma migration, or app spec change is in this package.
- Current runtime authority stays with `doadmin`. The new login cannot connect until a later password approval.
- `PUBLIC` execute is removed only from the 24 application routines. The three non-superuser DigitalOcean logins lose that default. Their observed jobs are monitoring, replication, and rewind, not SA360 SQL. Superuser platform roles are unchanged.
- Summary ownership moves, and `doadmin` keeps `SELECT` plus `SET ROLE` to the owner. `INHERIT` is false, so `doadmin` does not silently gain summary writes.
- `sa360_app` is denied migration history, summary DML, projection readiness columns, and operator routines.
- The script refuses a drifted relation, routine, trigger, login, or ownership set instead of granting around it.
- Control-plane user creation is excluded because it cannot be rolled back with the transaction.
