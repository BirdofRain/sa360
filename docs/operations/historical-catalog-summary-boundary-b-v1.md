# Historical summary Boundary B

Preparation only. Merging this package is not execution approval. Do not issue a password, edit an App Platform spec, switch a database login, install summary routines, attach summary triggers, backfill, or set `summary_ready` from this change.

Boundaries C through F remain unapproved. Boundary B does not add grants and does not change `doadmin`.

## Pin

| Item | Value |
| --- | --- |
| Boundary A commit | `5aaa9d72c08cac25ca25764b4c9ccfb0f4175b0a` |
| Production script | `prisma/candidates/historical-catalog-summary-role-security-v1/production-boundary-a.sql` |
| SHA256 | `6650bddd3f930c0ea0d35afc9ac062693e7e9fbc167e679090cc5b0520e585b5` |
| Preflight SHA256 | `014153b31d7e40c746e7e173db53ca1eb6cf13d63f25e0976a52d3f2ab0d36bb` |
| Postcondition SHA256 | `3f310efaa500944df564d2bb99a854c4b106a93c4606e6ab9f060e8a05735174` |
| API app | `2c381355-37a1-415f-bf06-ad477add164e` (`sa360`) |
| Admin app | `2075694a-ed30-4e7c-ae59-87b3ebfa9db7` (`sa360-admin-coc`), not part of this cutover |
| Active API deployment at preparation | `fb497434-b3a2-4a23-89c8-6a3b1fd5b206` |
| Active admin deployment at preparation | `73ead13f-1267-4340-befc-8aab24504882` |
| Spec fingerprint, `sa360` | `e8b6df1dfbb82e9bcaa8dc9a5c783e9b3798ea33e7259578ade3458634a0b34f` |
| Spec fingerprint, `sa360-admin-coc` | `126be00e622ca12ca57ef0afb0e12a6e4f891d1c586399fbcd862c5cd86c676e` |
| Inspection | 10:57 PM America/New_York on October 25, 2026 |

The fingerprint is `scripts/app-spec-shape.mjs`. Feed it the app `spec` object on stdin. It prints a sha256 and the class of `DATABASE_URL` and `REDIS_URL`. It does not print hosts, passwords, or ciphertext. Recompute both fingerprints at execution. A mismatch means stop.

The fingerprint is not sufficient. It does not include ordinary env values, secret ciphertext, or the database host. Execution also runs the full-structure comparison in `scripts/boundary-b/spec-plan.mjs`. The only allowed difference is the two new component env entries below.

## What was verified, read-only

Production session: database `defaultdb`, user `doadmin`, PostgreSQL 18.6, `createrole_self_grant=inherit,set`, `password_encryption=md5`, TLS on, direct port 25060, `sslmode=require`. `log_statement=none`. Statements longer than one second are duration-logged. Failed statements are error-logged. No migration is unfinished. No table has row-level security. `sa360_app` can `CONNECT` and cannot `CREATE` the database.

The five roles exist:

| Role | Login | Inherit | Superuser | Createrole | Replication | Bypass RLS |
| --- | --- | --- | --- | --- | --- | --- |
| `doadmin` | yes | yes | no | yes | yes | yes |
| `sa360_app` | yes | no | no | no | no | no |
| `sa360_schema_owner` | no | no | no | no | no | no |
| `sa360_summary_operator` | no | no | no | no | no | no |
| `sa360_summary_reader` | no | no | no | no | no | no |
| `sa360_summary_runtime` | no | no | no | no | no | no |

`sa360_app` inherits only `sa360_summary_runtime`, with `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`, grantor `doadmin`. It is not a member of `doadmin`, `sa360_schema_owner`, or `sa360_summary_operator`. It cannot read or write `_prisma_migrations`, cannot update summary control, cannot update projection `ready`, cannot `CREATE` in `public`, and cannot use schema `sa360_summary`. It can execute `historical_campaign_ownership_decision` and `historical_catalog_projection_item_trg`. It cannot execute projection backfill.

Summary control is `summary_ready=false`, epoch 0, failure count 0. Summary data tables are empty. No `historical_catalog_summary_%` function and no summary trigger exist. The three projection triggers are enabled. Projection control is ready and its two counts match and are greater than zero. The five summary tables, three summary sequences, and the other public relations whose names start with `historical_catalog_summary` are owned by `sa360_schema_owner`. The read-only count of those relations was 20.

