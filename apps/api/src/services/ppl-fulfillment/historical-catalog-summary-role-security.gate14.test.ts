/**
 * Gate 14 credential-cutover proof.
 * Disposable PostgreSQL 18 only. Set SA360_G14_PG18=1 to run.
 * The candidate SQL is not a migration and this file does not change production.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  candidateDir,
  integrationUrl,
  loadCandidate,
  localDatabaseUrl,
  migrate,
  psql,
  psqlCapture,
  psqlFile,
  repoRoot,
  scalar,
} from "./historical-catalog-summary-maintenance.harness.js";

const database = "sa360_test_g14_cutover";
const roleDir = join(candidateDir, "../historical-catalog-summary-role-security-v1");
const run = Boolean(integrationUrl()) && process.env.SA360_G14_PG18 === "1";

function port(): string {
  return new URL(localDatabaseUrl("sa360")).port || "5432";
}

function roleUrl(role: string): string {
  const url = new URL(localDatabaseUrl(database));
  url.username = role;
  url.password = "";
  return url.toString();
}

function asPostgres(dbName: string, sql: string): void {
  const result = spawnSync(
    "sudo",
    ["-n", "-u", "postgres", "psql", "-p", port(), "-d", dbName, "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { encoding: "utf8", input: sql },
  );
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "postgres psql failed");
  }
}

function capture(role: string, sql: string): { status: number | null; output: string } {
  const result = spawnSync("psql", [roleUrl(role), "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    encoding: "utf8",
    input: sql,
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

function captureAsync(role: string, sql: string): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("psql", [roleUrl(role), "-v", "ON_ERROR_STOP=1", "-c", sql]);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", (status) => resolve({ status, output }));
  });
}

function injectFailure(stage: string): string {
  const text = readFileSync(join(roleDir, "prepare-ownership.sql"), "utf8");
  const marker = `-- stage:${stage}`;
  const index = text.indexOf(marker);
  if (index < 0) throw new Error(`missing ${marker}`);
  return `${text.slice(0, index)}\nDO $$ BEGIN RAISE EXCEPTION 'injected failure at ${stage}'; END $$;\n`;
}

function quotedNames(sql: string, start: string, end: string): string[] {
  const slice = sql.slice(sql.indexOf(start), sql.indexOf(end));
  return [...slice.matchAll(/public\.(?:"([^"]+)"|([a-z0-9_]+))/g)].map((match) => match[1] ?? match[2]);
}

function executableSql(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function sqlList(names: string[]): string {
  return names.map((name) => `'${name.replaceAll("'", "''")}'`).join(", ");
}

function fileResult(role: string, filePath: string): { status: number | null; output: string } {
  const result = spawnSync("psql", [roleUrl(role), "-v", "ON_ERROR_STOP=1", "-f", filePath], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

describe("historical catalog summary role security gate 14 files", () => {
  it("keeps role preparation outside prisma migrations", () => {
    const hit = spawnSync(
      "rg",
      ["-n", "sa360_app|prepare-ownership|sa360_schema_owner", "prisma/migrations"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(hit.status, 1, `${hit.stdout ?? ""}\n${hit.stderr ?? ""}`);
  });

  it("revokes PUBLIC execute on every maintenance routine in the creating transaction", () => {
    const functionsSql = readFileSync(join(candidateDir, "functions.sql"), "utf8");
    const creates = functionsSql.match(/^CREATE (?:OR REPLACE )?(?:FUNCTION|PROCEDURE)\s/gm) ?? [];
    const revokes = functionsSql.match(/^REVOKE ALL ON (?:FUNCTION|PROCEDURE)\s.+ FROM PUBLIC;/gm) ?? [];
    assert.equal(revokes.length, creates.length);
    assert.equal(creates.length > 0, true);
    assert.equal(functionsSql.includes("ALTER DEFAULT PRIVILEGES"), false);
    const prepareSql = executableSql(readFileSync(join(roleDir, "prepare-ownership.sql"), "utf8"));
    assert.equal(prepareSql.includes("BEGIN"), true);
    assert.equal(prepareSql.trimEnd().endsWith("COMMIT;"), true);
    assert.equal(prepareSql.split("\n").filter((line) => line.trim() === "BEGIN;").length, 1);
    assert.equal(prepareSql.split("\n").filter((line) => line.trim() === "COMMIT;").length, 1);
  });
});

describe("historical catalog summary role security gate 14", { skip: !run, timeout: 600_000 }, () => {
  before(() => {
    asPostgres(
      "postgres",
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = '${database}' AND pid <> pg_backend_pid();
       DROP DATABASE IF EXISTS ${database};
       DO $role$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g14_migrate') THEN
           CREATE ROLE g14_migrate LOGIN NOSUPERUSER INHERIT CREATEDB CREATEROLE BYPASSRLS NOREPLICATION;
         END IF;
       END
       $role$;
       CREATE DATABASE ${database} OWNER g14_migrate;`,
    );
    const migrateUrl = roleUrl("g14_migrate");
    migrate(migrateUrl);
    assert.equal(scalar(migrateUrl, "SELECT current_user"), "g14_migrate");
    assert.equal(
      scalar(migrateUrl, `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'LeadInventoryItem'`),
      "g14_migrate",
    );
    for (const stage of [
      "during-roles",
      "after-membership",
      "after-grants",
      "after-ownership",
      "before-commit",
    ]) {
      const failed = capture("g14_migrate", injectFailure(stage));
      assert.notEqual(failed.status, 0, `${stage}\n${failed.output}`);
      assert.match(failed.output, new RegExp(`injected failure at ${stage}`));
      assert.equal(
        scalar(migrateUrl, `SELECT count(*)::text FROM pg_roles WHERE rolname LIKE 'sa360\\_%'`),
        "0",
        stage,
      );
      assert.equal(
        scalar(
          migrateUrl,
          `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'historical_catalog_summary_control'`,
        ),
        "g14_migrate",
        stage,
      );
      assert.equal(
        scalar(migrateUrl, `SELECT count(*)::text FROM pg_namespace WHERE nspname = 'sa360_summary'`),
        "0",
        stage,
      );
      assert.equal(
        scalar(migrateUrl, `SELECT count(*)::text FROM pg_default_acl WHERE defaclacl::text LIKE '%sa360_app%'`),
        "0",
        stage,
      );
    }
    psqlFile(migrateUrl, join(roleDir, "prepare-ownership.sql"));
    const preflight = fileResult("g14_migrate", join(roleDir, "preflight.sql"));
    assert.equal(preflight.status, 0, preflight.output);
    const steady = fileResult("g14_migrate", join(roleDir, "preconditions.sql"));
    assert.equal(steady.status, 0, steady.output);
    loadCandidate(migrateUrl, false);
    const installed = fileResult("g14_migrate", join(roleDir, "preflight.sql"));
    assert.notEqual(installed.status, 0);
    assert.match(installed.output, /summary routine is already installed/);
    psqlFile(migrateUrl, join(roleDir, "transform-owner-rights.sql"));
    psql(
      migrateUrl,
      `GRANT sa360_app TO g14_migrate WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;`,
    );
    psql(
      migrateUrl,
      `INSERT INTO "InventoryLot" (
         id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey", "inventoryClass", status, "createdAt", "updatedAt"
       ) VALUES
         ('lot-g14', 'vet-g14', 'G14', 'manual_import', 'g14', 'vet', 'aged', 'active', now(), now()),
         ('lot-g14-live', 'live-g14', 'G14 live', 'leadcapture_io', 'g14', 'vet', 'aged', 'active', now(), now());
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
         "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
       )
       SELECT 'g14-evt-' || g, 'manual_import', 'csv_import', 'bulk_import', 'approved', 'Gate 14',
              jsonb_build_object('importRequestId', 'imp-g14'), '{"campaign_name":"Gate 14"}'::jsonb,
              now(), now(), now()
       FROM generate_series(1, 8) g;
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       )
       SELECT 'g14-item-' || g, 'lot-g14', 'g14-evt-' || g, now(), 'GA', 'vet',
              'manual_import', 'g14', 'aged', 'available', now(), now(), now()
       FROM generate_series(1, 8) g;`,
    );
    psqlFile(migrateUrl, join(candidateDir, "triggers.sql"));
    const post = fileResult("g14_migrate", join(roleDir, "postconditions.sql"));
    assert.equal(post.status, 0, post.output);
  });

  after(() => {
    if (!run) return;
    asPostgres(
      "postgres",
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = '${database}' AND pid <> pg_backend_pid();
       DROP DATABASE IF EXISTS ${database};
       DO $drop$
       BEGIN
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g14_decoy') THEN
           DROP ROLE g14_decoy;
         END IF;
       EXCEPTION WHEN OTHERS THEN
         NULL;
       END
       $drop$;
       DO $drop2$
       BEGIN
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_runtime') THEN
             REVOKE sa360_summary_runtime FROM sa360_app;
           END IF;
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_schema_owner') THEN
             REVOKE sa360_schema_owner FROM sa360_app;
           END IF;
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_operator') THEN
             REVOKE sa360_summary_operator FROM sa360_app;
           END IF;
         END IF;
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g14_migrate') THEN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_schema_owner') THEN
             REVOKE sa360_schema_owner FROM g14_migrate;
           END IF;
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_operator') THEN
             REVOKE sa360_summary_operator FROM g14_migrate;
           END IF;
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
             REVOKE sa360_app FROM g14_migrate;
           END IF;
         END IF;
       EXCEPTION WHEN OTHERS THEN
         NULL;
       END
       $drop2$;`,
    );
    for (const roleName of [
      "sa360_app",
      "sa360_summary_reader",
      "sa360_summary_operator",
      "sa360_summary_runtime",
      "sa360_schema_owner",
      "g14_migrate",
    ]) {
      asPostgres(
        "postgres",
        `DO $one$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
             EXECUTE 'DROP OWNED BY ${roleName} CASCADE';
             EXECUTE 'DROP ROLE ${roleName}';
           END IF;
         EXCEPTION WHEN OTHERS THEN
           NULL;
         END
         $one$;`,
      );
    }
  });

  it("gives sa360_app the runtime closure without ownership or public CREATE", () => {
    const db = roleUrl("g14_migrate");
    assert.match(scalar(db, "SELECT current_setting('server_version')"), /^18\./);
    assert.equal(
      scalar(
        db,
        `SELECT string_agg(setting, ' ')
         FROM unnest((
           SELECT proconfig FROM pg_proc
           WHERE proname = 'historical_catalog_summary_apply_items_once'
         )) AS setting`,
      ).includes("search_path=pg_catalog, public, pg_temp"),
      true,
    );
    assert.match(
      scalar(db, `SELECT proconfig::text FROM pg_proc WHERE proname = 'historical_catalog_summary_apply_items_once'`),
      /plan_cache_mode=force_custom_plan/,
    );
    const prepareSql = readFileSync(join(roleDir, "prepare-ownership.sql"), "utf8");
    const executable = executableSql(prepareSql);
    assert.doesNotMatch(executable, /ON ALL TABLES IN SCHEMA public/i);
    assert.doesNotMatch(executable, /ON FUNCTIONS/i);
    for (const statement of executable.split(";")) {
      if (!/ALTER DEFAULT PRIVILEGES/i.test(statement)) continue;
      assert.match(statement, /IN SCHEMA/i, statement);
      assert.doesNotMatch(statement, /FUNCTION/i, statement);
    }
    const dmlTables = quotedNames(prepareSql, "-- app-dml:start", "-- app-dml:end");
    const readTables = quotedNames(prepareSql, "-- app-read:start", "-- app-read:end");
    const deniedTables = quotedNames(prepareSql, "-- app-deny:start", "-- app-deny:end");
    const summaryTables = [
      "historical_catalog_summary_label",
      "historical_catalog_summary_bucket",
      "historical_catalog_summary_membership",
      "historical_catalog_summary_checkpoint",
      "historical_catalog_summary_control",
    ];
    assert.ok(dmlTables.includes("historical_catalog_projection"));
    assert.ok(dmlTables.includes("LeadInventoryItem"));
    assert.ok(dmlTables.includes("LeadAllocation"));
    assert.ok(readTables.includes("historical_catalog_projection_control"));
    assert.ok(deniedTables.includes("_prisma_migrations"));
    const seen = new Map<string, string>();
    for (const [label, names] of [
      ["dml", dmlTables],
      ["read", readTables],
      ["denied", deniedTables],
      ["summary", summaryTables],
    ] as const) {
      for (const name of names) {
        assert.equal(seen.has(name), false, `${name} is listed as ${seen.get(name)} and ${label}`);
        seen.set(name, label);
      }
    }
    const classified = [...seen.keys()];
    const dmlList = sqlList(dmlTables);
    const readList = sqlList(readTables);
    const missing = scalar(
      db,
      `SELECT coalesce(string_agg(name, ', ' ORDER BY name), '')
       FROM unnest(ARRAY[${sqlList(classified)}]::text[]) AS name
       WHERE to_regclass(format('public.%I', name)) IS NULL`,
    );
    assert.equal(missing, "");
    const unclassified = scalar(
      db,
      `SELECT coalesce(string_agg(relation.relname, ', ' ORDER BY relation.relname), '')
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relkind IN ('r', 'p', 'v', 'm')
         AND relation.relname <> ALL (ARRAY[${sqlList(classified)}]::text[])`,
    );
    assert.equal(unclassified, "");
    const gaps = scalar(
      db,
      `SELECT coalesce(string_agg(relname, ', ' ORDER BY relname), '')
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relkind = 'r'
         AND relation.relname IN (${dmlList})
         AND (
           NOT has_table_privilege('sa360_app', relation.oid, 'SELECT')
           OR NOT has_table_privilege('sa360_app', relation.oid, 'INSERT')
           OR NOT has_table_privilege('sa360_app', relation.oid, 'UPDATE')
           OR NOT has_table_privilege('sa360_app', relation.oid, 'DELETE')
           OR pg_get_userbyid(relation.relowner) = 'sa360_app'
         )`,
    );
    assert.equal(gaps, "");
    const readGaps = scalar(
      db,
      `SELECT coalesce(string_agg(relname, ', ' ORDER BY relname), '')
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname IN (${readList})
         AND (
           NOT has_table_privilege('sa360_app', relation.oid, 'SELECT')
           OR has_table_privilege('sa360_app', relation.oid, 'INSERT')
           OR has_table_privilege('sa360_app', relation.oid, 'UPDATE')
           OR has_table_privilege('sa360_app', relation.oid, 'DELETE')
           OR has_table_privilege('sa360_app', relation.oid, 'TRUNCATE')
         )`,
    );
    assert.equal(readGaps, "");
    const protectedWrite = scalar(
      db,
      `SELECT coalesce(string_agg(relname, ', ' ORDER BY relname), '')
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relkind = 'r'
         AND relation.relname IN (${sqlList(deniedTables)})
         AND (
           has_table_privilege('sa360_app', relation.oid, 'SELECT')
           OR has_table_privilege('sa360_app', relation.oid, 'INSERT')
           OR has_table_privilege('sa360_app', relation.oid, 'UPDATE')
           OR has_table_privilege('sa360_app', relation.oid, 'DELETE')
           OR has_table_privilege('sa360_app', relation.oid, 'TRUNCATE')
         )`,
    );
    assert.equal(protectedWrite, "");
    const summaryWritable = scalar(
      db,
      `SELECT coalesce(string_agg(relname, ', '), '')
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relkind = 'r'
         AND relation.relname LIKE 'historical_catalog_summary_%'
         AND (
           has_table_privilege('sa360_app', relation.oid, 'INSERT')
           OR has_table_privilege('sa360_app', relation.oid, 'UPDATE')
           OR has_table_privilege('sa360_app', relation.oid, 'DELETE')
           OR has_table_privilege('sa360_app', relation.oid, 'TRUNCATE')
           OR pg_get_userbyid(relation.relowner) = 'sa360_app'
         )`,
    );
    assert.equal(summaryWritable, "");
    assert.equal(
      scalar(db, `SELECT has_schema_privilege('sa360_app', 'public', 'CREATE')::text`),
      "false",
    );
    assert.equal(
      scalar(db, `SELECT has_schema_privilege('sa360_summary_runtime', 'public', 'CREATE')::text`),
      "false",
    );
    assert.equal(
      scalar(db, `SELECT rolsuper::text || rolcreaterole::text || rolbypassrls::text FROM pg_roles WHERE rolname = 'sa360_app'`),
      "falsefalsefalse",
    );
    assert.equal(
      scalar(db, `SELECT has_table_privilege('g14_migrate', 'public.historical_catalog_summary_control', 'UPDATE')::text`),
      "false",
    );
    assert.equal(
      scalar(db, `SELECT pg_has_role('g14_migrate', 'sa360_schema_owner', 'USAGE')::text`),
      "false",
    );
    assert.equal(
      scalar(db, `SELECT pg_has_role('g14_migrate', 'sa360_schema_owner', 'SET')::text`),
      "true",
    );
    const routineGaps = scalar(
      db,
      `SELECT coalesce(string_agg(proname, ', ' ORDER BY proname), '')
       FROM pg_proc AS routine
       JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
       WHERE namespace.nspname = 'public'
         AND routine.proname NOT LIKE 'historical_catalog_summary_%'
         AND NOT has_function_privilege('sa360_app', routine.oid, 'EXECUTE')`,
    );
    assert.equal(routineGaps, "");
  });

  it("runs portal, ordering, fulfillment, Sheets, intake, projection, and worker writes as sa360_app", () => {
    const app = capture(
      "sa360_app",
      `SELECT ready FROM historical_catalog_projection_control;
       SELECT count(*) FROM "LeadAgeBandDefinition";
       SELECT count(*) FROM "HistoricalCampaignAlias";
       INSERT INTO "ClientAccount" ("clientAccountId", "clientDisplayName", "updatedAt")
       VALUES ('g14-client', 'Gate 14', now());
       UPDATE "ClientAccount" SET "portalEnabled" = true, "updatedAt" = now()
       WHERE "clientAccountId" = 'g14-client';
       INSERT INTO "LeadOrder" (
         id, "orderNumber", "clientAccountId", "nicheKey", "leadVolume", "campaignType",
         "crmPackage", "createdByRole", "updatedAt"
       ) VALUES (
         'g14-order', 'G14-1', 'g14-client', 'vet', 1, 'aged', 'none', 'client', now()
       );
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "rawPayloadJson",
         "receivedAt", "createdAt", "updatedAt"
       ) VALUES (
         'g14-live-evt', 'leadcapture_io', 'leadcapture_io_nextgen', 'webhook', 'received',
         '{}'::jsonb, now(), now(), now()
       );
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       ) VALUES (
         'g14-live-item', 'lot-g14-live', 'g14-live-evt', now(), 'GA', 'vet',
         'leadcapture_io', 'g14', 'aged', 'available', now(), now(), now()
       );
       INSERT INTO "FulfillmentOutbox" (id, "idempotencyKey", "sourceLeadEventId", "workType", "updatedAt")
       VALUES ('g14-outbox', 'g14-outbox', 'g14-live-evt', 'shadow', now());
       INSERT INTO "CompanySheetsDispatchIntent" (
         id, "idempotencyKey", kind, status, "clientAccountId", "updatedAt"
       ) VALUES (
         'g14-sheets', 'g14-sheets', 'aged_release', 'pending', 'g14-client', now()
       );
       INSERT INTO "MetaDispatchAttempt" (id, "eventUuid", "attemptNumber")
       VALUES ('g14-meta', 'g14-event', 1);
       INSERT INTO "LeadAllocation" (
         id, "sourceLeadEventId", "leadOrderId", "clientAccountId",
         "allocationPolicyVersion", "idempotencyKey", "updatedAt"
       ) VALUES (
         'g14-alloc', 'g14-evt-4', 'g14-order', 'g14-client', 'g14', 'g14-alloc', now()
       );
       UPDATE "LeadAllocation"
       SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
       WHERE id = 'g14-alloc';
       UPDATE "LeadInventoryItem"
       SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
       WHERE id = 'g14-item-4';`,
    );
    assert.equal(app.status, 0, app.output);
    const db = roleUrl("g14_migrate");
    assert.equal(scalar(db, `SELECT "portalEnabled"::text FROM "ClientAccount" WHERE "clientAccountId" = 'g14-client'`), "true");
    assert.equal(scalar(db, `SELECT status::text FROM "LeadOrder" WHERE id = 'g14-order'`), "submitted");
    assert.equal(scalar(db, `SELECT status::text FROM "FulfillmentOutbox" WHERE id = 'g14-outbox'`), "pending");
    assert.equal(scalar(db, `SELECT status FROM "CompanySheetsDispatchIntent" WHERE id = 'g14-sheets'`), "pending");
    assert.equal(scalar(db, `SELECT count(*)::text FROM "MetaDispatchAttempt" WHERE id = 'g14-meta'`), "1");
    assert.equal(scalar(db, `SELECT status::text FROM "LeadAllocation" WHERE id = 'g14-alloc'`), "reserved");
    for (const statement of [
      `SELECT count(*) FROM _prisma_migrations`,
      `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
       VALUES ('g14-mig', 'x', 'g14', now(), 0)`,
      `UPDATE _prisma_migrations SET checksum = checksum`,
      `DELETE FROM _prisma_migrations`,
      `TRUNCATE _prisma_migrations`,
      `UPDATE historical_catalog_projection_control SET ready = true`,
      `UPDATE historical_catalog_projection_control SET verified_at = now()`,
      `UPDATE historical_catalog_projection_control SET source_row_count = 1`,
      `UPDATE historical_catalog_projection_control SET projection_row_count = 1`,
      `DELETE FROM historical_catalog_projection_control`,
      `TRUNCATE historical_catalog_projection_control`,
      `UPDATE "FailedDispatch" SET id = id`,
      `UPDATE "ConsentDisclosureVersion" SET id = id`,
      `UPDATE "GuidanceResourceVersion" SET id = id`,
      `UPDATE "HistoricalCampaignAliasEvent" SET id = id`,
      `UPDATE "HistoricalResaleAuthorization" SET id = id`,
      `UPDATE "HistoricalResaleAuthorizationEvent" SET id = id`,
      `INSERT INTO historical_catalog_summary_control (singleton, summary_ready, summary_epoch)
       VALUES (true, true, 1)`,
      `UPDATE historical_catalog_summary_bucket SET n = n`,
      `DELETE FROM historical_catalog_summary_membership`,
      `TRUNCATE historical_catalog_summary_label`,
    ]) {
      const denied = capture("sa360_app", statement);
      assert.notEqual(denied.status, 0, statement);
      assert.match(denied.output, /permission denied/i, `${statement}\n${denied.output}`);
    }
    assert.equal(scalar(db, `SELECT ready::text FROM historical_catalog_projection_control`), "false");
    const migrationWrite = capture(
      "g14_migrate",
      `BEGIN;
       UPDATE historical_catalog_projection_control SET note = note;
       INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
       VALUES ('g14-owner-probe', 'x', 'g14-owner-probe', now(), 0);
       ROLLBACK;`,
    );
    assert.equal(migrationWrite.status, 0, migrationWrite.output);
    assert.equal(scalar(db, `SELECT count(*)::text FROM _prisma_migrations WHERE id = 'g14-owner-probe'`), "0");
    assert.equal(scalar(db, `SELECT ready::text FROM historical_catalog_projection_control`), "false");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_projection WHERE item_id = 'g14-live-item'`), "0");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_membership WHERE item_id = 'g14-live-item'`), "0");
    assert.equal(scalar(db, `SELECT item_status FROM historical_catalog_projection WHERE item_id = 'g14-item-4'`), "reserved");
    assert.equal(
      scalar(
        db,
        `SELECT b.item_status
         FROM historical_catalog_summary_membership AS membership
         JOIN historical_catalog_summary_bucket AS b ON b.bucket_id = membership.bucket_id
         WHERE membership.item_id = 'g14-item-4'`,
      ),
      "reserved",
    );
  });

  it("keeps temporary tables and types from redirecting owner-rights maintenance", () => {
    const shadow = `
      SET search_path = pg_temp, public, pg_catalog;
      -- Compatible shapes, without LIKE INCLUDING ALL. That clause copies
      -- BIGSERIAL defaults, and those defaults call the permanent sequences
      -- the application login cannot use. The attack still plants a row the
      -- owner could update if a routine resolved the temporary name.
      CREATE TEMP TABLE historical_catalog_summary_control (
        singleton boolean PRIMARY KEY,
        summary_ready boolean NOT NULL,
        summary_epoch bigint NOT NULL,
        reconciled_epoch bigint,
        reconciled_at timestamptz,
        invalidated_at timestamptz,
        invalidation text,
        failure_count bigint NOT NULL DEFAULT 0,
        note text,
        CHECK (singleton)
      );
      INSERT INTO pg_temp.historical_catalog_summary_control (singleton, summary_ready, summary_epoch, note)
      VALUES (true, true, 999, 'TEMP-SHADOW');
      CREATE TEMP TABLE historical_catalog_summary_label (
        label_pair_id bigint PRIMARY KEY,
        july_label text,
        normalized_label text,
        label_hash text NOT NULL
      );
      CREATE TEMP TABLE historical_catalog_summary_bucket (
        bucket_id bigint PRIMARY KEY,
        lot_key text NOT NULL,
        raw_lot_key text,
        import_request text NOT NULL,
        label_pair_id bigint NOT NULL,
        normalized_label text,
        july_label text,
        origin_id text,
        niche_key text NOT NULL,
        raw_niche_key text,
        item_status text NOT NULL,
        label_agreement text NOT NULL,
        n integer NOT NULL,
        touched_epoch bigint NOT NULL DEFAULT 0
      );
      INSERT INTO pg_temp.historical_catalog_summary_bucket (
        bucket_id, lot_key, import_request, label_pair_id, niche_key, item_status, label_agreement, n
      ) VALUES (1, 'temp', 'temp', 1, 'temp', 'temp', 'temp', 50);
      CREATE TEMP TABLE historical_catalog_summary_membership (
        item_id text PRIMARY KEY,
        bucket_id bigint,
        accounted boolean NOT NULL,
        applied_at timestamptz,
        CHECK (accounted = (bucket_id IS NOT NULL))
      );
      INSERT INTO pg_temp.historical_catalog_summary_membership (item_id, accounted)
      VALUES ('g14-item-1', false);
      CREATE TEMP TABLE historical_catalog_summary_checkpoint (
        chunk_id bigint PRIMARY KEY,
        range_after text NOT NULL,
        range_until text NOT NULL,
        status text NOT NULL,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz,
        items_applied integer,
        note text,
        CHECK (status IN ('running', 'complete', 'failed'))
      );
      CREATE TYPE pg_temp.historical_catalog_summary_apply_desired AS (
        item_id text, old_bucket_id bigint, old_accounted boolean, has_projection boolean,
        label_pair_id bigint, new_bucket_id bigint, lot_key text, raw_lot_key text,
        import_request text, normalized_label text, july_label text, origin_id text,
        niche_key text, raw_niche_key text, item_status text, label_agreement text
      );
      CREATE TYPE pg_temp.historical_catalog_summary_apply_delta AS (bucket_id bigint, delta integer);
      GRANT ALL ON TABLE
        pg_temp.historical_catalog_summary_control,
        pg_temp.historical_catalog_summary_bucket,
        pg_temp.historical_catalog_summary_membership,
        pg_temp.historical_catalog_summary_label,
        pg_temp.historical_catalog_summary_checkpoint
      TO sa360_schema_owner;
      UPDATE "LeadInventoryItem"
      SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
      WHERE id = 'g14-item-1';
      UPDATE "LeadInventoryItem"
      SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
      WHERE id = 'g14-item-2';
      SELECT historical_catalog_summary_authorize();
    `;
    const reused = capture("sa360_app", shadow);
    assert.notEqual(reused.status, 0);
    assert.match(reused.output, /permission denied/i);
    assert.doesNotMatch(reused.output, /TEMP-SHADOW/);
    const db = roleUrl("g14_migrate");
    assert.equal(
      scalar(
        db,
        `SELECT b.item_status
         FROM historical_catalog_summary_membership AS membership
         JOIN historical_catalog_summary_bucket AS b ON b.bucket_id = membership.bucket_id
         WHERE membership.item_id IN ('g14-item-1', 'g14-item-2')
         GROUP BY b.item_status`,
      ),
      "reserved",
    );
    assert.equal(
      scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_control WHERE note = 'TEMP-SHADOW'`),
      "0",
    );
    assert.equal(scalar(db, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    const fresh = capture(
      "sa360_app",
      `SET search_path = pg_temp, public, pg_catalog;
       UPDATE "LeadInventoryItem"
       SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
       WHERE id = 'g14-item-3';
       SELECT historical_catalog_summary_checkpoint_open('', 'g14-item-3');`,
    );
    assert.notEqual(fresh.status, 0);
    assert.match(fresh.output, /permission denied/i);
    assert.equal(scalar(db, `SELECT item_status FROM historical_catalog_projection WHERE item_id = 'g14-item-3'`), "reserved");
    assert.equal(
      scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_checkpoint WHERE range_until = 'g14-item-3'`),
      "0",
    );
  });

  it("denies direct authorization through inheritance, SET, and ADMIN options", () => {
    for (const statement of [
      `UPDATE historical_catalog_summary_control SET summary_ready = true`,
      `UPDATE historical_catalog_summary_control SET summary_epoch = summary_epoch + 1`,
      `UPDATE historical_catalog_summary_control SET reconciled_epoch = 1`,
      `UPDATE historical_catalog_summary_membership SET accounted = false`,
      `INSERT INTO historical_catalog_summary_checkpoint (range_after, range_until, status) VALUES ('', 'z', 'complete')`,
      `SELECT historical_catalog_summary_authorize()`,
      `CALL historical_catalog_summary_backfill_range('', 'g14-item-1')`,
      `SELECT historical_catalog_summary_mark_unready('maintenance', false)`,
      `SELECT historical_catalog_summary_checkpoint_open('', 'g14-item-1')`,
      `ALTER TABLE "LeadInventoryItem" DISABLE TRIGGER historical_catalog_summary_item_apply`,
      `ALTER TABLE historical_catalog_summary_control OWNER TO sa360_app`,
    ]) {
      const denied = capture("sa360_app", `SET ROLE sa360_app; ${statement};`);
      assert.notEqual(denied.status, 0, statement);
      assert.match(denied.output, /permission denied|must be owner/i, `${statement}\n${denied.output}`);
    }
    const asRuntime = capture(
      "sa360_app",
      `SET ROLE sa360_summary_runtime;
       SELECT historical_catalog_summary_authorize();`,
    );
    assert.notEqual(asRuntime.status, 0);
    assert.match(asRuntime.output, /permission denied/i);
    const triggerEntry = capture(
      "sa360_app",
      `SELECT historical_catalog_summary_item_trg();`,
    );
    assert.notEqual(triggerEntry.status, 0);
    assert.match(triggerEntry.output, /trigger functions can only be called as triggers/i);
    assert.doesNotMatch(triggerEntry.output, /permission denied/i);

    asPostgres(database, `CREATE ROLE g14_decoy NOLOGIN;`);
    const noAdmin = capture("sa360_app", `GRANT sa360_schema_owner TO g14_decoy;`);
    assert.notEqual(noAdmin.status, 0);
    assert.match(noAdmin.output, /permission denied/i);
    asPostgres(database, `GRANT sa360_schema_owner TO sa360_app WITH INHERIT TRUE, SET TRUE, ADMIN TRUE;`);
    const inherited = capture(
      "sa360_app",
      `UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;`,
    );
    assert.equal(inherited.status, 0, inherited.output);
    const adminGrant = capture("sa360_app", `GRANT sa360_schema_owner TO g14_decoy;`);
    assert.equal(adminGrant.status, 0, adminGrant.output);
    // sa360_app is the grantor of the decoy membership. postgres did not make
    // that grant, and revoking the admin member while the dependent grant
    // remains is rejected.
    const revokeDecoy = capture("sa360_app", `REVOKE sa360_schema_owner FROM g14_decoy;`);
    assert.equal(revokeDecoy.status, 0, revokeDecoy.output);
    asPostgres(
      database,
      `REVOKE sa360_schema_owner FROM sa360_app;
       GRANT sa360_schema_owner TO sa360_app WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;`,
    );
    const setHeld = capture(
      "sa360_app",
      `UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;`,
    );
    assert.notEqual(setHeld.status, 0);
    assert.match(setHeld.output, /permission denied/i);
    const switched = capture(
      "sa360_app",
      `SET ROLE sa360_schema_owner;
       UPDATE historical_catalog_summary_control SET summary_ready = false WHERE singleton;`,
    );
    assert.equal(switched.status, 0, switched.output);
    asPostgres(database, `REVOKE sa360_schema_owner FROM sa360_app; DROP ROLE g14_decoy;`);
    psql(roleUrl("g14_migrate"), `SET ROLE sa360_summary_operator; SELECT historical_catalog_summary_mark_unready('maintenance', false);`);
    assert.equal(scalar(roleUrl("g14_migrate"), `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
  });

  it("requires an explicit routine revoke because a schema-scoped default revoke does not stick", () => {
    const schemaScoped = capture(
      "g14_migrate",
      `BEGIN;
       ALTER DEFAULT PRIVILEGES FOR ROLE g14_migrate IN SCHEMA public
         REVOKE ALL ON FUNCTIONS FROM PUBLIC;
       CREATE FUNCTION public.g14_schema_revoke_probe() RETURNS boolean
       LANGUAGE sql AS $$ SELECT true $$;
       SELECT 'schema_public_exec=' || has_function_privilege(
         'public', 'public.g14_schema_revoke_probe()', 'EXECUTE'
       )::text;
       SELECT 'schema_recorded=' || count(*)::text
       FROM pg_default_acl
       WHERE defaclrole = 'g14_migrate'::regrole
         AND defaclnamespace = 'public'::regnamespace
         AND defaclobjtype = 'f';
       ROLLBACK;`,
    );
    assert.equal(schemaScoped.status, 0, schemaScoped.output);
    assert.match(schemaScoped.output, /schema_public_exec=true/);
    assert.match(schemaScoped.output, /schema_recorded=0/);

    const explicit = capture(
      "g14_migrate",
      `BEGIN;
       CREATE FUNCTION public.g14_explicit_revoke_probe() RETURNS boolean
       LANGUAGE sql AS $$ SELECT true $$;
       REVOKE ALL ON FUNCTION public.g14_explicit_revoke_probe() FROM PUBLIC;
       SELECT 'explicit_public_exec=' || has_function_privilege(
         'public', 'public.g14_explicit_revoke_probe()', 'EXECUTE'
       )::text;
       ROLLBACK;`,
    );
    assert.equal(explicit.status, 0, explicit.output);
    assert.match(explicit.output, /explicit_public_exec=false/);

    const globalDefault = capture(
      "g14_migrate",
      `BEGIN;
       CREATE FUNCTION public.g14_before_default_probe() RETURNS boolean
       LANGUAGE sql AS $$ SELECT true $$;
       ALTER DEFAULT PRIVILEGES FOR ROLE g14_migrate
         REVOKE ALL ON FUNCTIONS FROM PUBLIC;
       CREATE FUNCTION public.g14_after_default_probe() RETURNS boolean
       LANGUAGE sql AS $$ SELECT true $$;
       SELECT 'before_public_exec=' || has_function_privilege(
         'public', 'public.g14_before_default_probe()', 'EXECUTE'
       )::text;
       SELECT 'after_public_exec=' || has_function_privilege(
         'public', 'public.g14_after_default_probe()', 'EXECUTE'
       )::text;
       ROLLBACK;`,
    );
    assert.equal(globalDefault.status, 0, globalDefault.output);
    assert.match(globalDefault.output, /before_public_exec=true/);
    assert.match(globalDefault.output, /after_public_exec=false/);

    const db = roleUrl("g14_migrate");
    assert.equal(
      scalar(db, `SELECT count(*)::text FROM pg_proc WHERE proname LIKE 'g14\\_%probe'`),
      "0",
    );
    assert.equal(
      scalar(
        db,
        `SELECT count(*)::text FROM pg_default_acl
         WHERE defaclrole = 'g14_migrate'::regrole AND defaclobjtype = 'f'`,
      ),
      "0",
    );
  });

  it("rejects default grants and accepts an explicit future migration", () => {
    const db = roleUrl("g14_migrate");
    const unsafe = capture(
      "g14_migrate",
      `BEGIN;
       ALTER DEFAULT PRIVILEGES FOR ROLE g14_migrate IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sa360_app;
       CREATE TABLE public.historical_catalog_summary_control_future (summary_ready boolean);
       SELECT has_table_privilege('sa360_app', 'public.historical_catalog_summary_control_future', 'UPDATE')::text;
       ROLLBACK;`,
    );
    assert.equal(unsafe.status, 0, unsafe.output);
    assert.match(unsafe.output, /\btrue\b/);
    assert.equal(
      scalar(db, `SELECT to_regclass('public.historical_catalog_summary_control_future') IS NULL`),
      "t",
    );
    psqlFile(db, join(roleDir, "future-app-migration.sql"));
    assert.equal(
      scalar(db, `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'Gate14FutureApp'`),
      "g14_migrate",
    );
    const inserted = capture(
      "sa360_app",
      `INSERT INTO "Gate14FutureApp" (id, note) VALUES ('g14', 'explicit grant');
       SELECT nextval('public."Gate14FutureApp_seq"');`,
    );
    assert.equal(inserted.status, 0, inserted.output);
    psql(
      db,
      `SET ROLE sa360_schema_owner;
       CREATE TABLE sa360_summary.historical_catalog_summary_control_future (summary_ready boolean NOT NULL);
       INSERT INTO sa360_summary.historical_catalog_summary_control_future VALUES (false);
       RESET ROLE;`,
    );
    const summaryWrite = capture(
      "sa360_app",
      `INSERT INTO sa360_summary.historical_catalog_summary_control_future VALUES (true);`,
    );
    assert.notEqual(summaryWrite.status, 0);
    assert.match(summaryWrite.output, /permission denied/i);
    assert.equal(
      scalar(db, `SELECT count(*)::text FROM pg_default_acl WHERE defaclacl::text LIKE '%sa360_app=%'`),
      "0",
    );
    migrate(db);
    assert.equal(
      scalar(db, `SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE pg_get_userbyid(c.relowner) = 'sa360_app'`),
      "0",
    );
  });

  it("repeats concurrent maintenance and rolls back a missing control row", async () => {
    const results = await Promise.all(
      [5, 6, 7, 8].map((index) =>
        captureAsync(
          "sa360_app",
          `UPDATE "LeadInventoryItem" SET "nicheKey" = 'vet-concurrent', "updatedAt" = now() WHERE id = 'g14-item-${index}'`,
        ),
      ),
    );
    for (const result of results) assert.equal(result.status, 0, result.output);
    const db = roleUrl("g14_migrate");
    assert.equal(
      scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE n < 0`),
      "0",
    );
    assert.equal(
      scalar(
        db,
        `SELECT count(*)::text FROM historical_catalog_summary_membership m
         JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id
         WHERE m.item_id IN ('g14-item-5', 'g14-item-6', 'g14-item-7', 'g14-item-8')
           AND b.raw_niche_key = 'vet-concurrent'`,
      ),
      "4",
    );
    const epoch = scalar(db, `SELECT summary_epoch::text FROM historical_catalog_summary_control`);
    const missing = capture(
      "g14_migrate",
      `BEGIN;
       SET LOCAL ROLE sa360_schema_owner;
       DELETE FROM historical_catalog_summary_control;
       SET LOCAL ROLE sa360_app;
       UPDATE "LeadInventoryItem" SET "nicheKey" = 'missing-control', "updatedAt" = now() WHERE id = 'g14-item-5';
       COMMIT;`,
    );
    assert.notEqual(missing.status, 0);
    assert.match(missing.output, /SB008|control row missing/);
    assert.equal(scalar(db, `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'g14-item-5'`), "vet-concurrent");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_control`), "1");
    assert.equal(scalar(db, `SELECT summary_epoch::text FROM historical_catalog_summary_control`), epoch);
    const backfill = capture(
      "g14_migrate",
      `SET ROLE sa360_summary_operator;
       CALL historical_catalog_summary_backfill_range('', 'g14-item-8');`,
    );
    assert.equal(backfill.status, 0, backfill.output);
    const authorized = capture(
      "g14_migrate",
      `SET ROLE sa360_summary_operator;
       SELECT historical_catalog_summary_authorize() ->> 'authorized';`,
    );
    assert.equal(authorized.status, 0, authorized.output);
    assert.match(authorized.output, /true/);
    const stillDenied = capture("sa360_app", `SELECT historical_catalog_summary_authorize();`);
    assert.notEqual(stillDenied.status, 0);
    assert.match(stillDenied.output, /permission denied/i);
    psql(db, `SET ROLE sa360_summary_operator; SELECT historical_catalog_summary_mark_unready('maintenance', false);`);
    assert.equal(scalar(db, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    const finalPost = fileResult("g14_migrate", join(roleDir, "postconditions.sql"));
    assert.equal(finalPost.status, 0, finalPost.output);
  });
});
