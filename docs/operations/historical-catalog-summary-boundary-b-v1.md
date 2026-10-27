# Historical summary Boundary B

Preparation only. Merging this package is not execution approval. Do not issue a password, edit an App Platform spec, switch a database login, install summary routines, attach summary triggers, backfill, or set `summary_ready` from this change.

Boundaries C through F remain unapproved. Boundary B does not add grants and does not change `doadmin`.

## Recheck hold

Do not execute this cutover. The company Sheets grant migration is deployed. Sam-Workstation is not a trusted operator host. `OPERATOR_HOST_TRUST_UNVERIFIED`. This document does not authorize password installation or a spec update.

Production master is `28f1a657a8ff64e93336d4ea0aca5fe477d5189a`. The active `sa360` deployment is `594dfda6-af5a-4c85-9f06-ad19f2475a26`, phase `ACTIVE`, from that commit. The active admin deployment is `a4ad8211-a1cc-48d9-9a7e-297c5ec84604`. No deployment was in progress at 5:32 PM America/New_York on October 26, 2026. The admin spec fingerprint still matches its pin. The `sa360` fingerprint is the pin in the table below. `sa360-api`, `sa360-worker`, and `sa360-migrate` still have no component `DATABASE_URL`. The app-level binding is still user `doadmin`, database `defaultdb`, port 25060, `sslmode=require`. The admin app was not modified by the grant. `GET /v2/databases` is still HTTP 403. Public health returned that master commit, database connected, and queue `PONG`. Portal health returned `admin-coc`.

A later read-only reconciliation, after master moved, is recorded below. It does not replace the reviewed fingerprint pin. The controller still refuses a production update when the live `sa360` fingerprint is not that pin.

The API console and the worker console were still `doadmin` on `defaultdb` with TLS after the grant deployment. PostgreSQL 18.6, `password_encryption=md5`, and `createrole_self_grant=inherit,set` were unchanged. The five roles and the membership rows in the table below were unchanged. `summary_ready` was false. No summary function or trigger was present. Projection control was ready and its three triggers were enabled. `sa360_app` had zero sessions. Migration history had 93 finished rows and none unfinished. `20261026200000_company_sheets_setup_grants` was finished and not rolled back. No password was issued and no App Platform spec was submitted for this package.

Observed `sa360_app` privileges on the three tables owned by `doadmin`:

| Table | Allowed | Denied |
| --- | --- | --- |
| `CompanySheetsClientFolder` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | `TRUNCATE`, `REFERENCES`, `TRIGGER` |
| `CompanySheetsFolderEvent` | `SELECT`, `INSERT` | `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` |
| `CompanySheetsSpreadsheetLink` | `SELECT`, `INSERT`, `UPDATE` | `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` |

None of those grants is grantable. `PUBLIC` has no privilege on the three tables. The default ACL count was 0. The membership count was 23.

The named workstation is a Cursor private worker, `Sam-Workstation`, id `bba4624b-b86a-55ce-b513-a7638cced044`. It was idle and approved for this repository. This agent cannot place a job on it. GitHub Actions runner metadata for the repository returned HTTP 403, and the only workflow runs on `ubuntu-latest`. Direct TCP from this cloud agent to port 25060 still times out. The catalog statements ran in the API console, which is inside the component a cutover would replace. Do not add a trusted source. Do not send a database password, a database URL, or a DigitalOcean token to that worker until a credential-free probe has reported reachability. An online worker is not by itself a credential host. Password installation still has to run on a host outside the App Platform components that can already open port 25060. This agent is not that host.

The intended App Platform diff remains the two component `DATABASE_URL` overrides. This package does not add a `GRANT`.

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
| Spec fingerprint, `sa360` | `aa3742fba4496ad86c360499dba8d172c5f830545be21bc314d5e2ce8260342f` |
| Spec fingerprint, `sa360`, October 25, 2026 | `e8b6df1dfbb82e9bcaa8dc9a5c783e9b3798ea33e7259578ade3458634a0b34f` |
| Spec fingerprint, `sa360-admin-coc` | `126be00e622ca12ca57ef0afb0e12a6e4f891d1c586399fbcd862c5cd86c676e` |
| October 25 inspection | 10:57 PM America/New_York on October 25, 2026 |
| Active API deployment after the Sheets grant | `594dfda6-af5a-4c85-9f06-ad19f2475a26` |
| Active admin deployment after the Sheets grant | `a4ad8211-a1cc-48d9-9a7e-297c5ec84604` |
| Finished migrations after the Sheets grant | 93 finished |
| Baseline read | 5:32 PM America/New_York on October 26, 2026 |

