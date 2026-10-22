/**
 * Local proof for the Gate 11 summary schema migration.
 * Uses SA360_TEST_DATABASE_URL only to derive a localhost connection, then
 * creates disposable databases whose names contain "test".
 * No production connection. The migration is applied only on those databases.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrl);
const repoRoot = join(import.meta.dirname, "../../../../..");
const migrationName = "20261022170000_historical_catalog_summary_schema_v1";
const migrationSql = readFileSync(
  join(repoRoot, "prisma/migrations", migrationName, "migration.sql"),
  "utf8",
);
const chainDatabase = "sa360_test_g11_summary";
const emptyDatabase = "sa360_test_g11_summary_empty";

function localDatabaseUrl(database: string): string {
  const url = new URL(integrationUrl);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("refusing a non-local database");
  }
  url.pathname = `/${database}`;
  const value = url.toString();
  if (database !== "sa360") assertSafeTestDatabaseUrl(value);
  return value;
}

function psql(databaseUrlValue: string, sql: string): string {
  const result = spawnSync("psql", [databaseUrlValue, "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
  return result.stdout;
}

function psqlAllowFail(databaseUrlValue: string, sql: string): { status: number | null; output: string } {
  const result = spawnSync(
    "psql",
    [databaseUrlValue, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-c", sql],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function command(args: string[], databaseUrlValue: string): { status: number | null; output: string } {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrlValue },
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function recreate(database: string): string {
  const adminUrl = localDatabaseUrl("sa360");
  psql(
    adminUrl,
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
  );
  psql(adminUrl, `DROP DATABASE IF EXISTS ${database};`);
  psql(adminUrl, `CREATE DATABASE ${database};`);
  return localDatabaseUrl(database);
}

function scalar(databaseUrlValue: string, sql: string): string {
  const result = spawnSync(
    "psql",
    [databaseUrlValue, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "psql scalar failed");
  }
  return result.stdout.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("historical catalog summary schema gate 11", { skip: !runIntegration }, () => {
  const lockers: ChildProcessWithoutNullStreams[] = [];

  after(() => {
    for (const locker of lockers) {
      locker.kill();
    }
    const adminUrl = localDatabaseUrl("sa360");
    for (const database of [chainDatabase, emptyDatabase]) {
      psql(
        adminUrl,
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
      );
      psql(adminUrl, `DROP DATABASE IF EXISTS ${database};`);
    }
  });

  it("creates an empty unready summary and leaves projection triggers unchanged", { timeout: 300_000 }, async () => {
    const databaseUrl = recreate(chainDatabase);
    const deployed = command(["pnpm", "migrate:deploy"], databaseUrl);
    assert.equal(deployed.status, 0, deployed.output);
    const again = command(["pnpm", "migrate:deploy"], databaseUrl);
    assert.equal(again.status, 0, again.output);
    assert.match(again.output, /No pending migrations|already in sync|0 migrations/i);

    assert.equal(scalar(databaseUrl, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    assert.equal(scalar(databaseUrl, `SELECT reconciled_epoch IS NULL FROM historical_catalog_summary_control`), "t");
    assert.equal(scalar(databaseUrl, `SELECT reconciled_at IS NULL FROM historical_catalog_summary_control`), "t");
    assert.equal(scalar(databaseUrl, `SELECT summary_epoch::text FROM historical_catalog_summary_control`), "0");
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_bucket`), "0");
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_membership`), "0");
    assert.equal(scalar(databaseUrl, `SELECT ready::text FROM historical_catalog_projection_control`), "false");
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_projection`), "0");
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM "LeadInventoryItem"`), "0");
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM "SourceLeadEvent"`), "0");

    const projectionTriggers = scalar(
      databaseUrl,
      `SELECT string_agg(tgname, ',' ORDER BY tgname)
       FROM pg_trigger
       WHERE NOT tgisinternal AND tgname LIKE 'historical_catalog_%'`,
    );
    assert.equal(
      projectionTriggers,
      "historical_catalog_projection_event_refresh,historical_catalog_projection_item_refresh,historical_catalog_projection_lot_refresh",
    );
    assert.equal(
      scalar(
        databaseUrl,
        `SELECT count(*)::text
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         WHERE NOT t.tgisinternal AND c.relname LIKE 'historical_catalog_summary%'`,
      ),
      "0",
    );
    assert.equal(
      scalar(databaseUrl, `SELECT count(*)::text FROM pg_proc WHERE proname LIKE 'historical_catalog_summary%'`),
      "0",
    );
    const triggerHash = scalar(
      databaseUrl,
      `SELECT md5(string_agg(pg_get_triggerdef(oid), ',' ORDER BY tgname))
       FROM pg_trigger
       WHERE NOT tgisinternal AND tgname LIKE 'historical_catalog_projection_%'`,
    );
    const refreshHash = scalar(
      databaseUrl,
      `SELECT md5(pg_get_functiondef('historical_catalog_projection_refresh_item(text)'::regprocedure))`,
    );
    assert.match(
      scalar(
        databaseUrl,
        `SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'historical_catalog_projection_item_refresh'`,
      ),
      /EXECUTE FUNCTION historical_catalog_projection_item_trg\(\)/,
    );
    assert.match(
      scalar(
        databaseUrl,
        `SELECT pg_get_functiondef('historical_catalog_projection_refresh_item(text)'::regprocedure)`,
      ),
      /DELETE FROM historical_catalog_projection WHERE item_id = p_item_id/,
    );

    const diff = command(
      [
        "pnpm",
        "exec",
        "prisma",
        "migrate",
        "diff",
        "--from-url",
        databaseUrl,
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--script",
      ],
      databaseUrl,
    );
    assert.equal(diff.status, 0, diff.output);
    assert.equal(diff.output.includes("historical_catalog_summary_"), false, diff.output);
    assert.equal(diff.output.includes("historical_catalog_projection"), false, diff.output);
    assert.match(scalar(databaseUrl, "SHOW server_version"), /^16\./);

    psql(
      databaseUrl,
      `DROP TABLE historical_catalog_summary_membership;
       DROP TABLE historical_catalog_summary_checkpoint;
       DROP TABLE historical_catalog_summary_control;
       DROP TABLE historical_catalog_summary_bucket;
       DROP TABLE historical_catalog_summary_label;
       DELETE FROM "_prisma_migrations" WHERE migration_name = '${migrationName}';`,
    );

    const locker = spawn("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    lockers.push(locker);
    let lockerOutput = "";
    locker.stdout.on("data", (chunk: Buffer) => {
      lockerOutput += chunk.toString();
    });
    locker.stderr.on("data", (chunk: Buffer) => {
      lockerOutput += chunk.toString();
    });
    locker.stdin.write(`BEGIN;
LOCK TABLE "LeadInventoryItem" IN SHARE MODE;
LOCK TABLE "SourceLeadEvent" IN SHARE MODE;
LOCK TABLE "InventoryLot" IN SHARE MODE;
LOCK TABLE historical_catalog_projection IN SHARE MODE;
SELECT 'summary_schema_locks_held';
`);
    let held = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const locks = scalar(
        databaseUrl,
        `SELECT count(*)::text
         FROM pg_locks l
         JOIN pg_class c ON c.oid = l.relation
         WHERE c.relname IN ('LeadInventoryItem', 'SourceLeadEvent', 'InventoryLot', 'historical_catalog_projection')
           AND l.mode = 'ShareLock'
           AND l.granted`,
      );
      if (locks === "4") {
        held = true;
        break;
      }
      await sleep(100);
    }
    assert.equal(held, true, lockerOutput);

    const started = Date.now();
    const relocked = command(["pnpm", "migrate:deploy"], databaseUrl);
    const elapsedMs = Date.now() - started;
    locker.stdin.write("COMMIT;\n\\q\n");
    locker.stdin.end();
    assert.equal(relocked.status, 0, relocked.output);
    assert.doesNotMatch(relocked.output, /55P03|lock timeout/i);
    assert.ok(elapsedMs < 30_000, `summary migration took ${elapsedMs}ms while inventory locks were held`);
    assert.equal(scalar(databaseUrl, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    assert.equal(
      scalar(
        databaseUrl,
        `SELECT count(*)::text
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         WHERE NOT t.tgisinternal AND c.relname LIKE 'historical_catalog_summary%'`,
      ),
      "0",
    );
    assert.equal(
      scalar(
        databaseUrl,
        `SELECT md5(string_agg(pg_get_triggerdef(oid), ',' ORDER BY tgname))
         FROM pg_trigger
         WHERE NOT tgisinternal AND tgname LIKE 'historical_catalog_projection_%'`,
      ),
      triggerHash,
    );
    assert.equal(
      scalar(
        databaseUrl,
        `SELECT md5(pg_get_functiondef('historical_catalog_projection_refresh_item(text)'::regprocedure))`,
      ),
      refreshHash,
    );
  });

  it("enforces the grain, membership, checkpoint, and long-label rules", () => {
    const databaseUrl = recreate(emptyDatabase);
    const bare = psqlAllowFail(databaseUrl, "SET LOCAL lock_timeout = '3s';");
    assert.equal(bare.status, 0, bare.output);
    assert.match(bare.output, /SET LOCAL can only be used in transaction blocks/);
    assert.equal(
      scalar(databaseUrl, `SELECT COALESCE(to_regclass('public.historical_catalog_summary_control')::text, 'absent')`),
      "absent",
    );

    const badPath = "/tmp/g11-summary-migration-fail.sql";
    writeFileSync(badPath, `${migrationSql}\nSELECT 1/0;\n`);
    const autocommit = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", badPath], {
      encoding: "utf8",
    });
    assert.notEqual(autocommit.status, 0, autocommit.stderr);
    assert.match(`${autocommit.stdout}\n${autocommit.stderr}`, /division by zero/);
    assert.equal(
      scalar(databaseUrl, `SELECT COALESCE(to_regclass('public.historical_catalog_summary_label')::text, 'absent')`),
      "historical_catalog_summary_label",
    );
    recreate(emptyDatabase);
    const singleTransaction = spawnSync(
      "psql",
      [databaseUrl, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", badPath],
      { encoding: "utf8" },
    );
    assert.notEqual(singleTransaction.status, 0, singleTransaction.stderr);
    assert.match(`${singleTransaction.stdout}\n${singleTransaction.stderr}`, /division by zero/);
    for (const table of [
      "historical_catalog_summary_label",
      "historical_catalog_summary_bucket",
      "historical_catalog_summary_membership",
      "historical_catalog_summary_control",
      "historical_catalog_summary_checkpoint",
    ]) {
      assert.equal(
        scalar(databaseUrl, `SELECT COALESCE(to_regclass('public.${table}')::text, 'absent')`),
        "absent",
        table,
      );
    }

    const rolledBack = psqlAllowFail(databaseUrl, `BEGIN;\n${migrationSql}\nSELECT 1/0;\n`);
    assert.notEqual(rolledBack.status, 0, rolledBack.output);
    assert.match(rolledBack.output, /division by zero/);
    for (const table of [
      "historical_catalog_summary_label",
      "historical_catalog_summary_bucket",
      "historical_catalog_summary_membership",
      "historical_catalog_summary_control",
      "historical_catalog_summary_checkpoint",
    ]) {
      assert.equal(
        scalar(databaseUrl, `SELECT COALESCE(to_regclass('public.${table}')::text, 'absent')`),
        "absent",
        table,
      );
    }

    psql(databaseUrl, `BEGIN;\n${migrationSql}\nCOMMIT;`);
    assert.equal(scalar(databaseUrl, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");

    const longLabel = "y".repeat(4160);
    psql(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_label (july_label, normalized_label, label_hash)
       VALUES ('${longLabel}', 'long', 'hash-a')`,
    );
    psql(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_label (july_label, normalized_label, label_hash)
       VALUES ('other', 'other', 'hash-a')`,
    );
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_label`), "2");
    assert.equal(
      scalar(databaseUrl, `SELECT max(octet_length(july_label))::text FROM historical_catalog_summary_label`),
      "4160",
    );
    const labelIndexes = scalar(
      databaseUrl,
      `SELECT string_agg(i.relname || ':' || x.indisunique::text, ',' ORDER BY i.relname)
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       WHERE t.relname = 'historical_catalog_summary_label'`,
    );
    assert.equal(
      labelIndexes,
      "historical_catalog_summary_label_hash:false,historical_catalog_summary_label_pkey:true",
    );

    const labelId = scalar(
      databaseUrl,
      `SELECT label_pair_id::text FROM historical_catalog_summary_label WHERE normalized_label = 'long'`,
    );
    const bucket = (rawLot: string, origin: string) =>
      `INSERT INTO historical_catalog_summary_bucket (
         lot_key, raw_lot_key, import_request, label_pair_id, origin_id,
         niche_key, raw_niche_key, item_status, label_agreement, n
       ) VALUES (
         'lot', ${rawLot}, 'imp', ${labelId}, ${origin}, 'vet', 'vet', 'available', 'july_column_agrees', 1
       )`;
    psql(databaseUrl, bucket("NULL", "NULL"));
    const duplicateNull = psqlAllowFail(databaseUrl, bucket("NULL", "NULL"));
    assert.notEqual(duplicateNull.status, 0);
    assert.match(duplicateNull.output, /23505|historical_catalog_summary_bucket_grain/);
    psql(databaseUrl, bucket("''", "NULL"));
    psql(databaseUrl, bucket("NULL", "''"));
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_bucket`), "3");

    const negative = psqlAllowFail(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_bucket (
         lot_key, raw_lot_key, import_request, label_pair_id, origin_id,
         niche_key, raw_niche_key, item_status, label_agreement, n
       ) VALUES ('lot', 'neg', 'imp', ${labelId}, NULL, 'vet', 'vet', 'available', 'july_column_agrees', -1)`,
    );
    assert.notEqual(negative.status, 0);
    assert.match(negative.output, /23514|historical_catalog_summary_bucket_n_nonnegative/);

    const bucketId = scalar(databaseUrl, `SELECT min(bucket_id)::text FROM historical_catalog_summary_bucket`);
    const missingBucket = psqlAllowFail(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_membership (item_id, bucket_id, accounted)
       VALUES ('missing', 999999, true)`,
    );
    assert.notEqual(missingBucket.status, 0);
    assert.match(missingBucket.output, /23503/);
    const accountedWithoutBucket = psqlAllowFail(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_membership (item_id, bucket_id, accounted)
       VALUES ('orphan', NULL, true)`,
    );
    assert.notEqual(accountedWithoutBucket.status, 0);
    assert.match(accountedWithoutBucket.output, /23514|historical_catalog_summary_membership_accounted/);
    const unaccountedWithBucket = psqlAllowFail(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_membership (item_id, bucket_id, accounted)
       VALUES ('loose', ${bucketId}, false)`,
    );
    assert.notEqual(unaccountedWithBucket.status, 0);
    assert.match(unaccountedWithBucket.output, /23514|historical_catalog_summary_membership_accounted/);
    psql(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_membership (item_id, bucket_id, accounted)
       VALUES ('kept', ${bucketId}, true)`,
    );
    psql(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_membership (item_id, bucket_id, accounted)
       VALUES ('pending', NULL, false)`,
    );
    const duplicateItem = psqlAllowFail(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_membership (item_id, bucket_id, accounted)
       VALUES ('kept', NULL, false)`,
    );
    assert.notEqual(duplicateItem.status, 0);
    assert.match(duplicateItem.output, /23505/);
    const deleteBucket = psqlAllowFail(
      databaseUrl,
      `DELETE FROM historical_catalog_summary_bucket WHERE bucket_id = ${bucketId}`,
    );
    assert.notEqual(deleteBucket.status, 0);
    assert.match(deleteBucket.output, /23503/);

    for (const status of ["running", "complete", "failed"]) {
      psql(
        databaseUrl,
        `INSERT INTO historical_catalog_summary_checkpoint (range_after, range_until, status)
         VALUES ('a', 'b', '${status}')`,
      );
    }
    const badStatus = psqlAllowFail(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_checkpoint (range_after, range_until, status)
       VALUES ('a', 'b', 'paused')`,
    );
    assert.notEqual(badStatus.status, 0);
    assert.match(badStatus.output, /23514|historical_catalog_summary_checkpoint_status_check/);
    const secondControl = psqlAllowFail(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_control (singleton, summary_ready)
       VALUES (true, false)`,
    );
    assert.notEqual(secondControl.status, 0);
    assert.match(secondControl.output, /23505/);
    const falseSingleton = psqlAllowFail(
      databaseUrl,
      `INSERT INTO historical_catalog_summary_control (singleton, summary_ready)
       VALUES (false, false)`,
    );
    assert.notEqual(falseSingleton.status, 0);
    assert.match(falseSingleton.output, /23514|historical_catalog_summary_control_singleton/);
  });
});
