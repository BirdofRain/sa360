/**
 * Local intake-latency and planner proof for summary maintenance.
 * About 250,000 historical projection rows. Disposable database only.
 * Timings are PostgreSQL 16 on this machine, not a production guarantee.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  candidateDir,
  dropDatabase,
  integrationUrl,
  loadCandidate,
  localDatabaseUrl,
  migrate,
  psql,
  psqlFile,
  recreate,
  scalar,
} from "./historical-catalog-summary-maintenance.harness.js";

const database = "sa360_test_g12_bench";
const run = Boolean(integrationUrl());
const vetRows = 216_000;
const otherRows = 34_000;
const liveRows = 1_000;
const historicalRows = vetRows + otherRows;

function psqlAsync(sql: string): Promise<{ status: number | null; output: string }> {
  const databaseUrl = localDatabaseUrl(database);
  return new Promise((resolve) => {
    const child = spawn("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql]);
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

function percentile(kind: string): { median: number; p95: number; n: number } {
  const [median, p95, n] = scalar(
    localDatabaseUrl(database),
    `SELECT coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms), 0)::text
       || '|' || coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms), 0)::text
       || '|' || count(*)::text
     FROM g12_bench_latency WHERE kind = '${kind}'`,
  ).split("|");
  return { median: Number(median), p95: Number(p95), n: Number(n) };
}

describe("historical catalog summary maintenance bench", { skip: !run, timeout: 600_000 }, () => {
  after(() => {
    if (run) dropDatabase(database);
  });

  it("measures intake with and without summary maintenance", async () => {
    const databaseUrl = recreate(database);
    migrate(databaseUrl);
    loadCandidate(databaseUrl, false);
    console.log("bench: migrated and functions loaded");
    const version = scalar(databaseUrl, `SELECT current_setting('server_version')`);
    psql(
      databaseUrl,
      `ALTER TABLE "LeadInventoryItem" DISABLE TRIGGER historical_catalog_projection_item_refresh;
       ALTER TABLE "SourceLeadEvent" DISABLE TRIGGER historical_catalog_projection_event_refresh;
       ALTER TABLE "InventoryLot" DISABLE TRIGGER historical_catalog_projection_lot_refresh;
       INSERT INTO "InventoryLot" (
         id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey", "inventoryClass", status, "createdAt", "updatedAt"
       ) VALUES ('lot-vet', 'vet-historical', 'Vet', 'manual_import', 'bench', 'vet', 'aged', 'active', now(), now());
       INSERT INTO "InventoryLot" (
         id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey", "inventoryClass", status, "createdAt", "updatedAt"
       )
       SELECT 'lot-o-' || lpad(g::text, 2, '0'), 'other-' || g, 'Other ' || g,
              'manual_import', 'bench', 'vet', 'aged', 'active', now(), now()
       FROM generate_series(1, 34) g;
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
         "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
       )
       SELECT 'v' || lpad(g::text, 6, '0'), 'manual_import'::"SourceLeadProvider", 'csv_import'::"SourceLeadSystem",
              'bulk_import'::"SourceLeadType", 'approved'::"SourceLeadEventStatus",
              CASE WHEN g <= 200000 THEN 'Vet Main' ELSE 'Vet ' || (g % 200) END,
              jsonb_build_object('importRequestId', 'imp-vet'),
              jsonb_build_object('campaign_name', CASE WHEN g <= 200000 THEN 'Vet Main' ELSE 'Vet ' || (g % 200) END),
              now(), now(), now()
       FROM generate_series(1, ${vetRows}) g;
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       )
       SELECT 'v' || lpad(g::text, 6, '0'), 'lot-vet', 'v' || lpad(g::text, 6, '0'),
              TIMESTAMPTZ '2024-06-01T00:00:00Z', 'GA', 'vet',
              'manual_import'::"SourceLeadProvider", 'bench', 'aged'::"LeadInventoryClass",
              'available'::"LeadInventoryItemStatus", TIMESTAMPTZ '2024-07-01T00:00:00Z', now(), now()
       FROM generate_series(1, ${vetRows}) g;
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
         "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
       )
       SELECT 'o' || lpad(g::text, 6, '0'), 'manual_import'::"SourceLeadProvider", 'csv_import'::"SourceLeadSystem",
              'bulk_import'::"SourceLeadType", 'approved'::"SourceLeadEventStatus",
              'Other ' || (((g - 1) / 1000) + 1),
              jsonb_build_object('importRequestId', 'imp-o-' || (((g - 1) / 1000) + 1)),
              jsonb_build_object('campaign_name', 'Other ' || (((g - 1) / 1000) + 1)),
              now(), now(), now()
       FROM generate_series(1, ${otherRows}) g;
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       )
       SELECT 'o' || lpad(g::text, 6, '0'), 'lot-o-' || lpad((((g - 1) / 1000) + 1)::text, 2, '0'),
              'o' || lpad(g::text, 6, '0'),
              TIMESTAMPTZ '2024-06-01T00:00:00Z', 'GA', 'vet',
              'manual_import'::"SourceLeadProvider", 'bench', 'aged'::"LeadInventoryClass",
              'available'::"LeadInventoryItemStatus", TIMESTAMPTZ '2024-07-01T00:00:00Z', now(), now()
       FROM generate_series(1, ${otherRows}) g;
       INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "rawPayloadJson", "receivedAt", "createdAt", "updatedAt"
       )
       SELECT 'l' || lpad(g::text, 4, '0'), 'leadcapture_io'::"SourceLeadProvider", 'leadcapture_io_nextgen'::"SourceLeadSystem",
              'bulk_import'::"SourceLeadType", 'received'::"SourceLeadEventStatus", '{}'::jsonb, now(), now(), now()
       FROM generate_series(1, ${liveRows}) g;
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "createdAt", "updatedAt"
       )
       SELECT 'l' || lpad(g::text, 4, '0'), 'lot-vet', 'l' || lpad(g::text, 4, '0'),
              now(), 'GA', 'vet', 'leadcapture_io'::"SourceLeadProvider", 'bench', 'aged'::"LeadInventoryClass",
              'pending_review'::"LeadInventoryItemStatus", now(), now()
       FROM generate_series(1, ${liveRows}) g;
       INSERT INTO historical_catalog_projection (
         item_id, lot_key, import_request, niche_key, item_status, origin_id, july_label, normalized_label, label_agreement, refreshed_at
       )
       SELECT item_id, lot_key, import_request, niche_key, item_status, origin_id, july_label, normalized_label, label_agreement, clock_timestamp()
       FROM historical_catalog_projection_source;
       ALTER TABLE "LeadInventoryItem" ENABLE TRIGGER historical_catalog_projection_item_refresh;
       ALTER TABLE "SourceLeadEvent" ENABLE TRIGGER historical_catalog_projection_event_refresh;
       ALTER TABLE "InventoryLot" ENABLE TRIGGER historical_catalog_projection_lot_refresh;
       ANALYZE historical_catalog_projection;
       ANALYZE "LeadInventoryItem";
       ANALYZE "SourceLeadEvent";
       ANALYZE "InventoryLot";`,
    );
    console.log("bench: historical rows loaded");
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_projection`), String(historicalRows));
    assert.equal(
      scalar(databaseUrl, `SELECT count(*)::text FROM "LeadInventoryItem" WHERE "sourceProvider" = 'leadcapture_io'`),
      String(liveRows),
    );

    psql(
      databaseUrl,
      `CREATE TABLE g12_bench_latency (kind text NOT NULL, ms double precision NOT NULL);
       CREATE PROCEDURE g12_bench_flip(p_kind text, p_like text, p_offset integer, p_limit integer)
       LANGUAGE plpgsql AS $fn$
       DECLARE
         r record;
         t0 timestamptz;
       BEGIN
         FOR r IN
           SELECT id, status::text AS status
           FROM "LeadInventoryItem"
           WHERE id LIKE p_like
           ORDER BY id
           OFFSET p_offset
           LIMIT p_limit
         LOOP
           t0 := clock_timestamp();
           IF r.status = 'available' THEN
             UPDATE "LeadInventoryItem"
             SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
             WHERE id = r.id;
           ELSE
             UPDATE "LeadInventoryItem"
             SET status = 'available', "availableAt" = coalesce("availableAt", now()), "updatedAt" = now()
             WHERE id = r.id;
           END IF;
           INSERT INTO g12_bench_latency(kind, ms)
           VALUES (p_kind, extract(epoch FROM clock_timestamp() - t0) * 1000);
           COMMIT;
         END LOOP;
       END; $fn$;
       CREATE PROCEDURE g12_bench_touch(p_kind text, p_like text, p_limit integer, p_mode text)
       LANGUAGE plpgsql AS $fn$
       DECLARE
         r record;
         t0 timestamptz;
       BEGIN
         FOR r IN
           SELECT id FROM "LeadInventoryItem" WHERE id LIKE p_like ORDER BY id LIMIT p_limit
         LOOP
           t0 := clock_timestamp();
           IF p_mode = 'noop' THEN
             UPDATE "LeadInventoryItem" SET status = status, "updatedAt" = now() WHERE id = r.id;
           ELSIF p_mode = 'live' THEN
             UPDATE "LeadInventoryItem" SET "nicheKey" = "nicheKey", "updatedAt" = now() WHERE id = r.id;
           ELSIF p_mode = 'event' THEN
             UPDATE "SourceLeadEvent"
             SET "sourceCampaignName" = 'Vet Touched',
                 "normalizedPayloadJson" = '{"campaign_name":"Vet Touched"}'::jsonb,
                 "updatedAt" = now()
             WHERE id = r.id;
           ELSE
             UPDATE "LeadInventoryItem" SET "inventoryLotId" = 'lot-o-01', "updatedAt" = now() WHERE id = r.id;
           END IF;
           INSERT INTO g12_bench_latency(kind, ms)
           VALUES (p_kind, extract(epoch FROM clock_timestamp() - t0) * 1000);
           COMMIT;
         END LOOP;
       END; $fn$;
       CREATE PROCEDURE g12_bench_flip_slot(p_slot integer, p_limit integer)
       LANGUAGE plpgsql AS $fn$
       DECLARE
         r record;
         t0 timestamptz;
       BEGIN
         FOR r IN
           SELECT id
           FROM "LeadInventoryItem"
           WHERE id LIKE 'v%'
             AND status = 'available'
             AND abs(hashtext(id)) % 8 = p_slot
           ORDER BY id
           LIMIT p_limit
         LOOP
           t0 := clock_timestamp();
           UPDATE "LeadInventoryItem"
           SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now()
           WHERE id = r.id;
           INSERT INTO g12_bench_latency(kind, ms)
           VALUES ('concurrent', extract(epoch FROM clock_timestamp() - t0) * 1000);
           COMMIT;
         END LOOP;
       END; $fn$;`,
    );

    psql(databaseUrl, `CALL g12_bench_flip('baseline', 'v%', 0, 200)`);
    psql(databaseUrl, `CALL g12_bench_touch('baseline_live', 'l%', 100, 'live')`);
    const baseline = percentile("baseline");
    const baselineLive = percentile("baseline_live");
    assert.equal(baseline.n, 200);
    assert.equal(baselineLive.n, 100);

    console.log("bench: baseline measured", baseline, baselineLive);
    psqlFile(databaseUrl, join(candidateDir, "triggers.sql"));
    const bounds = scalar(
      databaseUrl,
      `SELECT coalesce(range_after, '') || '|' || range_until || '|' || item_count::text
       FROM historical_catalog_summary_chunk_bounds()`,
    )
      .split("\n")
      .filter(Boolean);
    assert.ok(bounds.length >= 400, `expected about 500 chunks, got ${bounds.length}`);
    const script = ["CREATE TABLE g12_mark (id serial PRIMARY KEY, at timestamptz NOT NULL DEFAULT clock_timestamp(), kind text NOT NULL);"];
    for (const line of bounds) {
      const [after, until] = line.split("|");
      const afterSql = after.replaceAll("'", "''");
      const untilSql = until.replaceAll("'", "''");
      script.push(`INSERT INTO g12_mark(kind) VALUES ('before');`);
      script.push(`CALL historical_catalog_summary_backfill_range('${afterSql}', '${untilSql}');`);
      script.push(`INSERT INTO g12_mark(kind) VALUES ('after');`);
    }
    const backfillPath = "/tmp/g12-summary-backfill.sql";
    writeFileSync(backfillPath, script.join("\n"));
    console.log(`bench: backfill starting, ${bounds.length} chunks`);
    const backfillStarted = Date.now();
    psqlFile(databaseUrl, backfillPath);
    const backfillWallMs = Date.now() - backfillStarted;
    const [chunkMedian, chunkP95, chunkN] = scalar(
      databaseUrl,
      `SELECT coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms), 0)::text
         || '|' || coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms), 0)::text
         || '|' || count(*)::text
       FROM (
         SELECT extract(epoch FROM finished.at - started.at) * 1000 AS ms
         FROM g12_mark started
         JOIN g12_mark finished ON finished.id = started.id + 1
         WHERE started.kind = 'before' AND finished.kind = 'after'
       ) samples`,
    ).split("|");
    assert.equal(
      scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_membership WHERE accounted`),
      String(historicalRows),
    );
    assert.equal(scalar(databaseUrl, `SELECT coalesce(sum(n),0)::text FROM historical_catalog_summary_bucket`), String(historicalRows));
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_checkpoint WHERE status = 'running'`), "0");
    const bucketCount = Number(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_bucket`));

    const controlBefore = Number(scalar(databaseUrl, `SELECT n_tup_upd::text FROM pg_stat_user_tables WHERE relname = 'historical_catalog_summary_control'`));
    const bucketBefore = Number(scalar(databaseUrl, `SELECT n_tup_upd::text FROM pg_stat_user_tables WHERE relname = 'historical_catalog_summary_bucket'`));
    const membershipBefore = Number(scalar(databaseUrl, `SELECT n_tup_upd::text FROM pg_stat_user_tables WHERE relname = 'historical_catalog_summary_membership'`));
    const deadlocksBefore = Number(scalar(databaseUrl, `SELECT deadlocks::text FROM pg_stat_database WHERE datname = current_database()`));
    const dbBefore = scalar(
      databaseUrl,
      `SELECT tup_returned::text || '|' || tup_fetched::text || '|' || tup_inserted::text || '|' || tup_updated::text || '|' || blks_hit::text || '|' || blks_read::text
       FROM pg_stat_database WHERE datname = current_database()`,
    ).split("|").map(Number);

    psql(databaseUrl, `CALL g12_bench_flip('maintained', 'v%', 200, 200)`);
    psql(databaseUrl, `CALL g12_bench_touch('noop', 'v%', 100, 'noop')`);
    psql(databaseUrl, `CALL g12_bench_touch('live', 'l%', 100, 'live')`);
    const maintained = percentile("maintained");
    const noop = percentile("noop");
    const live = percentile("live");
    assert.equal(maintained.n, 200);
    const controlDelta = Number(scalar(databaseUrl, `SELECT n_tup_upd::text FROM pg_stat_user_tables WHERE relname = 'historical_catalog_summary_control'`)) - controlBefore;
    const bucketDelta = Number(scalar(databaseUrl, `SELECT n_tup_upd::text FROM pg_stat_user_tables WHERE relname = 'historical_catalog_summary_bucket'`)) - bucketBefore;
    const membershipDelta = Number(scalar(databaseUrl, `SELECT n_tup_upd::text FROM pg_stat_user_tables WHERE relname = 'historical_catalog_summary_membership'`)) - membershipBefore;
    assert.equal(controlDelta, 0);
    assert.equal(scalar(databaseUrl, `SELECT summary_ready::text FROM historical_catalog_summary_control`), "false");
    assert.equal(scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE n < 0`), "0");

    psql(databaseUrl, `CALL g12_bench_touch('event', 'v%', 20, 'event')`);
    psql(databaseUrl, `CALL g12_bench_touch('lot', 'o%', 10, 'lot')`);
    const eventLatency = percentile("event");
    const lotLatency = percentile("lot");

    const samples: number[] = [];
    const waiting: number[] = [];
    let stop = false;
    const sampler = (async () => {
      while (!stop) {
        samples.push(Number(scalar(databaseUrl, `SELECT count(*)::text FROM pg_stat_activity WHERE datname = current_database()`)));
        waiting.push(Number(scalar(databaseUrl, `SELECT count(*)::text FROM pg_locks WHERE NOT granted`)));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })();
    const concurrentStarted = Date.now();
    const workers = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6, 7].map((slot) => psqlAsync(`CALL g12_bench_flip_slot(${slot}, 25)`)),
    );
    stop = true;
    await sampler;
    const concurrentWallMs = Date.now() - concurrentStarted;
    for (const worker of workers) assert.equal(worker.status, 0, worker.output.slice(0, 500));
    const concurrent = percentile("concurrent");
    const retries = workers.reduce((sum, worker) => sum + (worker.output.match(/summary apply retry/g)?.length ?? 0), 0);
    const deadlocks = Number(scalar(databaseUrl, `SELECT deadlocks::text FROM pg_stat_database WHERE datname = current_database()`)) - deadlocksBefore;
    const dbAfter = scalar(
      databaseUrl,
      `SELECT tup_returned::text || '|' || tup_fetched::text || '|' || tup_inserted::text || '|' || tup_updated::text || '|' || blks_hit::text || '|' || blks_read::text
       FROM pg_stat_database WHERE datname = current_database()`,
    ).split("|").map(Number);
    const clean = JSON.parse(scalar(databaseUrl, `SELECT historical_catalog_summary_reconcile_issues()::text`)) as {
      ok: boolean;
      negativeBuckets: number;
      zeroBuckets: number;
      projectionMissingMembership: number;
      membershipWithoutProjection: number;
      fieldMismatches: number;
      bucketMemberMismatches: number;
    };
    assert.equal(clean.ok, true, JSON.stringify(clean));
    assert.equal(clean.negativeBuckets, 0);
    assert.equal(clean.projectionMissingMembership, 0);
    assert.equal(clean.membershipWithoutProjection, 0);
    assert.equal(clean.fieldMismatches, 0);
    assert.equal(clean.bucketMemberMismatches, 0);

    const planRows = scalar(databaseUrl, `SELECT count(*)::text FROM historical_catalog_summary_bucket`);
    psql(
      databaseUrl,
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
       ANALYZE historical_catalog_summary_bucket;`,
    );
    const equalitySql = `
      PREPARE g12_eq(text, text, text, bigint, text, text, text, text, text) AS
      SELECT bucket_id FROM historical_catalog_summary_bucket
      WHERE lot_key = $1 AND raw_lot_key = $2 AND import_request = $3 AND label_pair_id = $4
        AND niche_key = $5 AND raw_niche_key = $6 AND item_status = $7 AND label_agreement = $8
        AND (($9 IS NULL AND origin_id IS NULL) OR origin_id = $9);
      PREPARE g12_distinct(text, text, text, bigint, text, text, text, text, text) AS
      SELECT bucket_id FROM historical_catalog_summary_bucket
      WHERE lot_key IS NOT DISTINCT FROM $1 AND raw_lot_key IS NOT DISTINCT FROM $2
        AND import_request IS NOT DISTINCT FROM $3 AND label_pair_id IS NOT DISTINCT FROM $4
        AND niche_key IS NOT DISTINCT FROM $5 AND raw_niche_key IS NOT DISTINCT FROM $6
        AND item_status IS NOT DISTINCT FROM $7 AND label_agreement IS NOT DISTINCT FROM $8
        AND origin_id IS NOT DISTINCT FROM $9;`;
    const labelId = scalar(databaseUrl, `SELECT label_pair_id::text FROM historical_catalog_summary_label WHERE label_hash = 'plan-label-hash'`);
    const explain = (mode: string, statement: string) =>
      scalar(
        databaseUrl,
        `${equalitySql}
         SET plan_cache_mode = ${mode};
         EXPLAIN EXECUTE ${statement}('plan-lot','plan-lot','plan-shared', ${labelId}::bigint, 'niche-5','niche-5','available','july_column_agrees', NULL::text);`,
      );
    const hotGrain = scalar(
      databaseUrl,
      `SELECT lot_key || '|' || raw_lot_key || '|' || import_request || '|' || label_pair_id::text
         || '|' || niche_key || '|' || raw_niche_key || '|' || item_status || '|' || label_agreement
       FROM historical_catalog_summary_bucket
       WHERE lot_key = 'vet-historical'
       ORDER BY n DESC
       LIMIT 1`,
    ).split("|");
    const hotExplain = (mode: string) =>
      scalar(
        databaseUrl,
        `PREPARE g12_hot(text, text, text, bigint, text, text, text, text) AS
         SELECT bucket_id FROM historical_catalog_summary_bucket
         WHERE lot_key = $1 AND raw_lot_key = $2 AND import_request = $3 AND label_pair_id = $4
           AND niche_key = $5 AND raw_niche_key = $6 AND item_status = $7 AND label_agreement = $8
           AND origin_id IS NULL;
         SET plan_cache_mode = ${mode};
         EXPLAIN EXECUTE g12_hot('${hotGrain[0]}','${hotGrain[1]}','${hotGrain[2]}', ${hotGrain[3]}::bigint, '${hotGrain[4]}','${hotGrain[5]}','${hotGrain[6]}','${hotGrain[7]}');`,
      );
    const hotGeneric = hotExplain("force_generic_plan");
    const hotCustom = hotExplain("force_custom_plan");
    assert.match(hotCustom, /Index Scan/);
    const genericEquality = explain("force_generic_plan", "g12_eq");
    const customEquality = explain("force_custom_plan", "g12_eq");
    const genericDistinct = explain("force_generic_plan", "g12_distinct");
    const customDistinct = explain("force_custom_plan", "g12_distinct");
    assert.match(customEquality, /Index Scan/);
    if (version.startsWith("16.")) {
      assert.match(customDistinct, /Seq Scan/);
      assert.match(genericDistinct, /Seq Scan/);
    }

    const maintainedOverBaseline = baseline.median === 0 ? null : maintained.median / baseline.median;
    const recommendedInitialChunk = Number(chunkP95) > 250 || concurrent.p95 > Math.max(baseline.p95 * 4, 50) ? 100 : 250;
    const report = {
      postgres: version,
      productionPostgres: "18.6",
      historicalRows,
      vetRows,
      otherRows,
      liveRows,
      bucketsAfterBackfill: bucketCount,
      bucketsDuringPlan: Number(planRows) + 20_000,
      baseline,
      baselineLive,
      maintained,
      noop,
      live,
      eventLatency,
      lotLatency,
      concurrent: {
        ...concurrent,
        wallMs: concurrentWallMs,
        retries,
        deadlocks,
        maxConnections: Math.max(...samples, 0),
        maxUngrantedLocks: Math.max(...waiting, 0),
      },
      backfill: {
        chunks: Number(chunkN),
        medianMs: Number(chunkMedian),
        p95Ms: Number(chunkP95),
        wallMs: backfillWallMs,
      },
      ordinaryWrites: {
        controlUpdates: controlDelta,
        bucketUpdates: bucketDelta,
        bucketUpdatesPerItem: bucketDelta / maintained.n,
        membershipUpdates: membershipDelta,
        membershipUpdatesPerItem: membershipDelta / maintained.n,
      },
      amplificationPerMeasuredWindow: {
        tupReturned: dbAfter[0] - dbBefore[0],
        tupFetched: dbAfter[1] - dbBefore[1],
        tupInserted: dbAfter[2] - dbBefore[2],
        tupUpdated: dbAfter[3] - dbBefore[3],
        blksHit: dbAfter[4] - dbBefore[4],
        blksRead: dbAfter[5] - dbBefore[5],
      },
      plans: {
        genericEquality,
        customEquality,
        genericDistinct,
        customDistinct,
        hotGeneric,
        hotCustom,
      },
      maintainedMedianOverBaseline: maintainedOverBaseline,
      recommendedInitialChunk,
      hardChunkCap: 500,
    };
    writeFileSync("/opt/cursor/artifacts/gate12-bench.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    assert.ok(maintained.median < 2_000, `maintained median ${maintained.median}`);
    assert.ok(maintained.p95 < 5_000, `maintained p95 ${maintained.p95}`);
    assert.equal(report.ordinaryWrites.controlUpdates, 0);
  });
});