The fingerprint is `scripts/app-spec-shape.mjs`. Feed it the app `spec` object on stdin. It prints a sha256 and the class of `DATABASE_URL` and `REDIS_URL`. It does not print hosts, passwords, or ciphertext. Recompute both fingerprints at execution. A mismatch means stop.

The October 25 `sa360` fingerprint is kept in the table as history. The current pin includes the already-active worker env `SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED`. That env was not added by this package or by the grant migration. The full-structure comparison still allows only the two component `DATABASE_URL` secrets.

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

## October 27 reconciliation

Read-only. No password, grant, spec update, or deployment was submitted by this reconciliation. GitHub `master` is `09c4321cdac19a47c62182e8a7717a4999595ae2`, the merge of pull request 240. Merges after `28f1a657a8ff64e93336d4ea0aca5fe477d5189a` are pull requests 235, 236, 237, and 240. No later master commit was present when the deployments below were idle.

The active `sa360` deployment is `3b942b6a-06ed-482c-8c48-cd17559439cb`, phase `ACTIVE`, cause app spec updated. Its component source commit is still `09c4321cdac19a47c62182e8a7717a4999595ae2`. The active admin deployment is `47a7e571-c5fb-467a-ba3a-0b51a663a051` from that same commit. Neither app had a deployment in progress at the end of the read. The admin fingerprint is unchanged. The observed `sa360` fingerprint is `d337d60be371bc946432f95c01ee4986d2bde8b7db34dd610041266f401bf3eb`. That value is not the execution pin. The controller pin stays `aa3742fba4496ad86c360499dba8d172c5f830545be21bc314d5e2ce8260342f`, so production execute stops before a password is installed.

The new spec keys on `sa360-api` are `SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED`, `SA360_CLIENT_ONBOARDING_V2_READ_ENABLED`, and `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED`, each true. No component `DATABASE_URL` was added. The app-level binding is still user `doadmin`, database `defaultdb`, port 25060, `sslmode=require`. API and worker consoles both reported `current_user=doadmin` through the component exec socket. That console query is the runtime identity method. An operator-host connection as `sa360_app` is not that proof.

Migration history has 94 finished rows, none unfinished, and none rolled back. `20261026233000_client_onboarding_v2_persistence` finished. The nine onboarding tables are owned by `doadmin`. `sa360_app` has the migration's grants: full DML except `TRUNCATE`, `REFERENCES`, and `TRIGGER` on seven tables; `SELECT`, `INSERT`, and `DELETE` on `ClientOnboardingTestAttemptKey`; `SELECT`, `INSERT`, and `UPDATE` on `ClientOnboardingV2AuditEvent`. `PUBLIC` has no DML on those tables. None of those grants are grantable. Default ACL count is 0. The fifteen `client_onboarding_v2_` functions are invoker functions owned by `doadmin`, with the built-in `PUBLIC` execute grant and no `search_path` setting. Their triggers are enabled. Revoking `PUBLIC` execute without a separate `sa360_app` execute grant would break those triggers, and this package does not do that. No production grant is missing for the merged API paths.

`sa360_app` is still denied migration history, `CREATE` on `public`, `USAGE` on `sa360_summary`, summary control, and projection `ready` updates. It is a member of `sa360_summary_runtime` only. The eleven `sa360%` membership rows match the table above. `summary_ready` is false, with zero summary functions and triggers. Projection is ready, both counts are 250417, and three projection triggers are enabled. Sheets dispatch intents had four completed rows. Execution and dispatch flags are already true. This package does not change them.

`OPERATOR_HOST_TRUST_UNVERIFIED`. Sam-Workstation reported an active `PUABundler:Win32/CandyOpen` detection and a blocked severe PowerShell detection, `Trojan:PowerShell/Powdow.HNBV!MTB`. No security incident review has cleared that host. Do not send the DigitalOcean token, production database credentials, or a saved spec there. Ubuntu 24.04 WSL2 does not isolate those secrets from the Windows host.

A trusted operator environment is a separate clean Linux host that is not that workstation, with a short-lived DigitalOcean token limited to App Platform read and update. This token already cannot list databases. Password installation stays on that clean host. Do not create that token, open port 25060, or add a trusted source in this change.

## Post-ACTIVE validation

Deployment phase `ACTIVE` is not success. After the cutover deployment becomes `ACTIVE`, the same execute process collects evidence and calls `recover` when a required check fails or the collection is lost. Recovery uses the saved pre-change deployment and then one saved-spec update. It does not install another password and does not ask for another approval inside that process. A later manual `recover` still requires `SA360_BOUNDARY_B_OPERATOR=operator` and `SA360_BOUNDARY_B_ALLOW_PRODUCTION=yes`.

