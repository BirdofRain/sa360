# Historical campaign summary role security

Inert design. This document does not create roles, change credentials, install functions, attach triggers, backfill, or authorize `summary_ready`. The checker SQL under `prisma/candidates/historical-catalog-summary-role-security-v1/` is not a Prisma migration. Running it on a database that already meets the checks rolls back. Running it when a check fails raises.

Production remains PostgreSQL 18.6. The shared App Platform login is `doadmin`. It is the session that was inspected. `sa360-migrate` uses that same bound `DATABASE_URL`. `_prisma_migrations` does not record the role that applied a migration.

## Production ownership

Inspected read-only from the API runtime identity. No passwords, hashes, connection strings, or customer rows were read.

| Fact | Evidence |
| --- | --- |
| Server | PostgreSQL 18.6 (`server_version_num` 180006) |
| Session | `current_user`, `session_user`, and `current_role` are `doadmin` |
| Database | `defaultdb`, owned by `doadmin` |
| `doadmin` attributes | not superuser; `rolinherit`, `rolcreaterole`, `rolcreatedb`, `rolcanlogin`, `rolreplication`, and `rolbypassrls` are true |
| Other inspected roles | `doadmin_group`, `pg_database_owner`, `_doadmin_managed`, and `_doadmin_auditing` are `NOLOGIN` and not superuser |
| Membership | `doadmin` is a member of `doadmin_group` with admin, inherit, and set. That group inherits `_doadmin_managed`, which inherits `_doadmin_auditing` |
| `SET ROLE` | `doadmin` can set `pg_database_owner`, `doadmin_group`, `_doadmin_managed`, `_doadmin_auditing`, and several `pg_signal_*` / stats roles |
| `public` | owned by `pg_database_owner`. ACL grants `USAGE` to `PUBLIC` and `USAGE`/`CREATE` to `pg_database_owner`. `doadmin` has both, through inheritance |
| Default privileges | `pg_default_acl` is empty |
| Event triggers | none |
| Table owners | `doadmin` owns all 105 public tables |
| Summary and projection objects | all seven historical tables are owned by `doadmin`. `relacl` is null, so the rights are ownership, not grants |
| Summary control columns | `doadmin` has `SELECT`, `INSERT`, and `UPDATE` on every column, including `summary_ready`, `summary_epoch`, and `reconciled_epoch` |
| Summary routines and triggers | none |
| Projection routines | owner `doadmin`, invoker, not owner-rights |
| Projection triggers | three triggers, enabled (`tgenabled` `O`) |
| Latest migration | `20261022170000_historical_catalog_summary_schema_v1` finished at 8:12:27 PM Eastern on Oct 22, 2026. `rolled_back_at` is null |

`rolcreaterole` is true, and no event trigger is present, so this login is not blocked by an event trigger from creating a role. That is not approval to create one. `rolbypassrls` means row security cannot constrain this login. `doadmin` is not a superuser.

## What the runtime can do today

The API, worker, and migrate job share this owner. Separating function ownership later does not help while this login still owns the tables.

The runtime can, without `historical_catalog_summary_authorize()`:

- `UPDATE historical_catalog_summary_control`, including `summary_ready = true`, `summary_epoch`, and `reconciled_epoch`
- `UPDATE` bucket counts and memberships
- `INSERT` a checkpoint row with status `complete`
- `ALTER` or `DROP` the summary objects
- `CREATE` objects in `public`, and replace any routine it owns
- inherit `doadmin_group` and `pg_database_owner`, and `SET ROLE` to those identities

No summary routine exists in production, so an execute bypass is not available yet. Installing `functions.sql` as `doadmin` would make `doadmin` the owner. The owner keeps `EXECUTE` after `REVOKE FROM PUBLIC`. The conditional grants skip missing roles and do not remove that owner path. Those grants are for disposable tests. They are not a production installer.

## Design A

Column privileges cannot express "set `summary_ready` only to false." `GRANT UPDATE (summary_ready)` allowed a non-owner to set `true` on disposable PostgreSQL 18.6.

A before-update trigger can reject a false-to-true change for every role except an operator, and still allow a write that sets false. A non-owner cannot `DISABLE` that trigger. The table owner can. A member of the owner with `INHERIT TRUE` can also `DISABLE` the trigger and then set `true`. `INHERIT FALSE` does not confer that power until `SET ROLE`.

Design A therefore fails the production boundary twice. `doadmin` owns the table, and a maintenance role that still has table `UPDATE` can change epochs, counts, and checkpoints even if a trigger guards one boolean.

## Design B

Use the smallest split that DigitalOcean managed PostgreSQL and Prisma can actually operate.

