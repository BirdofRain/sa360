/**
 * Disposable role proof for Gate 12 routine privileges.
 * Roles are local to this Postgres cluster and are dropped afterward.
 * The candidate SQL does not create them. Production credentials are unchanged.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";

import {
  dropDatabase,
  integrationUrl,
  loadCandidate,
  localDatabaseUrl,
  migrate,
  psql,
  psqlCapture,
  recreate,
  scalar,
} from "./historical-catalog-summary-maintenance.harness.js";

const database = "sa360_test_g12_priv";
const run = Boolean(integrationUrl());
const roles = [
  "sa360_summary_runtime",
  "sa360_summary_operator",
  "sa360_summary_reader",
  "sa360_summary_unauth",
] as const;

function asPostgres(dbName: string, sql: string): void {
  const port = new URL(localDatabaseUrl("sa360")).port || "5432";
  const result = spawnSync(
    "sudo",
    ["-n", "-u", "postgres", "psql", "-p", port, "-d", dbName, "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim() || "postgres psql failed");
  }
}

function psqlScript(sql: string): { status: number | null; output: string } {
  const result = spawnSync(
    "psql",
    [localDatabaseUrl(database), "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { encoding: "utf8", input: sql },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function psqlAsync(sql: string): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("psql", [localDatabaseUrl(database), "-v", "ON_ERROR_STOP=1", "-c", sql]);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function control(): { ready: string; epoch: string; failure: string } {
  const [ready, epoch, failure] = scalar(
    localDatabaseUrl(database),
    `SELECT summary_ready::text || '|' || summary_epoch::text || '|' || failure_count::text
     FROM historical_catalog_summary_control`,
  ).split("|");
  return { ready, epoch, failure };
}

describe("historical catalog summary maintenance privileges", { skip: !run, timeout: 180_000 }, () => {
  before(() => {
    asPostgres(
      "postgres",
      `DO $roles$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_runtime') THEN
           CREATE ROLE sa360_summary_runtime NOLOGIN NOINHERIT;
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_operator') THEN
           CREATE ROLE sa360_summary_operator NOLOGIN NOINHERIT;
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_reader') THEN
           CREATE ROLE sa360_summary_reader NOLOGIN NOINHERIT;
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_unauth') THEN
           CREATE ROLE sa360_summary_unauth NOLOGIN NOINHERIT;
         END IF;
       END
       $roles$;
       GRANT sa360_summary_runtime TO sa360 WITH INHERIT FALSE;
       GRANT sa360_summary_operator TO sa360 WITH INHERIT FALSE;
       GRANT sa360_summary_reader TO sa360 WITH INHERIT FALSE;
       GRANT sa360_summary_unauth TO sa360 WITH INHERIT FALSE;`,
    );
    const databaseUrl = recreate(database);
    migrate(databaseUrl);
    loadCandidate(databaseUrl, true);
    psql(
      databaseUrl,
      `INSERT INTO "InventoryLot" (
         id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey", "inventoryClass", status, "createdAt", "updatedAt"
       ) VALUES
         ('lot-priv', 'vet-priv', 'Priv', 'manual_import', 'g12', 'vet', 'aged', 'active', now(), now()),
         ('lot-live', 'live-priv', 'Live', 'manual_import', 'g12', 'vet', 'aged', 'active', now(), now());
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
         "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
       ) VALUES
         ('priv-evt', 'manual_import', 'csv_import', 'bulk_import', 'approved', 'Priv July',
          '{"importRequestId":"imp-priv"}'::jsonb, '{"campaign_name":"Priv July"}'::jsonb, now(), now(), now()),
         ('priv-owner-evt', 'manual_import', 'csv_import', 'bulk_import', 'approved', 'Owner July',
          '{"importRequestId":"imp-priv"}'::jsonb, '{"campaign_name":"Owner July"}'::jsonb, now(), now(), now()),
         ('priv-live-evt', 'leadcapture_io', 'leadcapture_io_nextgen', 'bulk_import', 'received', NULL,
          '{}'::jsonb, NULL, now(), now(), now());
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       ) VALUES
         ('priv-item', 'lot-priv', 'priv-evt', now(), 'GA', 'vet',
          'manual_import', 'g12', 'aged', 'available', now(), now(), now()),
         ('priv-owner', 'lot-priv', 'priv-owner-evt', now(), 'GA', 'vet',
          'manual_import', 'g12', 'aged', 'available', now(), now(), now()),
         ('priv-live', 'lot-live', 'priv-live-evt', now(), 'GA', 'vet',
          'leadcapture_io', 'g12', 'aged', 'pending_review', NULL, now(), now());
       GRANT USAGE ON SCHEMA public TO sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader, sa360_summary_unauth;
       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
         TO sa360_summary_runtime, sa360_summary_operator, sa360_summary_unauth;
       GRANT SELECT ON ALL TABLES IN SCHEMA public TO sa360_summary_reader;
       GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
         TO sa360_summary_runtime, sa360_summary_operator, sa360_summary_unauth;`,
    );
  });

  after(() => {
    if (!run) return;
    dropDatabase(database);
    asPostgres(
      "postgres",
      `DO $drop$
       DECLARE
         role_name text;
       BEGIN
         FOREACH role_name IN ARRAY ARRAY[
           'sa360_summary_runtime',
           'sa360_summary_operator',
           'sa360_summary_reader',
           'sa360_summary_unauth'
         ]
         LOOP
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
             EXECUTE format('DROP OWNED BY %I', role_name);
             EXECUTE format('REVOKE %I FROM sa360', role_name);
             EXECUTE format('DROP ROLE %I', role_name);
           END IF;
         END LOOP;
       END
       $drop$;`,
    );
  });

  it("does not expose a routine that was created and revoked in an open transaction", async () => {
    const held = psqlAsync(
      `BEGIN;
       CREATE FUNCTION g12_half_installed() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
       REVOKE ALL ON FUNCTION g12_half_installed() FROM PUBLIC;
       SELECT pg_sleep(2);
       ROLLBACK;`,
    );
    await sleep(300);
    assert.equal(
      scalar(localDatabaseUrl(database), `SELECT (to_regprocedure('g12_half_installed()') IS NULL)::text`),
      "true",
    );
    const finished = await held;
    assert.equal(finished.status, 0, finished.output);
    assert.equal(
      scalar(localDatabaseUrl(database), `SELECT (to_regprocedure('g12_half_installed()') IS NULL)::text`),
      "true",
    );
    const aborted = psqlCapture(
      localDatabaseUrl(database),
      `BEGIN;
       CREATE FUNCTION g12_half_installed() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
       REVOKE ALL ON FUNCTION g12_half_installed() FROM PUBLIC;
       DO $$ BEGIN RAISE EXCEPTION 'abort install'; END $$;
       COMMIT;`,
    );
    assert.notEqual(aborted.status, 0);
    assert.match(aborted.stderr, /abort install/);
    assert.equal(
      scalar(localDatabaseUrl(database), `SELECT (to_regprocedure('g12_half_installed()') IS NULL)::text`),
      "true",
    );
  });

  it("leaves PUBLIC unable to execute maintenance while the owning login still can", () => {
    const db = localDatabaseUrl(database);
    for (const routine of [
      "historical_catalog_summary_authorize()",
      "historical_catalog_summary_mark_unready(text, boolean)",
      "historical_catalog_summary_apply_item(text)",
      "historical_catalog_summary_backfill_chunk(text, text)",
      "historical_catalog_summary_readable()",
    ]) {
      assert.equal(scalar(db, `SELECT has_function_privilege('public', '${routine}', 'EXECUTE')::text`), "false", routine);
      assert.equal(
        scalar(db, `SELECT has_function_privilege('sa360_summary_unauth', '${routine}', 'EXECUTE')::text`),
        "false",
        routine,
      );
    }
    assert.equal(
      scalar(db, `SELECT has_function_privilege(current_user, 'historical_catalog_summary_authorize()', 'EXECUTE')::text`),
      "true",
    );
    assert.equal(
      scalar(db, `SELECT has_function_privilege('sa360_summary_runtime', 'historical_catalog_summary_authorize()', 'EXECUTE')::text`),
      "false",
    );
    assert.equal(
      scalar(db, `SELECT has_function_privilege('sa360_summary_runtime', 'historical_catalog_summary_apply_item(text)', 'EXECUTE')::text`),
      "true",
    );
    assert.equal(
      scalar(db, `SELECT has_function_privilege('sa360_summary_runtime', 'historical_catalog_summary_backfill_chunk(text, text)', 'EXECUTE')::text`),
      "false",
    );
    assert.equal(
      scalar(db, `SELECT has_function_privilege('sa360_summary_operator', 'historical_catalog_summary_authorize()', 'EXECUTE')::text`),
      "true",
    );
    assert.equal(
      scalar(db, `SELECT has_function_privilege('sa360_summary_reader', 'historical_catalog_summary_readable()', 'EXECUTE')::text`),
      "true",
    );
    assert.equal(
      scalar(db, `SELECT has_function_privilege('sa360_summary_reader', 'historical_catalog_summary_authorize()', 'EXECUTE')::text`),
      "false",
    );
    assert.equal(roles.length, 4);
  });

  it("lets the runtime role maintain from a trigger and rolls back an unauthorized write", () => {
    const db = localDatabaseUrl(database);
    const before = control();
    const maintained = psqlScript(
      `BEGIN;
       SET LOCAL ROLE sa360_summary_runtime;
       UPDATE "LeadInventoryItem"
       SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
       WHERE id = 'priv-item';
       COMMIT;`,
    );
    assert.equal(maintained.status, 0, maintained.output);
    assert.equal(scalar(db, `SELECT status::text FROM "LeadInventoryItem" WHERE id = 'priv-item'`), "reserved");
    assert.equal(
      scalar(db, `SELECT b.item_status FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'priv-item'`),
      "reserved",
    );
    assert.equal(control().epoch, before.epoch);
    assert.equal(control().ready, "false");

    const ownerWrite = psql(
      db,
      `UPDATE "LeadInventoryItem" SET "nicheKey" = 'dental', "updatedAt" = now() WHERE id = 'priv-owner'`,
    );
    assert.match(ownerWrite, /UPDATE 1/);
    assert.equal(
      scalar(db, `SELECT b.raw_niche_key FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'priv-owner'`),
      "dental",
    );

    const live = psqlScript(
      `BEGIN;
       SET LOCAL ROLE sa360_summary_runtime;
       UPDATE "LeadInventoryItem" SET "nicheKey" = 'ortho', "updatedAt" = now() WHERE id = 'priv-live';
       COMMIT;`,
    );
    assert.equal(live.status, 0, live.output);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_membership WHERE item_id = 'priv-live'`), "0");

    const denied = psqlScript(
      `BEGIN;
       SET LOCAL ROLE sa360_summary_unauth;
       UPDATE "LeadInventoryItem"
       SET status = 'pending_review', "updatedAt" = now()
       WHERE id = 'priv-item';
       COMMIT;`,
    );
    assert.notEqual(denied.status, 0);
    assert.match(denied.output, /permission denied/i);
    assert.equal(scalar(db, `SELECT status::text FROM "LeadInventoryItem" WHERE id = 'priv-item'`), "reserved");
    assert.equal(
      scalar(db, `SELECT item_status FROM historical_catalog_projection WHERE item_id = 'priv-item'`),
      "reserved",
    );
    assert.equal(control().ready, "false");
    assert.equal(control().epoch, before.epoch);
    assert.equal(control().failure, before.failure);
  });

  it("rejects authorize, backfill, and invalidation from roles that were not granted them", () => {
    const db = localDatabaseUrl(database);
    const before = control();
    const unauthInvalidate = psqlScript(
      `SET ROLE sa360_summary_unauth;
       SELECT historical_catalog_summary_mark_unready('maintenance', false);`,
    );
    assert.notEqual(unauthInvalidate.status, 0);
    assert.match(unauthInvalidate.output, /permission denied/i);
    const unauthAuthorize = psqlScript(
      `SET ROLE sa360_summary_unauth;
       SELECT historical_catalog_summary_authorize();`,
    );
    assert.notEqual(unauthAuthorize.status, 0);
    assert.match(unauthAuthorize.output, /permission denied/i);
    const unauthBackfill = psqlScript(
      `SET ROLE sa360_summary_unauth;
       CALL historical_catalog_summary_backfill_range('', 'priv-item');`,
    );
    assert.notEqual(unauthBackfill.status, 0);
    assert.match(unauthBackfill.output, /permission denied/i);
    const runtimeAuthorize = psqlScript(
      `SET ROLE sa360_summary_runtime;
       SELECT historical_catalog_summary_authorize();`,
    );
    assert.notEqual(runtimeAuthorize.status, 0);
    assert.match(runtimeAuthorize.output, /permission denied/i);
    const runtimeBackfill = psqlScript(
      `SET ROLE sa360_summary_runtime;
       CALL historical_catalog_summary_backfill_range('', 'priv-item');`,
    );
    assert.notEqual(runtimeBackfill.status, 0);
    assert.match(runtimeBackfill.output, /permission denied/i);
    const reader = psqlScript(
      `SET ROLE sa360_summary_reader;
       SELECT historical_catalog_summary_readable();`,
    );
    assert.equal(reader.status, 0, reader.output);
    const readerReconcile = psqlScript(
      `SET ROLE sa360_summary_reader;
       SELECT historical_catalog_summary_reconcile_issues();`,
    );
    assert.notEqual(readerReconcile.status, 0);
    assert.match(readerReconcile.output, /permission denied/i);
    const readerAuthorize = psqlScript(
      `SET ROLE sa360_summary_reader;
       SELECT historical_catalog_summary_authorize();`,
    );
    assert.notEqual(readerAuthorize.status, 0);
    assert.match(readerAuthorize.output, /permission denied/i);
    assert.equal(control().ready, before.ready);
    assert.equal(control().epoch, before.epoch);
    assert.equal(control().failure, before.failure);
  });

  it("rolls the inventory write back when the runtime role cannot mark the summary unready", () => {
    const db = localDatabaseUrl(database);
    const before = control();
    psql(
      db,
      `CREATE FUNCTION g12_priv_bomb() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         IF coalesce(current_setting('g12.fail_bucket', true), '') = 'on' THEN
           RAISE EXCEPTION 'injected bucket failure';
         END IF;
         RETURN NEW;
       END; $fn$;
       CREATE TRIGGER g12_priv_bomb BEFORE UPDATE ON historical_catalog_summary_bucket
       FOR EACH ROW EXECUTE FUNCTION g12_priv_bomb();
       REVOKE EXECUTE ON FUNCTION historical_catalog_summary_mark_unready(text, boolean) FROM sa360_summary_runtime;`,
    );
    const failed = psqlScript(
      `BEGIN;
       SET LOCAL g12.fail_bucket = 'on';
       SET LOCAL ROLE sa360_summary_runtime;
       UPDATE "LeadInventoryItem" SET "nicheKey" = 'blocked', "updatedAt" = now() WHERE id = 'priv-item';
       COMMIT;`,
    );
    assert.notEqual(failed.status, 0);
    assert.match(failed.output, /permission denied/i);
    assert.equal(scalar(db, `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'priv-item'`), "vet");
    assert.equal(scalar(db, `SELECT niche_key FROM historical_catalog_projection WHERE item_id = 'priv-item'`), "vet");
    assert.equal(
      scalar(db, `SELECT b.raw_niche_key FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'priv-item'`),
      "vet",
    );
    assert.equal(control().ready, before.ready);
    assert.equal(control().epoch, before.epoch);
    assert.equal(control().failure, before.failure);
    psql(
      db,
      `GRANT EXECUTE ON FUNCTION historical_catalog_summary_mark_unready(text, boolean) TO sa360_summary_runtime;
       DROP TRIGGER g12_priv_bomb ON historical_catalog_summary_bucket;
       DROP FUNCTION g12_priv_bomb();`,
    );
  });

  it("lets the operator backfill and authorize without giving that power to runtime", () => {
    const db = localDatabaseUrl(database);
    const backfill = psqlScript(
      `SET ROLE sa360_summary_operator;
       CALL historical_catalog_summary_backfill_range('', 'priv-owner');
       RESET ROLE;`,
    );
    assert.equal(backfill.status, 0, backfill.output);
    assert.equal(
      scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_checkpoint WHERE status = 'running'`),
      "0",
    );
    const issues = JSON.parse(scalar(db, `SELECT historical_catalog_summary_reconcile_issues()::text`)) as { ok: boolean };
    assert.equal(issues.ok, true);
    const authorized = psqlScript(
      `SET ROLE sa360_summary_operator;
       SELECT historical_catalog_summary_authorize() ->> 'authorized';
       RESET ROLE;`,
    );
    assert.equal(authorized.status, 0, authorized.output);
    assert.match(authorized.output, /true/);
    assert.equal(control().ready, "true");
    const readyBefore = control();
    const runtimeDenied = psqlScript(
      `SET ROLE sa360_summary_runtime;
       CALL historical_catalog_summary_backfill_range('', 'priv-owner');`,
    );
    assert.notEqual(runtimeDenied.status, 0);
    assert.match(runtimeDenied.output, /permission denied/i);
    assert.equal(control().ready, "true");
    assert.equal(control().epoch, readyBefore.epoch);
    const unauthDenied = psqlScript(
      `SET ROLE sa360_summary_unauth;
       SELECT historical_catalog_summary_authorize();`,
    );
    assert.notEqual(unauthDenied.status, 0);
    assert.match(unauthDenied.output, /permission denied/i);
    assert.equal(control().ready, "true");
    assert.equal(control().epoch, readyBefore.epoch);
    assert.equal(control().failure, readyBefore.failure);
  });
});