The checks are: migrate log completed with catalog-read identity `doadmin` and no migrate `DATABASE_URL`; API and worker `current_user=sa360_app` on `defaultdb` port 25060 with TLS, from the component console only; API, database, queue, and admin health; restricted grants and denials on both components; summary inactive, including a doadmin read of `summary_ready` because `sa360_app` cannot select that table; projection ready with matching counts and three enabled triggers; non-destructive Sheets, intake, and onboarding privilege checks. Missing evidence fails closed. The recovery deployment's own `ACTIVE` phase does not re-enter these checks.

Production execute also requires `SA360_PROD_API_URL` and `SA360_BOUNDARY_B_ADMIN_HEALTH_URL` before it installs a password. The migrate identity remains the catalog-read inference. The job does not leave a process whose `current_user` can be queried.

## Operator execution environment

The controller is `scripts/boundary-b/controller.mjs`. Do not run it on Sam-Workstation. Ubuntu 24.04 LTS WSL2 on that Windows host is not a credential boundary. `OPERATOR_HOST_TRUST_UNVERIFIED`. Host remediation and a completed incident review are separate prerequisites. A later approved execution needs a separate clean Linux host, outside the App Platform components, that can already open port 25060. Do not add a trusted source for the untrusted workstation. Do not copy the DigitalOcean token, a database URL, a database password, or a saved App Platform specification onto it. The app containers do not have `SA360_BOUNDARY_B_OPERATOR`, and the controller refuses to start without that variable set to `operator`.

State defaults to `~/.sa360-boundary-b`. The directory is mode `0700`. The saved spec and the redacted report are mode `0600`. The controller refuses a state directory inside the git checkout or inside `/opt/cursor/artifacts`. It refuses the admin app id. A production update also requires `SA360_BOUNDARY_B_ALLOW_PRODUCTION=yes`. This preparation does not set that flag and does not call an update or rollback API.

The saved file is the complete previous spec, including existing encrypted values. The new password is not written there. It stays in the operator process until the spec update. Compile `scripts/boundary-b/pq-change-password.c` with PostgreSQL 18 libpq on that same host and point `SA360_BOUNDARY_B_HELPER` at the binary. Do not copy the binary, the spec, the CA, or the password into `sa360-api` or `sa360-worker`.

Rollback does not need either component to keep running. The recorded pre-change deployment id and the saved spec are on the operator host. Replacing the API or worker container does not remove them.

The project CA is the DigitalOcean control-panel CA already verified for this cluster. Copy that file into a private directory outside the git checkout and outside production artifacts. Point `SA360_BOUNDARY_B_ROOT_CERT` at that copy. The controller and the password helper accept it only when it is a regular file, not a symbolic link, owned by the operator user, mode `0600` or stricter, readable, and reachable through parent directories that are not group- or world-writable. A root-owned sticky directory such as the system temporary directory may appear above a private directory. A missing, unreadable, linked, or unsafe CA fails closed, and the failure report does not include the path. Do not install that CA into the system trust store. Do not commit the CA file, a password, a database URL, a token, or a saved App Platform specification.

Operator connections are separate from the deployed runtime URLs. The password helper, the password installer, and the pre-cutover probe pass libpq connection parameters of `sslmode=verify-full`, `gssencmode=disable`, and `sslrootcert` set to `SA360_BOUNDARY_B_ROOT_CERT`. Those parameters override an inherited `PGSSLMODE`, `PGGSSENCMODE`, or an admin URL that says `sslmode=require`. The helper checks that the connection is using SSL and is not using GSS encryption before it calls `PQchangePassword`. If the operator TLS mode or the CA is absent, the helper refuses before connecting and does not use libpq's default connection settings. `sslmode=disable`, `allow`, and `prefer` are rejected before a password is generated. The only plaintext path is the disposable loopback test, and it is refused when `SA360_BOUNDARY_B_ALLOW_PRODUCTION=yes`.

The app-level binding and the two component `DATABASE_URL` overrides stay `sslmode=require`. Do not put `verify-full`, `gssencmode`, or `sslrootcert` into the App Platform spec. The API and worker containers do not receive the project CA.

## Secret provisioning

Password issuance is part of the later approval. This package does not set one. `sa360_app` was created by SQL with no `PASSWORD` clause. `password_encryption` is `md5`. Do not precompute a SCRAM verifier. Do not call the database user API, `reset_auth`, or the control panel. This token cannot list clusters, and a control-plane user is not undone by `ROLLBACK`.

Do not change the `doadmin` password, the host, the port, the database name, or the runtime `sslmode=require`. The operator session still uses `sslmode=verify-full` and `gssencmode=disable` with `SA360_BOUNDARY_B_ROOT_CERT`. Do not submit a plaintext password statement. If client-side installation fails, stop. Do not fall back to a plaintext statement, and do not issue a second password in the same approval.