Client backends at the inspection were `doadmin` and the platform `postgres` management agent. `sa360_app` had zero sessions. The API console and the worker console both connected as `doadmin` to `defaultdb` on port 25060. Public health returned commit `5aaa9d72c08cac25ca25764b4c9ccfb0f4175b0a`, database connected, and queue `PONG`. Portal health returned `admin-coc`. No deployment was in progress.

`pg_hba_file_rules` is not readable by `doadmin`. `GET /v2/databases` returns HTTP 403 for this token. Those two facts stay true until the execution connectivity test. Do not create a control-panel user to get around them.

## Automatic memberships

`createrole_self_grant=inherit,set` made PostgreSQL grant `doadmin` membership in each role it created. A second admin option on each role was granted by `postgres`. The explicit Boundary A grants then changed the `doadmin`-granted rows for `sa360_schema_owner` and `sa360_summary_operator` to `INHERIT FALSE`, `SET TRUE`. The rows for `sa360_app`, `sa360_summary_reader`, and `sa360_summary_runtime` stayed `INHERIT TRUE`, `SET TRUE`.

Observed memberships, and the rows this package does not change:

| Member | Role | Admin | Inherit | Set | Grantor |
| --- | --- | --- | --- | --- | --- |
| `doadmin` | `sa360_app` | no | yes | yes | `doadmin` |
| `doadmin` | `sa360_app` | yes | no | no | `postgres` |
| `doadmin` | `sa360_schema_owner` | no | no | yes | `doadmin` |
| `doadmin` | `sa360_schema_owner` | yes | no | no | `postgres` |
| `doadmin` | `sa360_summary_operator` | no | no | yes | `doadmin` |
| `doadmin` | `sa360_summary_operator` | yes | no | no | `postgres` |
| `doadmin` | `sa360_summary_reader` | no | yes | yes | `doadmin` |
| `doadmin` | `sa360_summary_reader` | yes | no | no | `postgres` |
| `doadmin` | `sa360_summary_runtime` | no | yes | yes | `doadmin` |
| `doadmin` | `sa360_summary_runtime` | yes | no | no | `postgres` |
| `sa360_app` | `sa360_summary_runtime` | no | yes | no | `doadmin` |

`doadmin` does not inherit `sa360_schema_owner`, so a normal `doadmin` statement cannot update summary control. `SET ROLE sa360_schema_owner` can. That is the reviewed migration path. Inheriting `sa360_app`, `sa360_summary_runtime`, or `sa360_summary_reader` does not grant summary writes or summary reads: those roles do not have them. Reader `SELECT` on summary control is false. Do not revoke or alter these memberships under this approval.

## App Platform bindings

Inspected without printing secret values.

`sa360` has no `databases` entry. Its app-level `DATABASE_URL` is a PostgreSQL URL, scope `RUN_AND_BUILD_TIME`, user `doadmin`, database `defaultdb`, port 25060, query key `sslmode=require`, host set, password present. `sa360-api`, `sa360-worker`, and `sa360-migrate` have no component `DATABASE_URL`, so all three inherit that URL. That is why the API and worker still use `doadmin`.

Component environment keys today:

| Component | Run command | `deploy_on_push` | `DATABASE_URL` |
| --- | --- | --- | --- |
| `sa360-api` | `pnpm --filter @sa360/api start` | true | absent, inherits app |
| `sa360-worker` | `pnpm --filter @sa360/worker start` | null | absent, inherits app |
| `sa360-migrate` | `pnpm migrate:deploy` | true | absent, inherits app |

DigitalOcean's environment-variable documentation says a component-level variable with the same name takes precedence over the app-level variable, for a runtime or build-time component variable. A component variable is not copied to other components. Adding `DATABASE_URL` only on `sa360-api` and `sa360-worker` therefore leaves `sa360-migrate` on the app-level `doadmin` URL. Do not replace the app-level binding. Replacing it would move the migrate job too.

The component override uses type SECRET and scope RUN_TIME. `SECRET` is encrypted at rest and redacted in build and runtime logs. `RUN_TIME` matches a connection string the build does not need. The documented precedence rule covers a runtime component variable. The execution proof is still the running identity, not the documentation: after deploy, the API console and the worker console must be `sa360_app`, and the migrate log must show that it could read migration history. If either identity is wrong, roll the deployment back as described below.

App-level `REDIS_URL` stays as it is. No component `REDIS_URL` is added. No historical flag exists on either app, and none is added. Webhook, Sheets, Meta, and GHL secrets stay on their current keys.

`sa360-admin-coc` is a separate app. It has a database component named `sa360-postgres` and an app-level `DATABASE_URL` of type `SECRET`. Its service has no component `DATABASE_URL`. Do not GET its secret value and do not PUT that app.