| Role | Login | Inheritance | Duty |
| --- | --- | --- | --- |
| `doadmin` | yes | role attribute on | Migrate job only, after cutover. Not the API or worker login. Not a superuser. Has `CREATEROLE` and `BYPASSRLS` |
| `sa360_schema_owner` | no | role attribute off | Owns the five summary tables and the summary routines. `SELECT` on inventory, projection, and `historical_catalog_projection_source`. `CREATE` on `public`. After the move, the migration login keeps `SELECT` on those five tables and loses direct DML |
| `sa360_app` | yes | role attribute off | Future API and worker login. No `CREATEROLE`, `CREATEDB`, or `BYPASSRLS`. Audited DML on the application tables named in `prepare-ownership.sql`. `SELECT` only on projection control and the other read-only tables. No privilege on `_prisma_migrations`. No summary DML. No `CREATE` on `public` |
| `sa360_summary_runtime` | no | role attribute off | Execute on `item_trg`, `event_trg`, and `lot_trg` only. Helpers run inside the owner-rights call chain |
| `sa360_summary_operator` | no | role attribute off | Execute on backfill, reconcile, and `authorize`. No direct summary DML |
| `sa360_summary_reader` | no | role attribute off | Execute on `readable()` only |

Membership that has to be true:

- `sa360_app` inherits `sa360_summary_runtime` (`INHERIT TRUE`, `SET FALSE`). The app does not call `SET ROLE`.
- `sa360_app` is not a member of `sa360_schema_owner`, `sa360_summary_operator`, or `doadmin`, and cannot `SET ROLE` to them.
- `doadmin` may be a member of `sa360_schema_owner` and `sa360_summary_operator` with `INHERIT FALSE` and `SET TRUE`. Prisma `migrate deploy` does not `SET ROLE`, so ordinary migrations continue to create app tables as `doadmin`. Summary DDL stays a manual script that sets the role. `INHERIT TRUE` is rejected: the member can then update `summary_ready` and disable triggers without `SET ROLE`, which was proven.

`mark_unready` hardcodes `summary_ready = false`, allowlists the reason, and has no parameter that can set ready. A maintenance failure can clear readiness without being able to authorize it. `authorize` is a different function. Its only execute grant is the operator. It sets `summary_ready = true` only when reconcile succeeds, the epoch matches, and the row is currently false.

The committing procedure `historical_catalog_summary_backfill_range` stays invoker. PostgreSQL rejects `COMMIT` inside an owner-rights procedure (`invalid transaction termination`, SQLSTATE `2D000`) on 18.6. Checkpoint open and complete are separate functions. The future installer gives those helpers, and the other summary functions, the schema owner's identity. The procedure calls them and commits. The operator does not receive table DML.

Owner-rights requirements for that later installer:

- owner is `sa360_schema_owner`, not `sa360_app` or `doadmin`
- execute allowlists match `postconditions.sql`
- `search_path` is exactly `pg_catalog, public, pg_temp`
- summary tables, types, and routine calls are schema-qualified
- no routine takes a string of SQL
- state changes are the existing allowlisted transitions
- exceptions propagate, including `SB008` when the control row is missing, so the inventory statement rolls back
- `CREATE` on `public` is revoked from the app and from `sa360_summary_runtime`
- `sa360_app` cannot execute `mark_unready`, authorize, backfill, checkpoint helpers, or `apply_item`

`pg_temp` is listed last. PostgreSQL 18 searches an omitted temporary schema first for relations and types, before `pg_catalog`. A temporary function is not evidence about that path: the temporary schema is not searched for functions or operators. On disposable 18.6, a compatible temporary composite type was selected when `pg_temp` was omitted, and the permanent type was selected when `pg_temp` was last. A temporary table the owner could write was updated instead of the permanent table when `pg_temp` was omitted. The same call with `pg_temp` last, or with a `public.` name, updated the permanent table on a fresh session and again on a reused connection that still held the temporary table. Revoking `CREATE` on `public` still matters, because a function planted in `public` is visible to an unqualified call.

Same-block PL/pgSQL assignments survive an `EXCEPTION` subtransaction on 18.6. The apply retry does not depend on that. `historical_catalog_summary_apply_items_once` owns the composite arrays, and the retry calls that function again. A function-call subtransaction rolled a checkpoint insert back.

`readable()` reads the control row and rejects a running checkpoint. `reconcile_issues()` scans the projection. The reader grant no longer includes `reconcile_issues()`.

## PostgreSQL 18.6

Disposable local cluster `18/g13` on `127.0.0.1:5433`, Ubuntu package 18.6-1.pgdg24.04+2. No production connection. No paid database.

