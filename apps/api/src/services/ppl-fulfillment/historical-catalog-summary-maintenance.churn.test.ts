/**
 * Catalog-churn comparison for 10,000 ordinary historical item updates.
 * The reviewed candidate is loaded from git. The improved candidate is the
 * working tree. Disposable databases only.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  candidateDir,
  dropDatabase,
  integrationUrl,
  localDatabaseUrl,
  migrate,
  psql,
  psqlFile,
  recreate,
  scalar,
} from "./historical-catalog-summary-maintenance.harness.js";

const reviewedSha = "c6579af7979a3e426cd058241a7fbf5125009f50";
const operations = 10_000;
const run = Boolean(integrationUrl());

function seedAndMeasure(database: string, functionsPath: string): Record<string, unknown> {
  const databaseUrl = recreate(database);
  migrate(databaseUrl);
  psqlFile(databaseUrl, functionsPath);
  const version = scalar(databaseUrl, `SELECT current_setting('server_version')`);
  psql(
    databaseUrl,
    `ALTER TABLE "LeadInventoryItem" DISABLE TRIGGER historical_catalog_projection_item_refresh;
     ALTER TABLE "SourceLeadEvent" DISABLE TRIGGER historical_catalog_projection_event_refresh;
     ALTER TABLE "InventoryLot" DISABLE TRIGGER historical_catalog_projection_lot_refresh;
     INSERT INTO "InventoryLot" (
       id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey", "inventoryClass", status, "createdAt", "updatedAt"
     ) VALUES ('lot-churn', 'vet-churn', 'Churn', 'manual_import', 'bench', 'vet', 'aged', 'active', now(), now());
     INSERT INTO "SourceLeadEvent" (
       id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
       "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
     )
     SELECT 'c' || lpad(g::text, 5, '0'), 'manual_import'::"SourceLeadProvider", 'csv_import'::"SourceLeadSystem",
            'bulk_import'::"SourceLeadType", 'approved'::"SourceLeadEventStatus", 'Churn July',
            jsonb_build_object('importRequestId', 'imp-churn'),
            jsonb_build_object('campaign_name', 'Churn July'),
            now(), now(), now()
     FROM generate_series(1, ${operations}) g;
     INSERT INTO "LeadInventoryItem" (
       id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
       "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
     )
     SELECT 'c' || lpad(g::text, 5, '0'), 'lot-churn', 'c' || lpad(g::text, 5, '0'),
            TIMESTAMPTZ '2024-06-01T00:00:00Z', 'GA', 'vet',
            'manual_import'::"SourceLeadProvider", 'bench', 'aged'::"LeadInventoryClass",
            'available'::"LeadInventoryItemStatus", TIMESTAMPTZ '2024-07-01T00:00:00Z', now(), now()
     FROM generate_series(1, ${operations}) g;
     INSERT INTO historical_catalog_projection (
       item_id, lot_key, import_request, niche_key, item_status, origin_id, july_label, normalized_label, label_agreement, refreshed_at
     )
     SELECT item_id, lot_key, import_request, niche_key, item_status, origin_id, july_label, normalized_label, label_agreement, clock_timestamp()
     FROM historical_catalog_projection_source;
     ALTER TABLE "LeadInventoryItem" ENABLE TRIGGER historical_catalog_projection_item_refresh;
     ALTER TABLE "SourceLeadEvent" ENABLE TRIGGER historical_catalog_projection_event_refresh;
     ALTER TABLE "InventoryLot" ENABLE TRIGGER historical_catalog_projection_lot_refresh;
     ANALYZE historical_catalog_projection;
     ANALYZE "LeadInventoryItem";`,
  );
  psqlFile(databaseUrl, join(candidateDir, "triggers.sql"));
  psql(
    databaseUrl,
    `CREATE TABLE g12_churn_latency (ms double precision NOT NULL);
     CREATE PROCEDURE g12_churn_flip()
     LANGUAGE plpgsql AS $fn$
     DECLARE
       r record;
       t0 timestamptz;
     BEGIN
       FOR r IN
         SELECT id FROM "LeadInventoryItem" WHERE id LIKE 'c%' ORDER BY id
       LOOP
         t0 := clock_timestamp();
         UPDATE "LeadInventoryItem"
         SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
         WHERE id = r.id;
         INSERT INTO g12_churn_latency(ms) VALUES (extract(epoch FROM clock_timestamp() - t0) * 1000);
         COMMIT;
       END LOOP;
     END;
     $fn$;`,
  );
  const before = snapshot(databaseUrl);
  const started = Date.now();
  psql(databaseUrl, `CALL g12_churn_flip()`);
  const wallMs = Date.now() - started;
  const afterSnap = snapshot(databaseUrl);
  const [median, p95, n] = scalar(
    databaseUrl,
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)::text
       || '|' || percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::text
       || '|' || count(*)::text
     FROM g12_churn_latency`,
  ).split("|");
  assert.equal(n, String(operations));
  assert.equal(
    scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_membership WHERE accounted`),
    String(operations),
  );
  assert.equal(
    scalar(databaseUrl, `SELECT coalesce(sum(n), 0)::text FROM historical_catalog_summary_bucket`),
    String(operations),
  );
  assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE n < 0`), "0");
  assert.equal(scalar(databaseUrl, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
  assert.equal(
    scalar(databaseUrl, `SELECT count(*)::text FROM pg_class WHERE relpersistence = 't' AND relname IN ('summary_apply_desired', 'summary_apply_delta')`),
    "0",
  );
  const connections = Number(
    scalar(databaseUrl, `SELECT count(*)::text FROM pg_stat_activity WHERE datname = current_database()`),
  );
  return {
    version,
    operations,
    median: Number(median),
    p95: Number(p95),
    n: Number(n),
    wallMs,
    connections,
    catalogBefore: before.catalog,
    catalogAfter: afterSnap.catalog,
    catalogDelta: delta(before.catalog, afterSnap.catalog),
    databaseBefore: before.database,
    databaseAfter: afterSnap.database,
    databaseDelta: delta(before.database, afterSnap.database),
    tempTablesLive: Number(scalar(databaseUrl, `SELECT count(*)::text FROM pg_class WHERE relpersistence = 't'`)),
    deadlocks: afterSnap.database.deadlocks - before.database.deadlocks,
  };
}

function snapshot(databaseUrl: string): { catalog: Record<string, CatalogRow>; database: Record<string, number> } {
  const catalogRows = scalar(
    databaseUrl,
    `SELECT string_agg(
       relname || '=' || n_tup_ins::text || ',' || n_tup_del::text || ',' || n_dead_tup::text || ',' || n_live_tup::text,
       '|' ORDER BY relname
     )
     FROM pg_stat_all_tables
     WHERE schemaname = 'pg_catalog'
       AND relname IN ('pg_class', 'pg_attribute', 'pg_type', 'pg_depend', 'pg_namespace')`,
  );
  const catalog: Record<string, CatalogRow> = {};
  for (const part of catalogRows.split("|")) {
    const [name, values] = part.split("=");
    const [ins, del, dead, live] = values.split(",").map(Number);
    catalog[name] = { ins, del, dead, live };
  }
  const [xactCommit, xactRollback, blksHit, blksRead, tupReturned, tupFetched, tupInserted, tupUpdated, deadlocks, tempFiles, tempBytes] =
    scalar(
      databaseUrl,
      `SELECT xact_commit::text || '|' || xact_rollback::text || '|' || blks_hit::text || '|' || blks_read::text
         || '|' || tup_returned::text || '|' || tup_fetched::text || '|' || tup_inserted::text || '|' || tup_updated::text
         || '|' || deadlocks::text || '|' || temp_files::text || '|' || temp_bytes::text
       FROM pg_stat_database WHERE datname = current_database()`,
    ).split("|").map(Number);
  return {
    catalog,
    database: {
      xactCommit,
      xactRollback,
      blksHit,
      blksRead,
      tupReturned,
      tupFetched,
      tupInserted,
      tupUpdated,
      deadlocks,
      tempFiles,
      tempBytes,
    },
  };
}

type CatalogRow = { ins: number; del: number; dead: number; live: number };

function delta(before: Record<string, number | CatalogRow>, after: Record<string, number | CatalogRow>): Record<string, number | CatalogRow> {
  const out: Record<string, number | CatalogRow> = {};
  for (const key of Object.keys(after)) {
    const left = before[key];
    const right = after[key];
    if (typeof right === "number" && typeof left === "number") {
      out[key] = right - left;
    } else if (right && left && typeof right === "object" && typeof left === "object") {
      out[key] = {
        ins: right.ins - left.ins,
        del: right.del - left.del,
        dead: right.dead - left.dead,
        live: right.live - left.live,
      };
    }
  }
  return out;
}

describe("historical catalog summary maintenance catalog churn", { skip: !run, timeout: 600_000 }, () => {
  const databases = ["sa360_test_g12_churn_old", "sa360_test_g12_churn_new"];

  after(() => {
    if (!run) return;
    for (const database of databases) dropDatabase(database);
  });

  it("compares 10000 item updates against the reviewed temporary-table candidate", () => {
    const reviewedPath = "/tmp/g12-reviewed-functions.sql";
    const shown = spawnSync("git", ["show", `${reviewedSha}:prisma/candidates/historical-catalog-summary-maintenance-v1/functions.sql`], {
      cwd: "/workspace",
      encoding: "utf8",
    });
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /CREATE TEMP TABLE summary_apply_desired/);
    writeFileSync(reviewedPath, shown.stdout);
    console.log("churn: measuring reviewed candidate");
    const reviewed = seedAndMeasure("sa360_test_g12_churn_old", reviewedPath);
    console.log("churn: measuring array candidate");
    const hardened = seedAndMeasure("sa360_test_g12_churn_new", join(candidateDir, "functions.sql"));
    const report = { reviewedSha, reviewed, hardened };
    writeFileSync("/opt/cursor/artifacts/gate12-churn.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    const reviewedClass = (reviewed.catalogDelta as { pg_class: CatalogRow }).pg_class;
    const hardenedClass = (hardened.catalogDelta as { pg_class: CatalogRow }).pg_class;
    assert.ok(reviewedClass.ins > operations, `reviewed pg_class inserts ${reviewedClass.ins}`);
    assert.ok(hardenedClass.ins < reviewedClass.ins / 10, `hardened pg_class inserts ${hardenedClass.ins}`);
    assert.equal((hardened.databaseDelta as { deadlocks: number }).deadlocks, 0);
    assert.equal((reviewed.databaseDelta as { deadlocks: number }).deadlocks, 0);
    assert.equal(hardened.connections, 1);
  });
});