## Operator execution environment

The controller is `scripts/boundary-b/controller.mjs`. Run it on the operator host that already holds the DigitalOcean token. That host is outside the App Platform components. This package was prepared on the Cursor cloud agent that executed Boundary A. The app containers do not have `SA360_BOUNDARY_B_OPERATOR`, and the controller refuses to start without that variable set to `operator`.

State defaults to `~/.sa360-boundary-b`. The directory is mode `0700`. The saved spec and the redacted report are mode `0600`. The controller refuses a state directory inside the git checkout or inside `/opt/cursor/artifacts`. It refuses the admin app id. A production update also requires `SA360_BOUNDARY_B_ALLOW_PRODUCTION=yes`. This preparation does not set that flag and does not call an update or rollback API.

The saved file is the complete previous spec, including existing encrypted values. The new password is not written there. It stays in the operator process until the spec update. Compile `scripts/boundary-b/pq-change-password.c` with PostgreSQL 18 libpq on that same host and point `SA360_BOUNDARY_B_HELPER` at the binary. Do not copy the binary, the spec, or the password into `sa360-api` or `sa360-worker`.

Rollback does not need either component to keep running. The recorded pre-change deployment id and the saved spec are on the operator host. Replacing the API or worker container does not remove them.

## Secret provisioning

Password issuance is part of the later approval. This package does not set one. `sa360_app` was created by SQL with no `PASSWORD` clause. `password_encryption` is `md5`. Do not precompute a SCRAM verifier. Do not call the database user API, `reset_auth`, or the control panel. This token cannot list clusters, and a control-plane user is not undone by `ROLLBACK`.

Do not change the `doadmin` password, the host, the port, the database name, or `sslmode`. Do not submit a plaintext password statement. If client-side installation fails, stop. Do not fall back to a plaintext statement, and do not issue a second password in the same approval.

The installer is `scripts/boundary-b/pq-change-password`. It calls `PQchangePassword`, the non-interactive form of psql's password command. libpq encrypts with the server's `password_encryption` and sends only the verifier. The helper reads the new password on stdin, uses a mode `0600` pgpass file for the existing admin login, and accepts no arguments. It refuses `PGPASSWORD` in the environment. It refuses to continue unless `SHOW password_encryption` is `md5`. It prints `ok`, `refused`, or `fail`, disables core dumps, and zeroes its buffer. It does not print server errors, because those errors can repeat the verifier. A verifier is a credential too. Do not print it, store it, or paste it.

The controller generates the password with `crypto.randomBytes(32).toString("base64url")`. It opens the PostgreSQL connection from the operator host, not from a console inside the component that is about to be replaced. If that connection fails, stop. Do not add a trusted source under this approval.

`log_statement` is `none`, so a successful password change is not statement-logged. A failed statement is still error-logged and can include the verifier. Do not fetch server logs after a failure.

The pre-cutover probe is `productionProbeChecks` in `scripts/boundary-b/probe.mjs`. As `sa360_app`, before the spec changes, all of these are required:

- `identity`: user `sa360_app`, database `defaultdb`, port 25060, and ssl on.
- `lead_inventory`: the lead-inventory count succeeds.
- `projection_ready`: projection control `ready` is true.
- `ownership_decision`: the ownership decision select succeeds.
- `migrations_denied`: migration history is permission denied.
- `summary_denied`: a rolled-back update that assigns summary control to itself is permission denied.
- `projection_update_denied`: a rolled-back update that assigns projection `ready` to itself is permission denied.
- `backfill_denied`: `has_function_privilege` for `historical_catalog_projection_backfill_chunk(text, text)` is false. The procedure is not called.

The denial updates cannot change a stored boolean even if the grant is wrong, because they assign the column to itself and the session rolls back. Do not insert a lead, order, or customer row. Print only check names and booleans. If the probe fails, stop. Do not create the user in the control panel.

## Restricted-login proof

`apps/api/src/services/ppl-fulfillment/historical-catalog-summary-boundary-b.test.ts` runs on loopback PostgreSQL 18.6. It sets `createrole_self_grant=inherit,set` on the disposable `doadmin`, applies the exact production Boundary A script, and then uses `sa360_app` for:

- LeadCapture webhook, source event, attribution, routing rule, dry-run decision, and route schema snapshot.
- Facebook source event, webhook link, and `MetaDispatchAttempt` update.
- The same phone on two client inbound-contact rows and two buyer-delivery identity rows.
- Inventory insert, `SELECT FOR UPDATE`, reservation, and the existing projection trigger. A `leadcapture_io` item stays out of the projection. A `manual_import` item becomes one `reserved` projection row.
- Portal availability read, order, order line, and allocation.
- Fulfillment outbox, replacement request, delivery target, instruction, and attempt.
- Sheets advisory lock, worksheet lock, dispatch intent, delivery job, and delivery row.
- GHL delivery plan, plan step, adapter run, and adapter step.
- `SupportTicket` sequence use, which is the worker and API lock primitive `pg_advisory_xact_lock` / `pg_try_advisory_xact_lock`, and a delete.
- Ownership preview: `HistoricalCampaignAlias` and `LeadAgeBandDefinition` reads, projection control read, and the three preview functions.

The same login is denied migration history, summary control, projection readiness and counts, backfill, diff, the resale decision routine, summary sequence `nextval`, alias-event insert, consent, failed dispatch, guidance versions, `TRUNCATE`, `CREATE`, `SET ROLE`, and disabling a projection trigger.

The worker's only Prisma write is `MetaDispatchAttempt`. Queue state is Redis and is outside this login. No grant is added when a statement fails. The result of this proof is recorded below under privilege gaps.

`doadmin` still reads migration history. Direct summary update is denied. `SET LOCAL ROLE sa360_schema_owner` can update summary control and is rolled back. `sa360_app` has no password on the disposable cluster. Local trust authentication is not the DigitalOcean authentication test. That test is the pre-cutover probe.

## Deployment

Do this only after the approval in the last section, and only through the controller.

1. Before any password is created, `GET` the app and save the complete current spec. Run the full-structure comparison against a preview value that is discarded and never sent. The preview must show one appended env on `sa360-api` and one on `sa360-worker`:

   - key `DATABASE_URL`
   - type `SECRET`
   - scope `RUN_TIME`

   Leave `jobs[name=sa360-migrate]` without a component `DATABASE_URL`. Leave app-level `envs` unchanged, including `DATABASE_URL` and `REDIS_URL`. Leave `databases`, GitHub refs, instance sizes, domains, alerts, ingress, features, and every existing env value unchanged. Existing encrypted values are copied through and submitted again as the same ciphertext. `update_all_source_versions` is false, so a scale or env edit does not also move source versions.
2. `POST /v2/apps/2c381355-37a1-415f-bf06-ad477add164e/rollback/validate` for the current active deployment, with `skip_pin true`. This is the authorization check for `app:update` and the proof that this deployment can be restored. `valid` must be true. `401` or `403` means stop with no password and no update. There is no separate non-mutating scope probe. Do not call this during preparation.
3. Install the password and run the probe.
4. `PUT /v2/apps/2c381355-37a1-415f-bf06-ad477add164e` with the two new secrets. Do not log the body. Do not update app `2075694a-ed30-4e7c-ae59-87b3ebfa9db7`.
5. Wait for the new deployment. A spec update deploys every component, including the migrate pre-deploy job.

If the update response is lost, `GET` the app and deployments. If the spec still matches the saved spec, stop; do not send a second update. If it matches the proposed spec, watch that deployment. If it matches neither, or the `GET` fails, stop. Do not guess with another update.

## Rollback

Primary recovery is `POST /v2/apps/2c381355-37a1-415f-bf06-ad477add164e/rollback` with the recorded pre-change deployment id and `skip_pin true`. DigitalOcean creates a deployment that restores that deployment's code, configuration, and app spec, including its encrypted values. `skip_pin true` commits the rollback immediately and leaves auto-deploy enabled. `skip_pin false` would pin the app and disable auto-deploy until a later commit or revert, so the controller does not use it. Validate the same deployment id again before the rollback. This rollback does not need the replaced API container, and it does not restore database data, rotate a password, drop a role, or revoke a membership.

Fallback, used only when validate says the deployment cannot be restored or the rollback request fails: one `PUT` of the exact saved spec, with `update_all_source_versions` false. Existing encrypted values are submitted unchanged. If that response is lost, one `GET` decides whether the saved spec is current. If the rollback response and the fallback response are both ambiguous, stop. No third mutation.

App Platform can leave the previous deployment active when a new deployment fails before it is healthy, while the stored spec is already the new spec. Recover in that case too. Do not assume traffic on the old deployment means the spec was restored.

A failed cutover can leave `sa360_app` with a password that no component uses. Do not remove that password, drop the role, or issue another password in the same approval.

After the recovery deployment is `ACTIVE`:

- API console `current_user` is `doadmin`.
- Worker console `current_user` is `doadmin`.
- Database, port, and `sslmode` are unchanged.
- Health, database, queue, and portal health succeed.

If a console identity is uncertain, stop and report that state.

## Execution steps

Run `node scripts/boundary-b/controller.mjs execute` only after one explicit approval, with the operator variable and the production flag set in that shell. Stop at the first failed check. Do not widen a grant, edit SQL, change trusted sources, or retry a failed password. `preview` is read-only and does not validate, install, or update. `recover` uses only the state directory and the DigitalOcean API.

1. Confirm the active `sa360` deployment is the inert merge of this package and that `sa360-admin-coc` was not changed by this work. Confirm no deployment is in progress. Confirm API `/health`, `/health/db`, `/health/queue`, and portal `/api/health`. The spec fingerprint must still be the pinned fingerprint. A code deploy does not by itself add a component `DATABASE_URL`.
2. Run the preview. The full-structure comparison must allow only the two new secrets. Confirm `sa360-migrate` has no component `DATABASE_URL`, the app-level user is `doadmin`, and the admin app is not requested.
3. From the `sa360-api` console, rerun the read-only catalog checks: five roles, the membership table above, summary ownership, `summary_ready=false`, no summary function or trigger, three enabled projection triggers, projection ready with matching counts, zero `sa360_app` sessions, and the `sa360_app` denial bits. Confirm `createrole_self_grant=inherit,set`. Do not modify memberships. Leave the controller and its state file on the operator host.
4. Confirm the API and worker consoles are `doadmin` on `defaultdb` port 25060.
5. The controller validates the current deployment, installs the password from the operator host, and runs the probe. Both happen before the spec update.
6. The controller submits the two component secrets and waits for the deployment.
7. Read the `sa360-migrate` deployment log. Success is a migration count and `No pending migrations`. `sa360_app` cannot select `_prisma_migrations`, so that log line is the migrate identity proof. Permission denied, a new migration, or a missing log is failure. Do not print the database host from the log.
8. Open the new `sa360-api` console and the new `sa360-worker` console. Both must report `current_user=sa360_app`, database `defaultdb`, port 25060. The API console must still be denied `_prisma_migrations` and summary control, and must be able to read projection control.
9. Live checks, without inserting a synthetic customer lead: API health, database health, queue health, portal health, one existing portal order or inventory read, projection `ready=true` with matching counts, `summary_ready=false`, no summary function or trigger, and worker logs continuing at info level without a crash loop. Sheets behavior stays whatever the unchanged flags already say.
10. On any failed check after the spec update, run `node scripts/boundary-b/controller.mjs recover` from the operator host. That uses the deployment rollback first and the saved spec second. It does not need the old container. Then stop.

## Privilege gaps

No missing grant was found. The disposable PostgreSQL 18.6 proof passed 5 tests and 0 failures: `sa360_app` completed every exercised intake, inventory, portal, fulfillment, Sheets, GHL, worker, and preview statement, and every intentional denial returned `permission denied` or `must be owner`. This package does not add a `GRANT`. A later failure of that proof means Boundary B stays on hold until a separate grant review.

`scripts/boundary-b/boundary-b-operator.test.mjs` is the operator procedure proof. It uses disposable PostgreSQL 18.6 and a fake App Platform. It does not contact DigitalOcean or the managed database.

Intentional denials, not gaps: `_prisma_migrations`, summary tables and sequences, projection readiness columns, operator routines, consent and guidance versions, `FailedDispatch`, alias and resale event tables, `TRUNCATE`, `CREATE`, and `SET ROLE`.

No application table outside that deny list was missing from the static grant walk of `apps/api/src`, `apps/worker/src`, and `packages`. The walk saw 90 application DML tables, 4 read tables, 7 denied tables, and 54 referenced tables.

## Approval scope

The later approval may authorize only this:

- One client-side `PQchangePassword` for `sa360_app`. The password and its verifier are never written down. No second attempt.
- The pre-cutover probe.
- One rollback validate call, then one component `DATABASE_URL` secret on `sa360-api` and one on `sa360-worker`.
- One deploy of app `2c381355-37a1-415f-bf06-ad477add164e`.
- The live checks and, if those checks fail, one deployment rollback with `skip_pin true`, or one saved-spec restore if that rollback cannot be used. No third mutation.

It does not authorize a `doadmin` password change, a control-plane database user, a firewall change, a membership change, a new grant, a Prisma migration, summary functions or triggers, backfill, `summary_ready=true`, a historical feature flag, an admin-app change, or Boundaries C through F.