| Check | 18.6 result | 16.15 baseline |
| --- | --- | --- |
| Composite `apply_desired` and `apply_delta` arrays | constructed and read in memory; no summary temporary table | same candidate types |
| Function subtransaction | checkpoint insert inside a raised function rolled back | same failure model |
| `UNIQUE NULLS NOT DISTINCT` | duplicate null origin rejected; null and blank origin both fit | same constraint |
| Eight reserved updates, one bucket | `n = 8`, no negative count | two-session cases already passed; eight was added here |
| Trigger order | projection item trigger, then `historical_catalog_summary_item_apply` | same names |
| Maintenance integration | 17 passing, including deadlock retry, lock timeout, uncatchable `57014`, and failure invalidation | previously proven on 16.15 |
| Privilege suite | 6 passing | 6 passing again on 16.15 after the reader-grant change |
| Equality plan, 20,000 distinct niches | custom and generic index scans on `historical_catalog_summary_bucket_niche` | index scan required; this fixture does not use the grain index |
| `IS NOT DISTINCT FROM` | custom and generic sequential scans | sequential scans |
| Skewed niche, 4,000 `vet` grains | custom index scan on `historical_catalog_summary_bucket_import`; generic index scan on `historical_catalog_summary_bucket_niche` | custom and generic already diverged; `force_custom_plan` stays |

The 250,000-row vet latency table was not remeasured. The uniform fixture does not reproduce the PostgreSQL 16 hot-grain choice of `historical_catalog_summary_bucket_grain`. It does show that a generic plan still picks a different index from the custom plan, and that the distinct predicate still cannot use the btree.

Gate 14 uses the same cluster and a separate database, `sa360_test_g14_cutover`. The migration login is `g14_migrate`. The corrected proof replaces the earlier blanket public-table grant. `sa360_app` receives DML only on the audited application list, `SELECT` on the four read-only relations, and no privilege on `_prisma_migrations` or the other protected tables. Projection control stays readable, and its readiness columns stay non-writable. The cutover suite also cuts `prepare-ownership.sql` before `COMMIT` at role creation, after membership, after the grants, after summary ownership, and immediately before `COMMIT`. Each cut rolls back. The whole file is one transaction because `CREATE ROLE` is transactional on PostgreSQL 18.6.

A schema-scoped `REVOKE` of function default privileges is not part of the candidate. On 18.6 that statement does not remove the built-in `PUBLIC` execute grant. The maintenance file keeps a `REVOKE FROM PUBLIC` on every routine it creates. A global function default revoke was measured and rolled back. It would affect every later routine and would not change a routine that already exists, so Boundary A does not install it.

The migration login keeps `SELECT` on the five summary tables and `EXECUTE` on the three trigger functions. It does not keep summary DML or helper execute. `sa360_app` does not receive `CREATEROLE`, `BYPASSRLS`, table ownership, or `CREATE` on `public`. The migration login can still insert migration history and update projection control. `sa360_app` cannot.

## Negative tests

On the disposable 18.6 database, after ownership moved and the helpers ran as `sa360_schema_owner`:

- `sa360_app` captured a lead, reserved an allocation, wrote portal, order, fulfillment, and Sheets rows, inserted a worker dispatch attempt, and the projection and summary bucket followed the historical inventory update
- `sa360_app` could not read or write `_prisma_migrations`, could not update projection `ready`, `verified_at`, `source_row_count`, or `projection_row_count`, and could not write the protected registry, consent, guidance-version, or failed-dispatch tables
- `sa360_app` could not update `summary_ready`, `summary_epoch`, a bucket count, or insert a completed checkpoint
- `sa360_app` could not execute `authorize`, `backfill_range`, or `reconcile_issues`
- `sa360_app` could not execute `mark_unready`; a lot-key rename still cleared ready through the owner-rights trigger
- an allowlist failure and a missing control row each rolled the inventory change back
- the reader could execute `readable()` and could not update or reconcile
- an unauthorized role could not execute `mark_unready`
- the operator could not update the control row directly, and could backfill and authorize
- `sa360`, inheriting the schema owner, could set ready without `authorize`
- `SET ROLE sa360_schema_owner` could disable triggers and set ready
- `INHERIT TRUE` membership let the app do that too; `INHERIT FALSE` did not, until `SET ROLE`
- the app could not replace `authorize`
- with `CREATE` on `public`, a planted helper ran inside the owner-rights function; after the revoke, it could not

Owner-level power was tested separately from grants. The schema owner and an inheriting member bypass grants. The app login must not be either.

## Release sequence

Each boundary is a separate approval. None of them is authorized by this document. The operational steps, rollback, and stop conditions are in [historical-catalog-summary-credential-cutover-v1.md](historical-catalog-summary-credential-cutover-v1.md).

