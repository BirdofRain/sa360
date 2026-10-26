/**
 * Production Boundary A proof.
 * Disposable PostgreSQL 18 only. Set SA360_G15_PG18=1 to run the database proof.
 * The candidate SQL is not a migration and this file does not change production.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  candidateDir,
  integrationUrl,
  migrate,
  psqlFile,
  repoRoot,
  scalar,
} from "./historical-catalog-summary-maintenance.harness.js";

const roleDir = join(candidateDir, "../historical-catalog-summary-role-security-v1");
const productionFile = join(roleDir, "production-boundary-a.sql");
const preflightFile = join(roleDir, "production-boundary-a-preflight.sql");
const postconditionFile = join(roleDir, "production-boundary-a-postconditions.sql");
const runbook = join(repoRoot, "docs/operations/historical-catalog-summary-boundary-a-v1.md");
const database = "defaultdb";
const decoy = "sa360_test_g15_boundary_decoy";
const run = Boolean(integrationUrl()) && process.env.SA360_G15_PG18 === "1";

function proofPort(): string {
  const url = new URL(integrationUrl());
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("refusing a non-local Boundary A proof");
  }
  if (url.port === "25060") throw new Error("refusing the managed database port");
  return url.port || "5432";
}

function roleUrl(role: string, dbName = database): string {
  return `postgresql://${encodeURIComponent(role)}@127.0.0.1:${proofPort()}/${dbName}`;
}

function asPostgres(dbName: string, sql: string): void {
  const result = spawnSync(
    "sudo",
    ["-n", "-u", "postgres", "psql", "-p", proofPort(), "-d", dbName, "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { encoding: "utf8", input: sql },
  );
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "postgres psql failed");
  }
}

function capture(role: string, sql: string, dbName = database): { status: number | null; output: string } {
  const result = spawnSync("psql", [roleUrl(role, dbName), "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    encoding: "utf8",
    input: sql,
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

function fileResult(role: string, filePath: string, dbName = database): { status: number | null; output: string } {
  const result = spawnSync("psql", [roleUrl(role, dbName), "-v", "ON_ERROR_STOP=1", "-f", filePath], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

function executableSql(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function injectFailure(stage: string): string {
  const text = readFileSync(productionFile, "utf8");
  const marker = `-- stage:${stage}`;
  const index = text.indexOf(marker);
  if (index < 0) throw new Error(`missing ${marker}`);
  return `${text.slice(0, index)}\nDO $$ BEGIN RAISE EXCEPTION 'injected failure at ${stage}'; END $$;\n`;
}

const boundaryRoles = `rolname IN (
         'sa360_app', 'sa360_schema_owner', 'sa360_summary_runtime',
         'sa360_summary_operator', 'sa360_summary_reader'
       )`;

function cleanup(): void {
  asPostgres(
    "postgres",
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname IN ('${database}', '${decoy}') AND pid <> pg_backend_pid();
     DROP DATABASE IF EXISTS ${database};
     DROP DATABASE IF EXISTS ${decoy};`,
  );
  asPostgres(
    "postgres",
    `DO $revoke$
     BEGIN
       -- doadmin grants the runtime and SET memberships. PostgreSQL records the
       -- creator admin option as granted by the bootstrap superuser, and that
       -- option cannot be revoked while the doadmin-granted membership remains.
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_runtime') THEN
         REVOKE sa360_summary_runtime FROM sa360_app GRANTED BY doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_schema_owner') THEN
         REVOKE sa360_schema_owner FROM doadmin GRANTED BY doadmin;
         REVOKE sa360_schema_owner FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_operator') THEN
         REVOKE sa360_summary_operator FROM doadmin GRANTED BY doadmin;
         REVOKE sa360_summary_operator FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_runtime') THEN
         REVOKE sa360_summary_runtime FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_reader') THEN
         REVOKE sa360_summary_reader FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
         REVOKE sa360_app FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin_group') THEN
         REVOKE doadmin_group FROM doadmin;
       END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doadmin_group')
          AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '_doadmin_managed') THEN
         REVOKE _doadmin_managed FROM doadmin_group;
       END IF;
     END
     $revoke$;`,
  );
  for (const roleName of [
    "sa360_app",
    "sa360_summary_reader",
    "sa360_summary_operator",
    "sa360_summary_runtime",
    "sa360_schema_owner",
    "doadmin",
    "doadmin_group",
    "_doadmin_managed",
    "_doadmin_monitor",
    "_dodb_repl",
    "_dodb_rewind",
    "_dodb",
    "g15_unexpected",
  ]) {
    asPostgres(
      "postgres",
      `DO $one$
       BEGIN
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
           DROP ROLE ${roleName};
         END IF;
       END
       $one$;`,
    );
  }
  asPostgres(
    "postgres",
    `DO $restore$
     BEGIN
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g15_local_db_owner')
          AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360') THEN
         ALTER ROLE g15_local_db_owner LOGIN;
         ALTER ROLE g15_local_db_owner RENAME TO sa360;
       END IF;
     END
     $restore$;`,
  );
}

describe("production boundary A files", () => {
  it("keeps the production script out of migrations and deploy wiring", () => {
    const hit = spawnSync(
      "rg",
      [
        "-n",
        "production-boundary-a",
        "-g",
        "!**/historical-catalog-summary-role-security.boundary-a.test.ts",
        "prisma/migrations",
        "package.json",
        "apps",
        "packages",
        ".github",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(hit.status, 1, `${hit.stdout ?? ""}\n${hit.stderr ?? ""}`);
    const disposable = readFileSync(join(roleDir, "prepare-ownership.sql"), "utf8");
    assert.match(disposable, /database name must contain test/);
    assert.match(disposable, /server is not local/);
  });

  it("pins one transaction, the audited body, and the preflight guard", () => {
    const production = readFileSync(productionFile, "utf8");
    const preflight = readFileSync(preflightFile, "utf8");
    const postcondition = readFileSync(postconditionFile, "utf8");
    const disposable = readFileSync(join(roleDir, "prepare-ownership.sql"), "utf8");
    const executable = executableSql(production);
    assert.equal(executable.split("\n").filter((line) => line.trim() === "BEGIN;").length, 1);
    assert.equal(executable.split("\n").filter((line) => line.trim() === "COMMIT;").length, 1);
    assert.equal(executable.includes("PASSWORD"), false);
    assert.equal(production.includes("\\ir "), false);
    assert.match(executable, /SET LOCAL statement_timeout = '30s'/);
    assert.match(executable, /SET LOCAL lock_timeout = '3s'/);
    for (const stage of [
      "during-roles",
      "after-roles",
      "after-membership",
      "after-grants",
      "after-ownership",
      "before-commit",
    ]) {
      assert.equal(production.includes(`-- stage:${stage}`), true, stage);
    }
    const marker = "REVOKE CREATE ON SCHEMA public FROM PUBLIC;";
    const audited = disposable.slice(disposable.indexOf(marker), disposable.indexOf("RESET ROLE;") + "RESET ROLE;".length);
    assert.equal(production.includes(audited), true);
    const guard = production.slice(production.indexOf("DO $guard$"), production.indexOf("$guard$;") + "$guard$;".length);
    assert.equal(preflight.includes(guard), true);
    assert.match(preflight, /REPEATABLE READ READ ONLY/);
    assert.match(postcondition, /REPEATABLE READ READ ONLY/);
    const statement = /^\s*(GRANT|REVOKE|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/m;
    assert.equal(statement.test(executableSql(preflight)), false);
    assert.equal(statement.test(executableSql(postcondition)), false);
    const hash = createHash("sha256").update(production).digest("hex");
    assert.equal(readFileSync(runbook, "utf8").includes(hash), true, hash);
  });
});

