/**
 * Gate 13 role boundary and PostgreSQL 18 proofs.
 * Disposable local database only. Set SA360_G13_PG18=1 to run.
 * The candidate SQL is not a migration and these checks do not install it.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  candidateDir,
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

const database = "sa360_test_g13_roles";
const run = Boolean(integrationUrl()) && process.env.SA360_G13_PG18 === "1";
const roleSql = `
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_schema_owner') THEN
    CREATE ROLE sa360_schema_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_runtime') THEN
    CREATE ROLE sa360_summary_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_operator') THEN
    CREATE ROLE sa360_summary_operator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_reader') THEN
    CREATE ROLE sa360_summary_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_unauth') THEN
    CREATE ROLE sa360_summary_unauth NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    CREATE ROLE sa360_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END
$roles$;
GRANT sa360_schema_owner TO sa360 WITH INHERIT TRUE, SET TRUE;
GRANT sa360_summary_runtime TO sa360_app WITH INHERIT TRUE, SET FALSE;
GRANT sa360_summary_operator TO sa360 WITH INHERIT FALSE, SET TRUE;
GRANT sa360_summary_reader TO sa360 WITH INHERIT FALSE, SET TRUE;
GRANT sa360_summary_unauth TO sa360 WITH INHERIT FALSE, SET TRUE;
GRANT sa360_app TO sa360 WITH INHERIT FALSE, SET TRUE;
`;

function port(): string {
  return new URL(localDatabaseUrl("sa360")).port || "5432";
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

function db(): string {
  return localDatabaseUrl(database);
}

function script(sql: string): { status: number | null; output: string } {
  const result = spawnSync("psql", [db(), "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    encoding: "utf8",
    input: sql,
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

function fileResult(filePath: string): { status: number | null; output: string } {
  const result = spawnSync("psql", [db(), "-v", "ON_ERROR_STOP=1", "-f", filePath], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

function psqlAsync(sql: string): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("psql", [db(), "-v", "ON_ERROR_STOP=1", "-c", sql]);
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

function control(): { ready: string; epoch: string } {
  const [ready, epoch] = scalar(
    db(),
    `SELECT summary_ready::text || '|' || summary_epoch::text FROM historical_catalog_summary_control`,
  ).split("|");
  return { ready, epoch };
}

describe("historical catalog summary role security gate 13", { skip: !run, timeout: 300_000 }, () => {
  before(() => {
    asPostgres("postgres", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid();`);
    asPostgres("postgres", roleSql);
    const databaseUrl = recreate(database);
    migrate(databaseUrl);
    loadCandidate(databaseUrl, true);
    psql(
      databaseUrl,
      `REVOKE CREATE ON SCHEMA public FROM PUBLIC;
       GRANT USAGE ON SCHEMA public TO sa360_app, sa360_schema_owner, sa360_summary_runtime,
         sa360_summary_operator, sa360_summary_reader, sa360_summary_unauth;
       GRANT CREATE ON SCHEMA public TO sa360_schema_owner;
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
         "InventoryLot", "SourceLeadEvent", "LeadInventoryItem",
         historical_catalog_projection
         TO sa360_app;
       GRANT SELECT ON historical_catalog_projection_source, historical_catalog_projection_control TO sa360_app;
       GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sa360_app;
       REVOKE ALL ON SEQUENCE
         historical_catalog_summary_label_label_pair_id_seq,
         historical_catalog_summary_bucket_bucket_id_seq,
         historical_catalog_summary_checkpoint_chunk_id_seq
       FROM sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader, PUBLIC;
       REVOKE ALL ON FUNCTION
         historical_catalog_projection_refresh_item(text),
         historical_catalog_projection_item_trg(),
         historical_catalog_projection_event_trg(),
         historical_catalog_projection_lot_trg(),
         historical_july_campaign_label_normalize(text),
         historical_registry_scope_key_kind(text),
         historical_campaign_ownership_decision(text, text, text)
       FROM PUBLIC;
       GRANT EXECUTE ON FUNCTION
         historical_catalog_projection_refresh_item(text),
         historical_catalog_projection_item_trg(),
         historical_catalog_projection_event_trg(),
         historical_catalog_projection_lot_trg(),
         historical_july_campaign_label_normalize(text),
         historical_registry_scope_key_kind(text),
         historical_campaign_ownership_decision(text, text, text)
       TO sa360_app;
       REVOKE ALL ON FUNCTION
         historical_catalog_projection_diff(text, text, integer),
         historical_alias_evidence_reference_ok(text, text),
         historical_resale_evidence_reference_ok(text, text),
         historical_registry_assign_event_sequence(),
         historical_registry_reject_event_mutation(),
         historical_registry_reject_parent_delete(),
         historical_campaign_alias_guard_identity(),
         historical_resale_guard_identity(),
         historical_campaign_alias_assert_history(text),
         historical_resale_authorization_assert_history(text),
         historical_campaign_alias_history_trigger(),
         historical_campaign_alias_event_history_trigger(),
         historical_resale_history_trigger(),
         historical_resale_event_history_trigger(),
         historical_resale_posture(text, text, timestamp),
         historical_resale_authorization_decision(text, text, timestamptz)
       FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader;
       REVOKE ALL ON PROCEDURE historical_catalog_projection_backfill_chunk(text, text)
       FROM PUBLIC, sa360_app, sa360_summary_runtime, sa360_summary_operator, sa360_summary_reader;
       INSERT INTO "InventoryLot" (
         id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey", "inventoryClass", status, "createdAt", "updatedAt"
       ) VALUES ('lot-g13', 'vet-g13', 'G13', 'manual_import', 'g13', 'vet', 'aged', 'active', now(), now());
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
         "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
       )
       SELECT 'g13-evt-' || g, 'manual_import', 'csv_import', 'bulk_import', 'approved', 'Gate 13',
              jsonb_build_object('importRequestId', 'imp-g13'), '{"campaign_name":"Gate 13"}'::jsonb,
              now(), now(), now()
       FROM generate_series(1, 8) g;
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       )
       SELECT 'g13-item-' || g, 'lot-g13', 'g13-evt-' || g, now(), 'GA', 'vet',
              'manual_import', 'g13', 'aged', 'available', now(), now(), now()
       FROM generate_series(1, 8) g;`,
    );
  });

  after(() => {
    if (!run) return;
    dropDatabase(database);
    asPostgres(
      "postgres",
      `DO $drop$
       DECLARE role_name text;
       BEGIN
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app')
            AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_summary_runtime') THEN
           REVOKE sa360_summary_runtime FROM sa360_app;
         END IF;
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app')
            AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_schema_owner') THEN
           REVOKE sa360_schema_owner FROM sa360_app;
         END IF;
         FOREACH role_name IN ARRAY ARRAY[
           'sa360_app', 'sa360_summary_unauth', 'sa360_summary_reader',
           'sa360_summary_operator', 'sa360_summary_runtime', 'sa360_schema_owner'
         ]
         LOOP
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
             IF EXISTS (
               SELECT 1 FROM pg_auth_members m
               JOIN pg_roles member ON member.oid = m.member
               JOIN pg_roles granted ON granted.oid = m.roleid
               WHERE member.rolname = 'sa360' AND granted.rolname = role_name
             ) THEN
               EXECUTE format('REVOKE %I FROM sa360', role_name);
             END IF;
             EXECUTE format('DROP OWNED BY %I', role_name);
             EXECUTE format('DROP ROLE %I', role_name);
           END IF;
         END LOOP;
       END
       $drop$;`,
    );
  });

  it("proves PostgreSQL 18 composite arrays, NULLS NOT DISTINCT, plans, and eight-session updates", async () => {
    const version = scalar(db(), `SELECT current_setting('server_version')`);
    assert.match(version, /^18\./);
    psql(
      db(),
      `CREATE FUNCTION g13_composite_probe() RETURNS int
       LANGUAGE plpgsql AS $fn$
       DECLARE desired historical_catalog_summary_apply_desired[];
       BEGIN
         desired := ARRAY[ROW(
           'item', NULL::bigint, false, true, NULL::bigint, NULL::bigint,
           'lot', 'lot', 'imp', 'n', 'j', NULL::text, 'vet', 'vet', 'available', 'july_column_agrees'
         )::historical_catalog_summary_apply_desired];
         IF cardinality(desired) <> 1 OR (desired[1]).item_id <> 'item' THEN
           RAISE EXCEPTION 'composite array mismatch';
         END IF;
         INSERT INTO historical_catalog_summary_checkpoint (range_after, range_until, status)
         VALUES ('g13-probe', 'g13-probe', 'failed');
         RAISE EXCEPTION 'discard function writes';
       END
       $fn$;
       DO $cmp$
       DECLARE
         desired historical_catalog_summary_apply_desired[];
         delta historical_catalog_summary_apply_delta[];
       BEGIN
         desired := ARRAY[ROW(
           'item', NULL::bigint, false, true, NULL::bigint, NULL::bigint,
           'lot', 'lot', 'imp', 'n', 'j', NULL::text, 'vet', 'vet', 'available', 'july_column_agrees'
         )::historical_catalog_summary_apply_desired];
         delta := ARRAY[ROW(1::bigint, 1)::historical_catalog_summary_apply_delta];
         IF cardinality(desired) <> 1 OR (desired[1]).item_id <> 'item' OR (delta[1]).delta <> 1 THEN
           RAISE EXCEPTION 'composite array mismatch';
         END IF;
         BEGIN
           PERFORM g13_composite_probe();
         EXCEPTION WHEN OTHERS THEN
           NULL;
         END;
         IF EXISTS (
           SELECT 1 FROM historical_catalog_summary_checkpoint
           WHERE range_after = 'g13-probe'
         ) THEN
           RAISE EXCEPTION 'function subtransaction kept a checkpoint';
         END IF;
         desired := desired || desired;
         BEGIN
           desired := desired || desired;
           RAISE EXCEPTION 'same-block assignment';
         EXCEPTION WHEN OTHERS THEN
           NULL;
         END;
         IF cardinality(desired) <> 4 THEN
           RAISE EXCEPTION 'same-block composite assignment was undone';
         END IF;
       END
       $cmp$;
       DROP FUNCTION g13_composite_probe();`,
    );

    const grain = script(
      `BEGIN;
       INSERT INTO historical_catalog_summary_label (july_label, normalized_label, label_hash)
       VALUES ('Grain', 'Grain', 'g13-grain');
       INSERT INTO historical_catalog_summary_bucket (
         lot_key, raw_lot_key, import_request, label_pair_id, normalized_label, july_label,
         origin_id, niche_key, raw_niche_key, item_status, label_agreement, n
       )
       SELECT 'grain-lot', 'grain-lot', 'grain-imp', label_pair_id, 'Grain', 'Grain',
              NULL, 'vet', 'vet', 'available', 'july_column_agrees', 0
       FROM historical_catalog_summary_label WHERE label_hash = 'g13-grain';
       INSERT INTO historical_catalog_summary_bucket (
         lot_key, raw_lot_key, import_request, label_pair_id, normalized_label, july_label,
         origin_id, niche_key, raw_niche_key, item_status, label_agreement, n
       )
       SELECT 'grain-lot', 'grain-lot', 'grain-imp', label_pair_id, 'Grain', 'Grain',
              NULL, 'vet', 'vet', 'available', 'july_column_agrees', 0
       FROM historical_catalog_summary_label WHERE label_hash = 'g13-grain';
       COMMIT;`,
    );
    assert.notEqual(grain.status, 0);
    assert.match(grain.output, /historical_catalog_summary_bucket_grain|duplicate key/i);
    const distinctBlank = script(
      `BEGIN;
       INSERT INTO historical_catalog_summary_label (july_label, normalized_label, label_hash)
       VALUES ('Grain Blank', 'Grain Blank', 'g13-grain-blank');
       INSERT INTO historical_catalog_summary_bucket (
         lot_key, raw_lot_key, import_request, label_pair_id, normalized_label, july_label,
         origin_id, niche_key, raw_niche_key, item_status, label_agreement, n
       )
       SELECT 'grain-lot', 'grain-lot', 'grain-blank', label_pair_id, 'Grain Blank', 'Grain Blank',
              origin_id, 'vet', 'vet', 'available', 'july_column_agrees', 0
       FROM historical_catalog_summary_label
       CROSS JOIN (VALUES (NULL::text), ('')) AS origins(origin_id)
       WHERE label_hash = 'g13-grain-blank';
       SELECT count(*) FROM historical_catalog_summary_bucket WHERE import_request = 'grain-blank';
       ROLLBACK;`,
    );
    assert.equal(distinctBlank.status, 0, distinctBlank.output);
    assert.match(
      scalar(db(), `SELECT indexdef FROM pg_indexes WHERE indexname = 'historical_catalog_summary_bucket_grain'`),
      /NULLS NOT DISTINCT/,
    );

    const concurrent = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        psqlAsync(
          `UPDATE "LeadInventoryItem"
           SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
           WHERE id = 'g13-item-${index + 1}'`,
        ),
      ),
    );
    for (const result of concurrent) assert.equal(result.status, 0, result.output);
    assert.equal(
      scalar(db(), `SELECT n::text FROM historical_catalog_summary_bucket WHERE july_label = 'Gate 13' AND item_status = 'reserved'`),
      "8",
    );
    assert.equal(scalar(db(), `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE n < 0`), "0");
    const names = scalar(
      db(),
      `SELECT string_agg(tgname, ',' ORDER BY tgname)
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relname = 'LeadInventoryItem' AND NOT t.tgisinternal
         AND tgname LIKE 'historical_catalog_%'`,
    );
    assert.match(names, /historical_catalog_projection_item_refresh,historical_catalog_summary_item_apply/);

    psql(
      db(),
      `INSERT INTO historical_catalog_summary_label (july_label, normalized_label, label_hash)
       VALUES ('plan-label', 'plan-label', 'plan-label-hash');
       INSERT INTO historical_catalog_summary_bucket (
         lot_key, raw_lot_key, import_request, label_pair_id, normalized_label, july_label,
         origin_id, niche_key, raw_niche_key, item_status, label_agreement, n
       )
       SELECT 'plan-lot', 'plan-lot', 'plan-shared', label.label_pair_id, 'plan-label', 'plan-label',
              NULL, 'niche-' || g, 'niche-' || g, 'available', 'july_column_agrees', 0
       FROM generate_series(1, 20000) g
       CROSS JOIN historical_catalog_summary_label label
       WHERE label.label_hash = 'plan-label-hash';
       INSERT INTO historical_catalog_summary_bucket (
         lot_key, raw_lot_key, import_request, label_pair_id, normalized_label, july_label,
         origin_id, niche_key, raw_niche_key, item_status, label_agreement, n
       )
       SELECT 'vet-hot', 'vet-hot', 'hot-' || g, label.label_pair_id, 'plan-label', 'plan-label',
              NULL, 'vet', 'vet', 'available', 'july_column_agrees', 0
       FROM generate_series(1, 4000) g
       CROSS JOIN historical_catalog_summary_label label
       WHERE label.label_hash = 'plan-label-hash';
       ANALYZE historical_catalog_summary_bucket;`,
    );
    const labelId = scalar(db(), `SELECT label_pair_id::text FROM historical_catalog_summary_label WHERE label_hash = 'plan-label-hash'`);
    const explain = (mode: string, statement: string, niche: string, lot: string, request: string) =>
      scalar(
        db(),
        `PREPARE ${statement}(text, text, text, bigint, text, text, text, text, text) AS
         SELECT bucket_id FROM historical_catalog_summary_bucket
         WHERE ${
           statement.includes("eq")
             ? `lot_key = $1 AND raw_lot_key = $2 AND import_request = $3 AND label_pair_id = $4
                AND niche_key = $5 AND raw_niche_key = $6 AND item_status = $7 AND label_agreement = $8
                AND (($9 IS NULL AND origin_id IS NULL) OR origin_id = $9)`
             : `lot_key IS NOT DISTINCT FROM $1 AND raw_lot_key IS NOT DISTINCT FROM $2
                AND import_request IS NOT DISTINCT FROM $3 AND label_pair_id IS NOT DISTINCT FROM $4
                AND niche_key IS NOT DISTINCT FROM $5 AND raw_niche_key IS NOT DISTINCT FROM $6
                AND item_status IS NOT DISTINCT FROM $7 AND label_agreement IS NOT DISTINCT FROM $8
                AND origin_id IS NOT DISTINCT FROM $9`
         };
         SET plan_cache_mode = ${mode};
         EXPLAIN EXECUTE ${statement}('${lot}','${lot}','${request}', ${labelId}::bigint, '${niche}','${niche}','available','july_column_agrees', NULL::text);`,
      );
    const customEquality = explain("force_custom_plan", "g13_eq", "niche-5", "plan-lot", "plan-shared");
    const genericEquality = explain("force_generic_plan", "g13_gen_eq", "niche-5", "plan-lot", "plan-shared");
    const customDistinct = explain("force_custom_plan", "g13_distinct", "niche-5", "plan-lot", "plan-shared");
    const genericDistinct = explain("force_generic_plan", "g13_gen_distinct", "niche-5", "plan-lot", "plan-shared");
    const customHot = explain("force_custom_plan", "g13_hot_eq", "vet", "vet-hot", "hot-1");
    const genericHot = explain("force_generic_plan", "g13_hot_gen_eq", "vet", "vet-hot", "hot-1");
    assert.match(customEquality, /Index Scan/);
    assert.match(customDistinct, /Seq Scan/);
    assert.match(genericDistinct, /Seq Scan/);
    assert.match(customHot, /Index Scan/);
    writeFileSync(
      "/opt/cursor/artifacts/gate13-pg18-plans.txt",
      [
        `postgres ${version}`,
        "custom equality:",
        customEquality,
        "generic equality:",
        genericEquality,
        "custom distinct:",
        customDistinct,
        "generic distinct:",
        genericDistinct,
        "custom hot equality:",
        customHot,
        "generic hot equality:",
        genericHot,
      ].join("\n"),
    );
    psql(
      db(),
      `DELETE FROM historical_catalog_summary_bucket
       WHERE import_request = 'plan-shared' OR import_request LIKE 'hot-%' OR lot_key = 'vet-hot';
       DELETE FROM historical_catalog_summary_label WHERE label_hash = 'plan-label-hash';`,
    );
  });

  it("shows column grants cannot confine summary_ready to false, while the owner can disable a guard", () => {
    const early = fileResult(join(candidateDir, "../historical-catalog-summary-role-security-v1/preconditions.sql"));
    assert.notEqual(early.status, 0);
    assert.match(early.output, /preconditions refused/);
    psql(
      db(),
      `GRANT UPDATE (summary_ready), SELECT ON historical_catalog_summary_control TO sa360_summary_unauth;
       SET ROLE sa360_summary_unauth;
       UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;`,
    );
    assert.equal(control().ready, "true");
    psql(db(), `RESET ROLE; UPDATE historical_catalog_summary_control SET summary_ready = false WHERE singleton;`);
    psql(
      db(),
      `CREATE FUNCTION g13_ready_guard() RETURNS trigger
       LANGUAGE plpgsql
       SET search_path = pg_catalog, public
       AS $fn$
       BEGIN
         IF NEW.summary_ready IS TRUE AND OLD.summary_ready IS DISTINCT FROM TRUE AND current_user <> 'sa360_summary_operator' THEN
           RAISE EXCEPTION 'ready transition denied' USING ERRCODE = '42501';
         END IF;
         RETURN NEW;
       END
       $fn$;
       CREATE TRIGGER g13_ready_guard
       BEFORE UPDATE ON historical_catalog_summary_control
       FOR EACH ROW EXECUTE FUNCTION g13_ready_guard();`,
    );
    const blocked = script(
      `SET ROLE sa360_summary_unauth;
       UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;`,
    );
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.output, /ready transition denied/);
    const cleared = script(
      `SET ROLE sa360_summary_unauth;
       UPDATE historical_catalog_summary_control SET summary_ready = false WHERE singleton;`,
    );
    assert.equal(cleared.status, 0, cleared.output);
    const noDisable = script(
      `SET ROLE sa360_summary_unauth;
       ALTER TABLE historical_catalog_summary_control DISABLE TRIGGER g13_ready_guard;`,
    );
    assert.notEqual(noDisable.status, 0);
    assert.match(noDisable.output, /must be owner/i);
    psql(
      db(),
      `RESET ROLE;
       ALTER TABLE historical_catalog_summary_control DISABLE TRIGGER g13_ready_guard;
       UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;
       ALTER TABLE historical_catalog_summary_control ENABLE TRIGGER g13_ready_guard;
       UPDATE historical_catalog_summary_control SET summary_ready = false WHERE singleton;
       DROP TRIGGER g13_ready_guard ON historical_catalog_summary_control;
       DROP FUNCTION g13_ready_guard();
       REVOKE ALL ON historical_catalog_summary_control FROM sa360_summary_unauth;`,
    );
    assert.equal(control().ready, "false");
  });

  it("separates runtime invalidation from operator authorization after ownership moves", () => {
    const transformed = fileResult(
      join(candidateDir, "../historical-catalog-summary-role-security-v1/transform-owner-rights.sql"),
    );
    assert.equal(transformed.status, 0, transformed.output);
    const pre = fileResult(join(candidateDir, "../historical-catalog-summary-role-security-v1/preconditions.sql"));
    assert.equal(pre.status, 0, pre.output);
    const post = fileResult(join(candidateDir, "../historical-catalog-summary-role-security-v1/postconditions.sql"));
    assert.equal(post.status, 0, post.output);

    const before = control();
    const maintained = script(
      `SET ROLE sa360_app;
       UPDATE "LeadInventoryItem" SET status = 'available', "availableAt" = now(), "reservedAt" = NULL, "updatedAt" = now()
       WHERE id = 'g13-item-1';`,
    );
    assert.equal(maintained.status, 0, maintained.output);
    assert.equal(scalar(db(), `SELECT status::text FROM "LeadInventoryItem" WHERE id = 'g13-item-1'`), "available");
    assert.equal(
      scalar(
        db(),
        `SELECT b.item_status
         FROM historical_catalog_summary_membership m
         JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id
         WHERE m.item_id = 'g13-item-1'`,
      ),
      "available",
    );
    assert.equal(control().epoch, before.epoch);

    for (const statement of [
      `UPDATE historical_catalog_summary_control SET summary_ready = true`,
      `UPDATE historical_catalog_summary_control SET summary_epoch = summary_epoch + 1`,
      `UPDATE historical_catalog_summary_bucket SET n = n + 1`,
      `INSERT INTO historical_catalog_summary_checkpoint (range_after, range_until, status) VALUES ('', 'z', 'complete')`,
      `SELECT historical_catalog_summary_authorize()`,
      `CALL historical_catalog_summary_backfill_range('', 'g13-item-1')`,
      `SELECT historical_catalog_summary_reconcile_issues()`,
    ]) {
      const denied = script(`SET ROLE sa360_app; ${statement};`);
      assert.notEqual(denied.status, 0, statement);
      assert.match(denied.output, /permission denied/i, statement);
    }
    const readerDenied = script(
      `SET ROLE sa360_summary_reader;
       UPDATE historical_catalog_summary_control SET summary_ready = true;`,
    );
    assert.notEqual(readerDenied.status, 0);
    assert.match(readerDenied.output, /permission denied/i);
    const readerOk = script(`SET ROLE sa360_summary_reader; SELECT historical_catalog_summary_readable();`);
    assert.equal(readerOk.status, 0, readerOk.output);
    const readerScan = script(`SET ROLE sa360_summary_reader; SELECT historical_catalog_summary_reconcile_issues();`);
    assert.notEqual(readerScan.status, 0);
    assert.match(readerScan.output, /permission denied/i);
    const unauth = script(`SET ROLE sa360_summary_unauth; SELECT historical_catalog_summary_mark_unready('maintenance', false);`);
    assert.notEqual(unauth.status, 0);
    assert.match(unauth.output, /permission denied/i);
    const operatorDirect = script(
      `SET ROLE sa360_summary_operator;
       UPDATE historical_catalog_summary_control SET summary_ready = true;`,
    );
    assert.notEqual(operatorDirect.status, 0);
    assert.match(operatorDirect.output, /permission denied/i);

    const directInvalidate = script(
      `SET ROLE sa360_app;
       SELECT historical_catalog_summary_mark_unready('maintenance', false);`,
    );
    assert.notEqual(directInvalidate.status, 0);
    assert.match(directInvalidate.output, /permission denied/i);
    assert.equal(control().epoch, before.epoch);
    const renamed = script(
      `SET ROLE sa360_app;
       UPDATE "InventoryLot" SET "lotKey" = 'vet-g13-renamed', "updatedAt" = now() WHERE id = 'lot-g13';`,
    );
    assert.equal(renamed.status, 0, renamed.output);
    assert.equal(control().ready, "false");
    assert.equal(control().epoch, String(Number(before.epoch) + 1));
    const nicheBefore = scalar(db(), `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'g13-item-1'`);
    const rolled = script(
      `BEGIN;
       SET LOCAL ROLE sa360_app;
       UPDATE "LeadInventoryItem" SET "nicheKey" = 'rollback-niche', "updatedAt" = now() WHERE id = 'g13-item-1';
       SELECT historical_catalog_summary_mark_unready('not-allowlisted', false);
       COMMIT;`,
    );
    assert.notEqual(rolled.status, 0);
    assert.match(rolled.output, /permission denied/i);
    assert.equal(scalar(db(), `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'g13-item-1'`), nicheBefore);
    const rejected = script(
      `SET ROLE sa360_schema_owner;
       SELECT historical_catalog_summary_mark_unready('not-allowlisted', false);`,
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.output, /not allowlisted|SB007/);
    assert.equal(control().epoch, String(Number(before.epoch) + 1));
    const missing = script(
      `BEGIN;
       DELETE FROM historical_catalog_summary_control;
       UPDATE "LeadInventoryItem" SET "nicheKey" = 'missing-control', "updatedAt" = now() WHERE id = 'g13-item-1';
       SELECT historical_catalog_summary_mark_unready('maintenance', false);
       COMMIT;`,
    );
    assert.notEqual(missing.status, 0);
    assert.match(missing.output, /SB008|control row missing/);
    assert.equal(scalar(db(), `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'g13-item-1'`), nicheBefore);
    assert.equal(scalar(db(), `SELECT count(*)::text FROM historical_catalog_summary_control`), "1");

    const backfill = script(
      `SET ROLE sa360_summary_operator;
       CALL historical_catalog_summary_backfill_range('', 'g13-item-8');
       RESET ROLE;`,
    );
    assert.equal(backfill.status, 0, backfill.output);
    const authorized = script(
      `SET ROLE sa360_summary_operator;
       SELECT historical_catalog_summary_authorize() ->> 'authorized';
       RESET ROLE;`,
    );
    assert.equal(authorized.status, 0, authorized.output);
    assert.match(authorized.output, /true/);
    assert.equal(control().ready, "true");
    const stillDenied = script(`SET ROLE sa360_app; SELECT historical_catalog_summary_authorize();`);
    assert.notEqual(stillDenied.status, 0);
    assert.match(stillDenied.output, /permission denied/i);
    assert.equal(control().ready, "true");
  });

  it("shows inherited ownership and schema CREATE can escalate, and the safe grants do not", () => {
    const inherited = script(
      `UPDATE historical_catalog_summary_control SET summary_ready = false WHERE singleton;
       SELECT summary_ready::text FROM historical_catalog_summary_control;`,
    );
    assert.equal(inherited.status, 0, inherited.output);
    assert.match(inherited.output, /false/);
    psql(db(), `SELECT historical_catalog_summary_mark_unready('maintenance', false);`);
    const setRoleOwner = script(
      `SET ROLE sa360_schema_owner;
       ALTER TABLE historical_catalog_summary_control DISABLE TRIGGER USER;
       UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;`,
    );
    assert.equal(setRoleOwner.status, 0, setRoleOwner.output);
    assert.equal(control().ready, "true");
    psql(
      db(),
      `RESET ROLE;
       ALTER TABLE historical_catalog_summary_control ENABLE TRIGGER USER;
       SELECT historical_catalog_summary_mark_unready('maintenance', false);`,
    );
    assert.equal(control().ready, "false");

    asPostgres(database, `GRANT sa360_schema_owner TO sa360_app WITH INHERIT TRUE, SET TRUE;`);
    const escalated = script(
      `SET ROLE sa360_app;
       UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;`,
    );
    assert.equal(escalated.status, 0, escalated.output);
    assert.equal(control().ready, "true");
    asPostgres(database, `REVOKE sa360_schema_owner FROM sa360_app;`);
    psql(db(), `SELECT historical_catalog_summary_mark_unready('maintenance', false);`);
    const held = script(
      `SET ROLE sa360_app;
       UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;`,
    );
    assert.notEqual(held.status, 0);
    assert.match(held.output, /permission denied/i);
    asPostgres(database, `GRANT sa360_schema_owner TO sa360_app WITH INHERIT FALSE, SET TRUE;`);
    const setOnly = script(
      `SET ROLE sa360_app;
       UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;`,
    );
    assert.notEqual(setOnly.status, 0);
    assert.match(setOnly.output, /permission denied/i);
    const switched = script(
      `SET ROLE sa360_app;
       SET ROLE sa360_schema_owner;
       UPDATE historical_catalog_summary_control SET summary_ready = true WHERE singleton;`,
    );
    assert.equal(switched.status, 0, switched.output);
    asPostgres(database, `REVOKE sa360_schema_owner FROM sa360_app;`);
    psql(db(), `SELECT historical_catalog_summary_mark_unready('maintenance', false);`);

    psql(db(), `GRANT CREATE ON SCHEMA public TO sa360_app;`);
    const replace = script(
      `SET ROLE sa360_app;
       CREATE OR REPLACE FUNCTION historical_catalog_summary_authorize()
       RETURNS jsonb LANGUAGE sql AS $fn$ SELECT '{"authorized":true}'::jsonb $fn$;`,
    );
    assert.notEqual(replace.status, 0);
    assert.match(replace.output, /must be owner/i);
    psql(
      db(),
      `RESET ROLE;
       REVOKE CREATE ON SCHEMA public FROM sa360_app;
       CREATE FUNCTION g13_definer_calls_helper() RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
       AS $fn$ BEGIN PERFORM g13_helper(); END $fn$;
       ALTER FUNCTION g13_definer_calls_helper() OWNER TO sa360_schema_owner;
       REVOKE ALL ON FUNCTION g13_definer_calls_helper() FROM PUBLIC;
       GRANT EXECUTE ON FUNCTION g13_definer_calls_helper() TO sa360_app;
       CREATE FUNCTION g13_definer_calls_helper_temp_last() RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
       AS $fn$ BEGIN PERFORM g13_helper(); END $fn$;
       ALTER FUNCTION g13_definer_calls_helper_temp_last() OWNER TO sa360_schema_owner;
       REVOKE ALL ON FUNCTION g13_definer_calls_helper_temp_last() FROM PUBLIC;
       GRANT EXECUTE ON FUNCTION g13_definer_calls_helper_temp_last() TO sa360_app;`,
    );
    const omitted = script(
      `SET ROLE sa360_app;
       CREATE FUNCTION pg_temp.g13_helper() RETURNS void LANGUAGE plpgsql AS $fn$
       BEGIN RAISE EXCEPTION 'temp helper ran'; END $fn$;
       SELECT g13_definer_calls_helper();`,
    );
    assert.notEqual(omitted.status, 0);
    assert.match(omitted.output, /does not exist/);
    assert.doesNotMatch(omitted.output, /temp helper ran/);
    const tempLast = script(
      `SET ROLE sa360_app;
       CREATE FUNCTION pg_temp.g13_helper() RETURNS void LANGUAGE plpgsql AS $fn$
       BEGIN RAISE EXCEPTION 'temp helper ran'; END $fn$;
       SELECT g13_definer_calls_helper_temp_last();`,
    );
    assert.notEqual(tempLast.status, 0);
    assert.match(tempLast.output, /does not exist/);
    assert.doesNotMatch(tempLast.output, /temp helper ran/);
    psql(db(), `GRANT CREATE ON SCHEMA public TO sa360_app;`);
    const planted = script(
      `SET ROLE sa360_app;
       CREATE FUNCTION public.g13_helper() RETURNS void LANGUAGE plpgsql AS $fn$
       BEGIN RAISE EXCEPTION 'public helper ran'; END $fn$;
       SELECT g13_definer_calls_helper();`,
    );
    assert.notEqual(planted.status, 0);
    assert.match(planted.output, /public helper ran/);
    psql(
      db(),
      `RESET ROLE;
       DROP FUNCTION public.g13_helper();
       REVOKE CREATE ON SCHEMA public FROM sa360_app;
       CREATE TABLE g13_shadow (n integer);
       INSERT INTO g13_shadow VALUES (1);
       ALTER TABLE g13_shadow OWNER TO sa360_schema_owner;
       CREATE FUNCTION g13_shadow_bump() RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
       AS $fn$ BEGIN UPDATE g13_shadow SET n = n + 1; END $fn$;
       ALTER FUNCTION g13_shadow_bump() OWNER TO sa360_schema_owner;
       REVOKE ALL ON FUNCTION g13_shadow_bump() FROM PUBLIC;
       GRANT EXECUTE ON FUNCTION g13_shadow_bump() TO sa360_app;`,
    );
    const shadow = script(
      `SET ROLE sa360_app;
       CREATE TEMP TABLE g13_shadow (n integer);
       INSERT INTO pg_temp.g13_shadow VALUES (50);
       SELECT g13_shadow_bump();`,
    );
    assert.equal(shadow.status, 0, shadow.output);
    assert.equal(scalar(db(), `SELECT n::text FROM public.g13_shadow`), "2");
    psql(db(), `DROP FUNCTION g13_shadow_bump(); DROP TABLE g13_shadow;`);
    psql(
      db(),
      `RESET ROLE;
       DROP FUNCTION g13_definer_calls_helper();
       DROP FUNCTION g13_definer_calls_helper_temp_last();`,
    );
    const finalPre = fileResult(join(candidateDir, "../historical-catalog-summary-role-security-v1/preconditions.sql"));
    assert.equal(finalPre.status, 0, finalPre.output);
    const finalPost = fileResult(join(candidateDir, "../historical-catalog-summary-role-security-v1/postconditions.sql"));
    assert.equal(finalPost.status, 0, finalPost.output);
    assert.equal(
      scalar(
        db(),
        `SELECT count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE NOT t.tgisinternal AND t.tgname LIKE 'historical_catalog_projection_%' AND t.tgenabled = 'O'`,
      ),
      "3",
    );
  });
});