| Boundary | What it changes | Checker |
| --- | --- | --- |
| A. Role and ownership preparation | One transaction: create the `NOLOGIN` roles and `sa360_app`, grant the audited table lists, move the five summary tables and their sequences to `sa360_schema_owner`, and create empty schema `sa360_summary`. No blanket public-table grant and no function default revoke | `preflight.sql` then `preconditions.sql` |
| B. Credential cutover | Point `sa360-api` and `sa360-worker` at `sa360_app`. Leave `sa360-migrate` on the existing `doadmin` binding | API, worker, portal, queue, intake, and Sheets smoke checks |
| C. Functions only | Install `functions.sql`, then `transform-owner-rights.sql` | `postconditions.sql` before any trigger file |
| D. Trigger attachment | `triggers.sql` only | projection triggers still enabled; one unready control row |
| E. Controlled backfill | Operator `backfill_range` and reconcile. `summary_ready` stays false | reconcile issues |
| F. Operator authorization | `authorize`, then a separate read-path approval | app still cannot authorize |

`SA360_HISTORICAL_CAMPAIGN_SUMMARY_READ_ENABLED` stays unimplemented.

## Prisma and DigitalOcean

App Platform currently binds one `${sa360-postgres.DATABASE_URL}` to the API, the worker, and the pre-deploy migrate job. That binding is the escalation path. The future app spec needs a second user for the services and the original binding for migrate. Creating that user is either the control panel or `CREATE ROLE` by `doadmin`. Both are Boundary A. This repository cannot express two component URLs until that user exists, and this change does not edit the app spec.

Prisma will keep owning new app tables as `doadmin`. Empty `pg_default_acl` means `sa360_app` will not see those tables until the migration that creates them grants them. Do not add `ALTER DEFAULT PRIVILEGES` that grants table DML to `sa360_app`. On disposable 18.6 that default made a newly created `public.historical_catalog_summary_control_future` writable by the application login. Default privileges cannot exclude a future summary table by name.

Do not add a schema-scoped `ALTER DEFAULT PRIVILEGES ... REVOKE ON FUNCTIONS FROM PUBLIC` either. On disposable 18.6 that statement was not recorded and a function created afterward was still executable by `PUBLIC`. The same session's explicit `REVOKE ALL ON FUNCTION ... FROM PUBLIC` removed that grant. A global function default revoke, without `IN SCHEMA`, changed only functions created after it and was rolled back. It is not part of Boundary A. Privileged routines stay locked down by the per-routine revoke in the creating transaction.

Future summary objects go in schema `sa360_summary`, owned by `sa360_schema_owner`, with no grant to `sa360_app`. A table created there was not writable by `sa360_app`. Existing public summary tables stay where they are until a later approved move. `preconditions.sql` fails if `sa360_app` can write them, if it owns one, or if a default privilege mentions `sa360_app`.

Ordinary future migrations stay in `public` and carry an explicit `GRANT` for the new table and sequence. `future-app-migration.sql` is that pattern. It is not a Prisma migration. The migration login owned the new table; `sa360_app` could insert only after the explicit grant. A second `prisma migrate deploy` did not require the application login to own any object.

Projection refresh stays invoker and owned by `doadmin`. The app login needs `SELECT` on `historical_catalog_projection_source` or the projection trigger fails with `permission denied for view`. That grant is part of Boundary A, not a summary-table grant. The underlying `LeadInventoryItem`, `SourceLeadEvent`, and `InventoryLot` reads are required as well because the view is `security_invoker`.

## Rollback

The safe state is the current production state: no summary routines, no summary triggers, `summary_ready` false, three projection triggers enabled.

- Uncommitted role SQL ends with `ROLLBACK`.
- A committed unused role that owns nothing can be dropped. Do not drop `doadmin`. Do not revoke `doadmin`'s existing ownership of inventory or projection.
- If the app deploy fails after a credential change, redeploy the previous spec so API and worker use the existing database binding again. Do not rotate passwords to do that. Intake still runs because `doadmin` owns the inventory tables and the projection triggers.
- A migrate job that lacks permission fails the pre-deploy and does not switch traffic.
- Do not disable projection, fulfillment, ordering, or Sheets triggers while rehearsing summary rights. Summary triggers are not attached. Sheets dispatch stays off unless a separate spec sets it.

## Approvals still required

- Create roles, transfer summary ownership, and change grants or default privileges.
- Change API, worker, or migrate credentials.
- Install summary functions, including the owner-rights transformation.
- Attach summary triggers.
- Backfill or reconcile.
- Call `authorize` or enable a summary read path.
- Merge or deploy this design. Merging the inert SQL does not do any of the above, and this document does not ask for that merge.
