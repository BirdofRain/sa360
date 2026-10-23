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

`prepare-ownership.sql` is the disposable form of Boundary A. On the migrated schema it grants `sa360_app` the following, and nothing broader:

| Object | `sa360_app` | `sa360_schema_owner` |
| --- | --- | --- |
| Existing public tables other than `historical_catalog_summary_*` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | owner remains the migration login |
| Five summary tables | no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, or `TRIGGER` | owner. The migration login keeps `SELECT` only, so a checker can count the control row after ownership moves |
| Summary sequences | no `USAGE` | owner |
| Other public sequences | `USAGE`, `SELECT` | unchanged |
| `historical_catalog_projection_source` | `SELECT` | `SELECT` |
| `LeadInventoryItem`, `SourceLeadEvent`, `InventoryLot`, `historical_catalog_projection` | ordinary DML | `SELECT` |
| Existing public functions and procedures, including projection refresh and its three triggers | `EXECUTE` | owner remains the migration login |
| Summary helpers after Boundary C | no direct `EXECUTE` | owner, and the function runs with that owner's rights |
| `item_trg`, `event_trg`, `lot_trg` after Boundary C | `EXECUTE` | owner-rights. The migration login also keeps `EXECUTE` on these three entrypoints so it can attach them and so a later inventory migration does not fail on the trigger. It does not keep helper, authorize, or backfill execute |
| `public` schema | `USAGE` only | `CREATE` |
| `sa360_summary` schema | no `USAGE` and no `CREATE` | owner |

New public tables are not covered by that grant. Each later migration adds its own `GRANT` for the table and sequence it creates. New summary tables are created in `sa360_summary` and are not granted to `sa360_app`. There is no `ALTER DEFAULT PRIVILEGES` grant to `sa360_app`.

The application login does not own tables, sequences, views, or functions. Prisma `migrate deploy` stays on `doadmin` and does not `SET ROLE`.

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

Production preflight, read-only:

- `current_user` is `doadmin`, not `sa360_app`.
- Server is PostgreSQL 18.6.
- No `historical_catalog_summary_%` routine or trigger exists.
- Exactly one `historical_catalog_summary_control` row, and `summary_ready` is false.
- Three projection triggers are enabled.
- `pg_default_acl` has no grant to a role named `sa360_app`.
- Record role names and whether `sa360_app` already exists. Do not record passwords or hashes.

Then, in an approved window only:

- Create `sa360_schema_owner`, `sa360_summary_runtime`, `sa360_summary_operator`, and `sa360_summary_reader` as `NOLOGIN`.
- Create `sa360_app` as `LOGIN` with no password in git. Set the password in the DigitalOcean database user control, or with `ALTER ROLE` in that same window, and store it only as an App Platform secret.
- Confirm the new login can connect from a non-production client before any service uses it. DigitalOcean may require the user to exist in the database control panel before the cluster accepts it.
- Transfer ownership of the five summary tables and their three sequences to `sa360_schema_owner`.
- Grant the matrix above. Revoke summary DML and summary sequence usage from `sa360_app`.
- Create schema `sa360_summary` owned by `sa360_schema_owner`. Do not grant it to `sa360_app`.
- Grant `sa360_schema_owner` and `sa360_summary_operator` to `doadmin` with `INHERIT FALSE`, `SET TRUE`.
- Grant `sa360_summary_runtime` to `sa360_app` with `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`.
- Run `preconditions.sql`. It rolls back when it passes and raises when it fails.

Stop Boundary A if `sa360_app` owns a summary table, can update `summary_ready`, can `CREATE` in `public`, inherits or can `SET ROLE` to the owner or operator, or if the control row is not exactly one unready row.

The API and worker still use `doadmin` after Boundary A. Inventory ownership does not move. Projection triggers stay enabled. No summary trigger exists, so application behavior does not change.

### Boundary B — API and worker credentials

Migrate login stays `${sa360-postgres.DATABASE_URL}`.

App Platform change, not made by this repository:

- Add a secret for the `sa360_app` connection string. Do not commit it and do not print it in build logs.
- Bind that secret to `DATABASE_URL` on `sa360-api` and `sa360-worker` only.
- Leave the `sa360-migrate` pre-deploy job on `${sa360-postgres.DATABASE_URL}`.
- Do not change `REDIS_URL`, webhook secrets, or Sheets flags.
- Deploy API and worker. Do not attach summary triggers in this deploy.

Order:

1. Confirm Boundary A checkers still pass.
2. Confirm the previous `doadmin` binding is still present on the migrate job and can be restored to the API and worker by redeploying the previous spec.
3. Deploy the credential change.
4. `sa360-migrate` runs `pnpm migrate:deploy` as `doadmin`. No pending migration is success. A failed migrate fails the pre-deploy and does not switch traffic.
5. Check API `/health` and the admin service health route.
6. Check the worker process is consuming the existing queue and is not crash-looping.
7. Portal sign-in for a known internal test account, without printing the session.
8. Intake smoke: one non-production lead reaches `SourceLeadEvent` and does not get a summary membership when it is not a historical import.
9. Sheets smoke: dispatch remains off unless the existing spec already sets it. Do not enable it here. Read the worker log line that says dispatch is disabled.
10. Ordering and fulfillment smoke: an existing portal order page and a fulfillment queue page load, and a reservation write commits.

Fail the boundary and roll back if any smoke check returns permission denied, if projection refresh fails, if a summary routine appears, if `summary_ready` becomes true, or if the migrate job used `sa360_app`.

Rollback for Boundary B: redeploy the previous app spec so API and worker use the existing `doadmin` binding again. Do not rotate the `doadmin` password. Do not drop the new roles. Roles that are unused by the services can stay until a later cleanup approval.

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
- `sa360_app` can update `summary_ready`, the epoch, or the reconciliation columns.
- `sa360_app` or the runtime role has `CREATE` on `public`.
- A required projection, intake, sequence, or function privilege from the matrix is missing.
- A summary routine or trigger exists before the boundary that is allowed to install it.
- The control table is not exactly one row, or `summary_ready` is true before Boundary F.
- API, worker, portal, intake, ordering, fulfillment, or Sheets smoke checks fail.
- The migrate job is no longer using the previous `doadmin` binding.
- A checker prints a credential or a customer row. That is itself a stop.

## What stays in place for rollback

The current `doadmin` database binding remains on `sa360-migrate` through every boundary. Boundary B's rollback is a redeploy of the previous API and worker spec onto that same binding. Point-in-time recovery creates a new cluster and is not the credential rollback. Projection, fulfillment, ordering, and Sheets triggers are not disabled. Summary triggers are dropped only if Boundary D is the boundary being undone, and only those three triggers.