describe("production boundary A on disposable PostgreSQL 18.6", { skip: !run, timeout: 600_000 }, () => {
  before(() => {
    asPostgres("postgres", "SELECT current_setting('server_version')");
    const version = spawnSync(
      "sudo",
      ["-n", "-u", "postgres", "psql", "-p", proofPort(), "-d", "postgres", "-t", "-A", "-c", "SHOW server_version"],
      { encoding: "utf8" },
    );
    assert.match(version.stdout ?? "", /^18\./, version.stderr ?? "");
    cleanup();
    asPostgres(
      "postgres",
      `ALTER ROLE sa360 RENAME TO g15_local_db_owner;
       ALTER ROLE g15_local_db_owner NOLOGIN;`,
    );
    asPostgres(
      "postgres",
      `CREATE ROLE doadmin LOGIN NOSUPERUSER INHERIT CREATEDB CREATEROLE REPLICATION BYPASSRLS;
       CREATE ROLE doadmin_group NOLOGIN;
       CREATE ROLE _doadmin_managed NOLOGIN;
       GRANT doadmin_group TO doadmin WITH INHERIT TRUE, SET TRUE, ADMIN TRUE;
       GRANT _doadmin_managed TO doadmin_group WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;
       CREATE ROLE _dodb LOGIN SUPERUSER REPLICATION;
       CREATE ROLE _doadmin_monitor LOGIN NOSUPERUSER NOREPLICATION;
       CREATE ROLE _dodb_repl LOGIN NOSUPERUSER REPLICATION;
       CREATE ROLE _dodb_rewind LOGIN NOSUPERUSER NOREPLICATION;
       CREATE DATABASE ${database} OWNER doadmin;
       CREATE DATABASE ${decoy} OWNER doadmin;`,
    );
    const adminUrl = roleUrl("doadmin");
    migrate(adminUrl);
    asPostgres(
      database,
      `DO $owners$
       DECLARE
         signature text;
       BEGIN
         FOR signature IN
           SELECT format('%I(%s)', routine.proname, pg_get_function_identity_arguments(routine.oid))
           FROM pg_proc AS routine
           JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
           WHERE namespace.nspname = 'public'
             AND routine.proname NOT LIKE 'historical_%'
             AND pg_get_userbyid(routine.proowner) = 'doadmin'
         LOOP
           EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', signature);
         END LOOP;
       END
       $owners$;`,
    );
    const db = adminUrl;
    scalar(
      db,
      `UPDATE historical_catalog_projection_control
       SET ready = true, source_row_count = 4, projection_row_count = 4,
           verified_at = timestamptz '2026-10-22 15:08:30+00'
       WHERE singleton`,
    );
    const disposable = fileResult("doadmin", join(roleDir, "prepare-ownership.sql"));
    assert.notEqual(disposable.status, 0, disposable.output);
    assert.match(disposable.output, /database name must contain test/);
    assert.equal(scalar(db, `SELECT count(*)::text FROM pg_roles WHERE ${boundaryRoles}`), "0");

    const preflight = fileResult("doadmin", preflightFile);
    assert.equal(preflight.status, 0, preflight.output);

    scalar(db, `UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton`);
    const readyFailure = fileResult("doadmin", productionFile);
    assert.notEqual(readyFailure.status, 0, readyFailure.output);
    assert.match(readyFailure.output, /summary control or counts changed/);
    assert.equal(scalar(db, `SELECT count(*)::text FROM pg_roles WHERE ${boundaryRoles}`), "0");
    assert.equal(scalar(db, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "true");
    assert.equal(
      scalar(db, `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'historical_catalog_summary_control'`),
      "doadmin",
    );
    scalar(db, `UPDATE historical_catalog_summary_control SET summary_ready = false WHERE singleton`);

    asPostgres("postgres", "CREATE ROLE g15_unexpected LOGIN NOSUPERUSER");
    const loginFailure = fileResult("doadmin", productionFile);
    assert.notEqual(loginFailure.status, 0, loginFailure.output);
    assert.match(loginFailure.output, /login roles changed/);
    assert.equal(scalar(db, `SELECT count(*)::text FROM pg_roles WHERE ${boundaryRoles}`), "0");
    asPostgres("postgres", "DROP ROLE g15_unexpected");

    for (const stage of [
      "during-roles",
      "after-roles",
      "after-membership",
      "after-grants",
      "after-ownership",
      "before-commit",
    ]) {
      const failed = capture("doadmin", injectFailure(stage));
      assert.notEqual(failed.status, 0, `${stage}\n${failed.output}`);
      assert.match(failed.output, new RegExp(`injected failure at ${stage}`));
      assert.equal(scalar(db, `SELECT count(*)::text FROM pg_roles WHERE ${boundaryRoles}`), "0", stage);
      assert.equal(
        scalar(db, `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'historical_catalog_summary_control'`),
        "doadmin",
        stage,
      );
      assert.equal(scalar(db, `SELECT count(*)::text FROM pg_namespace WHERE nspname = 'sa360_summary'`), "0", stage);
      assert.equal(scalar(db, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false", stage);
      assert.equal(scalar(db, `SELECT source_row_count::text FROM historical_catalog_projection_control`), "4", stage);
    }

    const decoyRun = fileResult("doadmin", productionFile, decoy);
    assert.notEqual(decoyRun.status, 0, decoyRun.output);
    assert.match(decoyRun.output, /installer must be doadmin on defaultdb/);

    psqlFile(db, productionFile);
    const posted = fileResult("doadmin", postconditionFile);
    assert.equal(posted.status, 0, posted.output);
    const preconditions = fileResult("doadmin", join(roleDir, "preconditions.sql"));
    assert.equal(preconditions.status, 0, preconditions.output);
  });

  after(() => {
    if (!run) return;
    cleanup();
  });

  it("leaves summary unready and projection triggers untouched", () => {
    const db = roleUrl("doadmin");
    assert.equal(scalar(db, `SELECT current_user`), "doadmin");
    assert.match(scalar(db, `SELECT current_setting('server_version')`), /^18\./);
    assert.equal(scalar(db, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    assert.equal(scalar(db, `SELECT summary_epoch::text FROM historical_catalog_summary_control`), "0");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_label`), "0");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket`), "0");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_membership`), "0");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_checkpoint`), "0");
    assert.equal(scalar(db, `SELECT ready::text FROM historical_catalog_projection_control`), "true");
    assert.equal(scalar(db, `SELECT source_row_count::text FROM historical_catalog_projection_control`), "4");
    assert.equal(scalar(db, `SELECT projection_row_count::text FROM historical_catalog_projection_control`), "4");
    assert.equal(
      scalar(
        db,
        `SELECT coalesce(string_agg(tgname || ':' || tgenabled::text, ',' ORDER BY tgname), '')
         FROM pg_trigger
         WHERE NOT tgisinternal AND tgname LIKE 'historical_catalog_projection_%'`,
      ),
      "historical_catalog_projection_event_refresh:O,historical_catalog_projection_item_refresh:O,historical_catalog_projection_lot_refresh:O",
    );
    assert.equal(
      scalar(db, `SELECT count(*)::text FROM pg_proc WHERE proname LIKE 'historical_catalog_summary_%'`),
      "0",
    );
    const password = spawnSync(
      "sudo",
      [
        "-n",
        "-u",
        "postgres",
        "psql",
        "-p",
        proofPort(),
        "-d",
        database,
        "-t",
        "-A",
        "-c",
        "SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'sa360_app'",
      ],
      { encoding: "utf8" },
    );
    assert.equal(password.status, 0, password.stderr ?? "");
    assert.equal((password.stdout ?? "").trim(), "t");
  });

  it("keeps current doadmin intake, projection, fulfillment, Sheets, and worker writes", () => {
    const db = roleUrl("doadmin");
    const writes = capture(
      "doadmin",
      `INSERT INTO "InventoryLot" (
         id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey", "inventoryClass", status, "createdAt", "updatedAt"
       ) VALUES (
         'lot-g15', 'vet-g15', 'G15', 'manual_import', 'g15', 'vet', 'aged', 'active', now(), now()
       );
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "rawPayloadJson",
         "receivedAt", "createdAt", "updatedAt"
       ) VALUES (
         'g15-evt', 'leadcapture_io', 'leadcapture_io_nextgen', 'webhook', 'received',
         '{}'::jsonb, now(), now(), now()
       );
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       ) VALUES (
         'g15-item', 'lot-g15', 'g15-evt', now(), 'GA', 'vet',
         'leadcapture_io', 'g15', 'aged', 'available', now(), now(), now()
       );
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
         "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
       ) VALUES (
         'g15-hist-evt', 'manual_import', 'csv_import', 'bulk_import', 'approved', 'Gate 15',
         jsonb_build_object('importRequestId', 'imp-g15'), '{"campaign_name":"Gate 15"}'::jsonb,
         now(), now(), now()
       );
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       ) VALUES (
         'g15-hist-item', 'lot-g15', 'g15-hist-evt', now(), 'GA', 'vet',
         'manual_import', 'g15', 'aged', 'available', now(), now(), now()
       );
       INSERT INTO "ClientAccount" ("clientAccountId", "clientDisplayName", "updatedAt")
       VALUES ('g15-client', 'Gate 15', now());
       INSERT INTO "LeadOrder" (
         id, "orderNumber", "clientAccountId", "nicheKey", "leadVolume", "campaignType",
         "crmPackage", "createdByRole", "updatedAt"
       ) VALUES (
         'g15-order', 'G15-1', 'g15-client', 'vet', 1, 'aged', 'none', 'client', now()
       );
       INSERT INTO "FulfillmentOutbox" (id, "idempotencyKey", "sourceLeadEventId", "workType", "updatedAt")
       VALUES ('g15-outbox', 'g15-outbox', 'g15-evt', 'shadow', now());
       INSERT INTO "CompanySheetsDispatchIntent" (
         id, "idempotencyKey", kind, status, "clientAccountId", "updatedAt"
       ) VALUES (
         'g15-sheets', 'g15-sheets', 'aged_release', 'pending', 'g15-client', now()
       );
       INSERT INTO "MetaDispatchAttempt" (id, "eventUuid", "attemptNumber")
       VALUES ('g15-meta', 'g15-event', 1);
       SELECT decision FROM historical_campaign_ownership_decision(NULL, NULL, NULL);
       SELECT nextval('public."SupportTicket_ticketNumber_seq"');`,
    );
    assert.equal(writes.status, 0, writes.output);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_projection WHERE item_id = 'g15-item'`), "0");
    assert.equal(scalar(db, `SELECT item_status FROM historical_catalog_projection WHERE item_id = 'g15-hist-item'`), "available");
    assert.equal(scalar(db, `SELECT count(*)::text FROM "MetaDispatchAttempt" WHERE id = 'g15-meta'`), "1");
    assert.equal(scalar(db, `SELECT status FROM "CompanySheetsDispatchIntent" WHERE id = 'g15-sheets'`), "pending");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_membership`), "0");
    assert.equal(scalar(db, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    const migration = capture(
      "doadmin",
      `BEGIN;
       INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
       VALUES ('g15-owner-probe', 'x', 'g15-owner-probe', now(), 0);
       UPDATE historical_catalog_projection_control SET note = note;
       ROLLBACK;`,
    );
    assert.equal(migration.status, 0, migration.output);
    assert.equal(scalar(db, `SELECT count(*)::text FROM _prisma_migrations WHERE id = 'g15-owner-probe'`), "0");
    assert.equal(scalar(db, `SELECT source_row_count::text FROM historical_catalog_projection_control`), "4");
  });

  it("grants sa360_app the audited runtime path and denies protected objects", () => {
    const db = roleUrl("doadmin");
    const preview = capture(
      "sa360_app",
      `SELECT decision FROM historical_campaign_ownership_decision(NULL, NULL, NULL)`,
    );
    assert.equal(preview.status, 0, preview.output);
    const ticket = capture("sa360_app", `SELECT nextval('public."SupportTicket_ticketNumber_seq"')`);
    assert.equal(ticket.status, 0, ticket.output);
    for (const statement of [
      `SELECT count(*) FROM _prisma_migrations`,
      `UPDATE historical_catalog_projection_control SET ready = false`,
      `UPDATE historical_catalog_summary_control SET summary_ready = true`,
      `CALL historical_catalog_projection_backfill_chunk('a', 'b')`,
      `SELECT item_id FROM historical_catalog_projection_diff('a', 'b', 1)`,
      `SELECT nextval('public.historical_catalog_summary_bucket_bucket_id_seq')`,
    ]) {
      const denied = capture("sa360_app", statement);
      assert.notEqual(denied.status, 0, statement);
      assert.match(denied.output, /permission denied/i, `${statement}\n${denied.output}`);
    }
    assert.equal(scalar(db, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    assert.equal(scalar(db, `SELECT ready::text FROM historical_catalog_projection_control`), "true");
  });

  it("removes application execute from non-superuser platform logins only", () => {
    const monitor = capture(
      "_doadmin_monitor",
      `SELECT decision FROM historical_campaign_ownership_decision(NULL, NULL, NULL)`,
    );
    assert.notEqual(monitor.status, 0, monitor.output);
    assert.match(monitor.output, /permission denied/i);
    const repl = capture("_dodb_repl", `SELECT historical_catalog_projection_item_trg()`);
    assert.notEqual(repl.status, 0, repl.output);
    assert.match(repl.output, /permission denied/i);
    const rewind = capture("_dodb_rewind", `SELECT historical_catalog_projection_refresh_item(NULL)`);
    assert.notEqual(rewind.status, 0, rewind.output);
    assert.match(rewind.output, /permission denied/i);
    const superuser = capture("_dodb", `SELECT decision FROM historical_campaign_ownership_decision(NULL, NULL, NULL)`);
    assert.equal(superuser.status, 0, superuser.output);
    const crypto = capture("_doadmin_monitor", `SELECT length(gen_random_uuid()::text)`);
    assert.equal(crypto.status, 0, crypto.output);
    const db = roleUrl("doadmin");
    assert.equal(
      scalar(
        db,
        `SELECT has_function_privilege('doadmin', 'public.historical_catalog_projection_backfill_chunk(text, text)', 'EXECUTE')::text`,
      ),
      "true",
    );
  });
});