The installer is `scripts/boundary-b/pq-change-password`. It calls `PQchangePassword`, the non-interactive form of psql's password command. libpq encrypts with the server's `password_encryption` and sends only the verifier. The helper reads the new password on stdin, uses a mode `0600` pgpass file for the existing admin login, and accepts no arguments. It refuses `PGPASSWORD` in the environment. It refuses to continue unless the connection is using SSL, GSS encryption is off, and `SHOW password_encryption` is `md5`. It prints `ok`, `refused`, or `fail`, disables core dumps, and zeroes its buffer. It does not print server errors, because those errors can repeat the verifier. A verifier is a credential too. Do not print it, store it, or paste it.

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
6. The controller submits the two component secrets and waits for the deployment. Phase `ACTIVE` is not success. The same process then runs the post-ACTIVE checks above. A failed or lost check recovers immediately. That recovery does not install another password and does not ask for another approval.
7. Read the `sa360-migrate` deployment log. Success is a migration count and `No pending migrations`. `sa360_app` cannot select `_prisma_migrations`, so that log line is the migrate identity proof. Permission denied, a new migration, or a missing log is failure. Do not print the database host from the log.
8. Open the new `sa360-api` console and the new `sa360-worker` console. Both must report `current_user=sa360_app`, database `defaultdb`, port 25060. The API console must still be denied `_prisma_migrations` and summary control, and must be able to read projection control.
9. Live checks, without inserting a synthetic customer lead: API health, database health, queue health, portal health, one existing portal order or inventory read, projection `ready=true` with matching counts, `summary_ready=false`, no summary function or trigger, and worker logs continuing at info level without a crash loop. Sheets behavior stays whatever the unchanged flags already say.
10. If the automatic recovery did not run, run `node scripts/boundary-b/controller.mjs recover` from the trusted operator host. Keep `SA360_BOUNDARY_B_OPERATOR` set to `operator` and `SA360_BOUNDARY_B_ALLOW_PRODUCTION` set to `yes` in that shell. Recover uses the same production guard as execute and stops with `production_disabled` when the flag is absent. That command uses the deployment rollback first and the saved spec second. It does not need the old container and it does not install another password. Then stop.

## Privilege gaps

The company Sheets setup grants are the finished migration `20261026200000_company_sheets_setup_grants`. This package does not add a `GRANT`. The disposable PostgreSQL 18.6 proof applies Boundary A on the schema that excludes that migration, `20261023220000_company_sheets_setup_links`, and `20261026233000_client_onboarding_v2_persistence`, then applies those three. The onboarding migration's own conditional grants are what `sa360_app` receives. The proof inserts and updates through those grants, including an attempt and its key in one transaction and the audit attribution update. Update of an attempt key, delete of an audit row, and `TRUNCATE` stay denied by missing privileges. `sa360_app` inserts, updates, and deletes `CompanySheetsClientFolder`, inserts `CompanySheetsFolderEvent`, and inserts and updates `CompanySheetsSpreadsheetLink`. Update and delete of a folder event, delete of a spreadsheet link, and `TRUNCATE` of all three stay denied. `TRUNCATE`, `REFERENCES`, and `TRIGGER` are not granted, and `PUBLIC` receives no grant.

`scripts/boundary-b/boundary-b-operator.test.mjs` is the operator procedure proof. It uses disposable PostgreSQL 18.6 and a fake App Platform. It does not contact DigitalOcean or the managed database.

Intentional denials, not gaps: `_prisma_migrations`, summary tables and sequences, projection readiness columns, operator routines, consent and guidance versions, `FailedDispatch`, alias and resale event tables, `TRUNCATE`, `CREATE`, `SET ROLE`, folder-event update and delete, spreadsheet-link delete, and `TRUNCATE` of the three Sheets setup tables.

The static grant walk recorded before the Sheets setup tables existed saw 90 application DML tables, 4 read tables, 7 denied tables, and 54 referenced tables in `apps/api/src`, `apps/worker/src`, and `packages`. The three setup tables are covered by the grant migration and the disposable proof above.

## Approval scope

The later approval may authorize only this:

- One client-side `PQchangePassword` for `sa360_app`. The password and its verifier are never written down. No second attempt.
- The pre-cutover probe.
- One rollback validate call, then one component `DATABASE_URL` secret on `sa360-api` and one on `sa360-worker`.
- One deploy of app `2c381355-37a1-415f-bf06-ad477add164e`.
- The live checks and, if those checks fail, one deployment rollback with `skip_pin true`, or one saved-spec restore if that rollback cannot be used. No third mutation.

It does not authorize a `doadmin` password change, a control-plane database user, a firewall change, a membership change, a new grant, a Prisma migration, summary functions or triggers, backfill, `summary_ready=true`, a historical feature flag, an admin-app change, or Boundaries C through F.
