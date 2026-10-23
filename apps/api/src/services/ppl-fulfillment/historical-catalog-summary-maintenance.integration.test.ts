/**
 * Gate 12 summary maintenance proofs on a disposable local database.
 * Candidate SQL is loaded here only. prisma migrate deploy does not install it.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

const database = "sa360_test_g12_summary";
const run = Boolean(integrationUrl());

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function control(): { ready: string; epoch: number; failure: number; invalidation: string } {
  const [ready, epoch, failure, invalidation] = scalar(
    localDatabaseUrl(database),
    `SELECT summary_ready::text || '|' || summary_epoch::text || '|' || failure_count::text || '|' || coalesce(invalidation, '')
     FROM historical_catalog_summary_control`,
  ).split("|");
  return { ready, epoch: Number(epoch), failure: Number(failure), invalidation };
}

function issues(): Record<string, unknown> {
  return JSON.parse(
    scalar(localDatabaseUrl(database), `SELECT historical_catalog_summary_reconcile_issues()::text`),
  ) as Record<string, unknown>;
}

function stat(table: string, column: string): number {
  return Number(
    scalar(
      localDatabaseUrl(database),
      `SELECT ${column}::text FROM pg_stat_user_tables WHERE relname = '${table}'`,
    ),
  );
}

function insertHistorical(options: {
  item: string;
  event: string;
  lot?: string;
  campaign?: string | null;
  niche?: string;
  origin?: string | null;
  status?: string;
  provider?: string;
  system?: string;
  itemProvider?: string;
  importRequest?: string;
}): void {
  const db = localDatabaseUrl(database);
  const campaign = options.campaign === undefined ? "July One" : options.campaign;
  const niche = options.niche ?? "vet";
  const status = options.status ?? "available";
  const provider = options.provider ?? "manual_import";
  const system = options.system ?? "csv_import";
  const itemProvider = options.itemProvider ?? "manual_import";
  const lot = options.lot ?? "lot-a";
  const importRequest = options.importRequest ?? "imp-1";
  const originSql = options.origin ? `'${options.origin}'` : "NULL";
  const campaignSql = campaign === null ? "NULL" : `'${campaign.replaceAll("'", "''")}'`;
  const availableSql = status === "available" ? "now()" : "NULL";
  const normalized =
    campaign === null
      ? "NULL"
      : `'{"campaign_name":${JSON.stringify(campaign)}}'::jsonb`;
  psql(
    db,
    `INSERT INTO "SourceLeadEvent" (
       id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
       "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
     ) VALUES (
       '${options.event}', '${provider}'::"SourceLeadProvider", '${system}'::"SourceLeadSystem",
       'bulk_import'::"SourceLeadType", 'approved'::"SourceLeadEventStatus", ${campaignSql},
       jsonb_build_object('importRequestId', '${importRequest}'),
       ${normalized}, now(), now(), now()
     )`,
  );
  psql(
    db,
    `INSERT INTO "LeadInventoryItem" (
       id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
       "originClientAccountId", "sourceProvider", "sourceLane", "inventoryClass", status,
       "availableAt", "createdAt", "updatedAt"
     ) VALUES (
       '${options.item}', '${lot}', '${options.event}', now(), 'GA', '${niche}',
       ${originSql}, '${itemProvider}'::"SourceLeadProvider", 'g12', 'aged'::"LeadInventoryClass",
       '${status}'::"LeadInventoryItemStatus", ${availableSql}, now(), now()
     )`,
  );
}

describe("historical catalog summary maintenance gate 12", { skip: !run, timeout: 180_000 }, () => {
  before(() => {
    const databaseUrl = recreate(database);
    migrate(databaseUrl);
    loadCandidate(databaseUrl, true);
    psql(
      databaseUrl,
      `INSERT INTO "ClientAccount" ("clientAccountId", "clientDisplayName", "createdAt", "updatedAt")
       VALUES ('origin-a', 'Origin A', now(), now()), ('origin-b', 'Origin B', now(), now());
       INSERT INTO "InventoryLot" (
         id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey", "inventoryClass", status, "createdAt", "updatedAt"
       ) VALUES
         ('lot-a', 'vet-a', 'Vet A', 'manual_import', 'g12', 'vet', 'aged', 'active', now(), now()),
         ('lot-b', 'vet-b', 'Vet B', 'manual_import', 'g12', 'vet', 'aged', 'active', now(), now()),
         ('lot-c', 'vet-c', 'Vet C', 'manual_import', 'g12', 'vet', 'aged', 'active', now(), now());
       CREATE TABLE g12_trace (id bigserial PRIMARY KEY, step text NOT NULL, item_id text NOT NULL);
       CREATE FUNCTION g12_proj_trace() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         INSERT INTO g12_trace(step, item_id) VALUES ('projection:' || TG_OP, COALESCE(NEW.item_id, OLD.item_id));
         RETURN NULL;
       END; $fn$;
       CREATE TRIGGER g12_proj_trace AFTER INSERT OR DELETE ON historical_catalog_projection
       FOR EACH ROW EXECUTE FUNCTION g12_proj_trace();
       CREATE FUNCTION g12_mem_trace() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         INSERT INTO g12_trace(step, item_id) VALUES ('membership:' || TG_OP, COALESCE(NEW.item_id, OLD.item_id));
         RETURN NULL;
       END; $fn$;
       CREATE TRIGGER g12_mem_trace AFTER INSERT OR UPDATE ON historical_catalog_summary_membership
       FOR EACH ROW EXECUTE FUNCTION g12_mem_trace();
       CREATE SEQUENCE g12_vanish_seq;
       CREATE FUNCTION g12_bucket_bomb() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         IF coalesce(current_setting('g12.fail_bucket', true), '') = 'on' THEN
           RAISE EXCEPTION 'injected bucket failure';
         END IF;
         IF coalesce(current_setting('g12.slow_bucket', true), '') = 'on' THEN
           PERFORM pg_sleep(2);
         END IF;
         IF coalesce(current_setting('g12.always_vanish', true), '') = 'on' THEN
           RAISE EXCEPTION 'summary bucket vanished' USING ERRCODE = 'SB001';
         END IF;
         IF coalesce(current_setting('g12.vanish_seq', true), '') = 'on' AND nextval('g12_vanish_seq') <= 2 THEN
           RAISE EXCEPTION 'summary bucket vanished' USING ERRCODE = 'SB001';
         END IF;
         RETURN NEW;
       END; $fn$;
       CREATE TRIGGER g12_bucket_bomb BEFORE UPDATE ON historical_catalog_summary_bucket
       FOR EACH ROW EXECUTE FUNCTION g12_bucket_bomb();
       CREATE FUNCTION g12_unready_bomb() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         IF coalesce(current_setting('g12.fail_unready', true), '') = 'on' THEN
           RAISE EXCEPTION 'injected unready failure';
         END IF;
         RETURN NEW;
       END; $fn$;
       CREATE TRIGGER g12_unready_bomb BEFORE UPDATE ON historical_catalog_summary_control
       FOR EACH ROW EXECUTE FUNCTION g12_unready_bomb();
       CREATE FUNCTION g12_cancel_probe() RETURNS text LANGUAGE plpgsql AS $fn$
       BEGIN
         PERFORM pg_sleep(5);
         RETURN 'finished';
       EXCEPTION WHEN OTHERS THEN
         RETURN 'caught:' || SQLSTATE;
       END; $fn$;`,
    );
  });

  after(() => {
    if (run) dropDatabase(database);
  });

  it("runs summary triggers after projection triggers and not on the projection table", () => {
    const db = localDatabaseUrl(database);
    const version = scalar(db, `SELECT current_setting('server_version')`);
    assert.match(version, /^\d+\./);
    for (const table of ["LeadInventoryItem", "SourceLeadEvent", "InventoryLot"]) {
      const names = scalar(
        db,
        `SELECT string_agg(tgname, ',' ORDER BY tgname)
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         WHERE c.relname = '${table}' AND NOT t.tgisinternal AND tgname LIKE 'historical_catalog%'`,
      );
      const projection = names.split(",").find((name) => name.includes("projection"));
      const summary = names.split(",").find((name) => name.includes("summary"));
      assert.ok(projection && summary, names);
      assert.ok(names.indexOf(projection) < names.indexOf(summary), names);
    }
    assert.equal(
      scalar(
        db,
        `SELECT count(*)::text FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         WHERE c.relname = 'historical_catalog_projection'
           AND NOT t.tgisinternal
           AND tgname LIKE 'historical_catalog_summary%'`,
      ),
      "0",
    );
    assert.equal(scalar(db, `SELECT historical_catalog_summary_chunk_cap()::text`), "500");
    assert.equal(scalar(db, `SELECT historical_catalog_summary_readable()::text`), "false");
  });

  it("accounts a new historical item without writing the control row", () => {
    const before = control();
    const controlUpdates = stat("historical_catalog_summary_control", "n_tup_upd");
    insertHistorical({ item: "new-item", event: "new-evt" });
    const db = localDatabaseUrl(database);
    assert.equal(scalar(db, `SELECT item_status || '|' || july_label || '|' || n::text FROM historical_catalog_summary_bucket b JOIN historical_catalog_summary_membership m ON m.bucket_id = b.bucket_id WHERE m.item_id = 'new-item'`), "available|July One|1");
    assert.equal(scalar(db, `SELECT accounted::text FROM historical_catalog_summary_membership WHERE item_id = 'new-item'`), "true");
    assert.deepEqual(control(), before);
    assert.equal(stat("historical_catalog_summary_control", "n_tup_upd"), controlUpdates);
    const trace = scalar(db, `SELECT string_agg(step, ',' ORDER BY id) FROM g12_trace WHERE item_id = 'new-item'`);
    assert.match(trace, /^projection:INSERT,membership:INSERT/);
    const projectionAt = Number(scalar(db, `SELECT min(id)::text FROM g12_trace WHERE item_id = 'new-item' AND step LIKE 'projection:%'`));
    const membershipAt = Number(scalar(db, `SELECT min(id)::text FROM g12_trace WHERE item_id = 'new-item' AND step LIKE 'membership:%'`));
    assert.ok(projectionAt < membershipAt);
  });

  it("sees the post-refresh projection on status, origin, niche, lot, label, and import changes", () => {
    const db = localDatabaseUrl(database);
    psql(db, `DELETE FROM g12_trace`);
    const controlUpdates = stat("historical_catalog_summary_control", "n_tup_upd");
    const bucketUpdates = stat("historical_catalog_summary_bucket", "n_tup_upd");
    psql(db, `UPDATE "LeadInventoryItem" SET status = 'available', "updatedAt" = now() WHERE id = 'new-item'`);
    assert.equal(stat("historical_catalog_summary_bucket", "n_tup_upd"), bucketUpdates);
    assert.equal(stat("historical_catalog_summary_control", "n_tup_upd"), controlUpdates);
    psql(db, `UPDATE "LeadInventoryItem" SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now() WHERE id = 'new-item'`);
    assert.equal(scalar(db, `SELECT b.item_status FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'new-item'`), "reserved");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE n = 0`), "0");
    const trace = scalar(db, `SELECT string_agg(step, '>' ORDER BY id) FROM g12_trace WHERE item_id = 'new-item'`);
    assert.match(trace, /projection:DELETE>projection:INSERT>membership:/);
    psql(db, `UPDATE "LeadInventoryItem" SET "originClientAccountId" = 'origin-a', "updatedAt" = now() WHERE id = 'new-item'`);
    assert.equal(scalar(db, `SELECT b.origin_id FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'new-item'`), "origin-a");
    psql(db, `UPDATE "LeadInventoryItem" SET "nicheKey" = 'medicare', "updatedAt" = now() WHERE id = 'new-item'`);
    assert.equal(
      scalar(db, `SELECT b.niche_key || '|' || b.raw_niche_key FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'new-item'`),
      "medicare|medicare",
    );
    psql(db, `UPDATE "LeadInventoryItem" SET "inventoryLotId" = 'lot-b', "updatedAt" = now() WHERE id = 'new-item'`);
    assert.equal(
      scalar(db, `SELECT b.lot_key || '|' || b.raw_lot_key FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'new-item'`),
      "vet-b|vet-b",
    );
    const itemUpdates = stat("LeadInventoryItem", "n_tup_upd");
    psql(db, `UPDATE "SourceLeadEvent" SET "sourceCampaignName" = 'July Two', "normalizedPayloadJson" = '{"campaign_name":"July Two"}'::jsonb, "updatedAt" = now() WHERE id = 'new-evt'`);
    assert.equal(stat("LeadInventoryItem", "n_tup_upd"), itemUpdates);
    assert.equal(scalar(db, `SELECT b.july_label FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'new-item'`), "July Two");
    assert.equal(scalar(db, `SELECT july_label FROM historical_catalog_projection WHERE item_id = 'new-item'`), "July Two");
    psql(db, `UPDATE "SourceLeadEvent" SET "rawPayloadJson" = '{"importRequestId":"imp-2"}'::jsonb, "updatedAt" = now() WHERE id = 'new-evt'`);
    assert.equal(scalar(db, `SELECT import_request FROM historical_catalog_projection WHERE item_id = 'new-item'`), "imp-2");
    assert.equal(
      scalar(db, `SELECT b.import_request FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'new-item'`),
      "imp-2",
    );
    assert.equal(control().epoch, 0);
  });

  it("shares null origins, separates blank niche text, and ignores live intake", () => {
    insertHistorical({ item: "null-1", event: "null-evt-1", campaign: "Null Label", origin: null, niche: "vet", lot: "lot-a", status: "pending_review" });
    insertHistorical({ item: "null-2", event: "null-evt-2", campaign: "Null Label", origin: null, niche: "vet", lot: "lot-a", status: "pending_review" });
    const db = localDatabaseUrl(database);
    assert.equal(scalar(db, `SELECT n::text FROM historical_catalog_summary_bucket b JOIN historical_catalog_summary_membership m ON m.bucket_id = b.bucket_id WHERE m.item_id = 'null-1'`), "2");
    psql(db, `UPDATE "LeadInventoryItem" SET "originClientAccountId" = 'origin-b', "updatedAt" = now() WHERE id = 'null-2'`);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket b JOIN historical_catalog_summary_membership m ON m.bucket_id = b.bucket_id WHERE m.item_id IN ('null-1','null-2') AND b.origin_id IS NULL`), "1");
    assert.equal(scalar(db, `SELECT b.origin_id FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'null-2'`), "origin-b");
    insertHistorical({ item: "blank-niche", event: "blank-niche-evt", campaign: "Blank Niche", niche: "" });
    assert.equal(
      scalar(db, `SELECT b.niche_key || '|' || b.raw_niche_key FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'blank-niche'`),
      "(blank)|",
    );
    const buckets = stat("historical_catalog_summary_bucket", "n_tup_upd");
    const controls = stat("historical_catalog_summary_control", "n_tup_upd");
    insertHistorical({
      item: "live-1",
      event: "live-evt-1",
      provider: "leadcapture_io",
      system: "leadcapture_io_nextgen",
      itemProvider: "leadcapture_io",
      campaign: null,
      status: "pending_review",
    });
    psql(db, `UPDATE "LeadInventoryItem" SET "nicheKey" = 'dental', "updatedAt" = now() WHERE id = 'live-1'`);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_projection WHERE item_id = 'live-1'`), "0");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_membership WHERE item_id = 'live-1'`), "0");
    assert.equal(stat("historical_catalog_summary_bucket", "n_tup_upd"), buckets);
    assert.equal(stat("historical_catalog_summary_control", "n_tup_upd"), controls);
  });

  it("removes membership on delete and on leaving the historical projection", () => {
    insertHistorical({ item: "leave-1", event: "leave-evt", campaign: "Leaving", lot: "lot-c" });
    const db = localDatabaseUrl(database);
    assert.equal(scalar(db, `SELECT n::text FROM historical_catalog_summary_bucket WHERE july_label = 'Leaving'`), "1");
    psql(db, `UPDATE "SourceLeadEvent" SET "sourceProvider" = 'leadcapture_io', "sourceSystem" = 'leadcapture_io_nextgen', "updatedAt" = now() WHERE id = 'leave-evt'`);
    psql(db, `UPDATE "LeadInventoryItem" SET "sourceProvider" = 'leadcapture_io', "updatedAt" = now() WHERE id = 'leave-1'`);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_projection WHERE item_id = 'leave-1'`), "0");
    assert.equal(scalar(db, `SELECT accounted::text FROM historical_catalog_summary_membership WHERE item_id = 'leave-1'`), "false");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE july_label = 'Leaving'`), "0");
    insertHistorical({ item: "del-1", event: "del-evt", campaign: "Delete Me", lot: "lot-c" });
    psql(db, `DELETE FROM "LeadInventoryItem" WHERE id = 'del-1'`);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_projection WHERE item_id = 'del-1'`), "0");
    assert.equal(scalar(db, `SELECT coalesce(accounted::text, 'absent') FROM historical_catalog_summary_membership WHERE item_id = 'del-1'`), "false");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE july_label = 'Delete Me'`), "0");
  });

  it("applies a multi-row statement after each row's projection refresh", () => {
    insertHistorical({ item: "row-1", event: "row-evt-1", campaign: "Rows", status: "pending_review" });
    insertHistorical({ item: "row-2", event: "row-evt-2", campaign: "Rows", status: "pending_review" });
    insertHistorical({ item: "row-3", event: "row-evt-3", campaign: "Rows", status: "pending_review" });
    const db = localDatabaseUrl(database);
    psql(db, `DELETE FROM g12_trace`);
    psql(db, `UPDATE "LeadInventoryItem" SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now() WHERE id IN ('row-1','row-2','row-3')`);
    for (const item of ["row-1", "row-2", "row-3"]) {
      const projectionAt = Number(scalar(db, `SELECT max(id)::text FROM g12_trace WHERE item_id = '${item}' AND step LIKE 'projection:%'`));
      const membershipAt = Number(scalar(db, `SELECT max(id)::text FROM g12_trace WHERE item_id = '${item}' AND step LIKE 'membership:%'`));
      assert.ok(projectionAt < membershipAt, item);
      assert.equal(scalar(db, `SELECT p.item_status = b.item_status FROM historical_catalog_projection p JOIN historical_catalog_summary_membership m ON m.item_id = p.item_id JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE p.item_id = '${item}'`), "t");
    }
    assert.equal(scalar(db, `SELECT n::text FROM historical_catalog_summary_bucket WHERE july_label = 'Rows' AND item_status = 'reserved'`), "3");
  });

  it("invalidates a lot rename once and does not rebucket the lot", () => {
    const db = localDatabaseUrl(database);
    psql(
      db,
      `INSERT INTO "SourceLeadEvent" (
         id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName",
         "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt"
       )
       SELECT 'ren-evt-' || g, 'manual_import'::"SourceLeadProvider", 'csv_import'::"SourceLeadSystem",
              'bulk_import'::"SourceLeadType", 'approved'::"SourceLeadEventStatus", 'Rename Lot',
              '{"importRequestId":"imp-ren"}'::jsonb, '{"campaign_name":"Rename Lot"}'::jsonb, now(), now(), now()
       FROM generate_series(1, 30) g;
       INSERT INTO "LeadInventoryItem" (
         id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey",
         "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt"
       )
       SELECT 'ren-item-' || g, 'lot-c', 'ren-evt-' || g, now(), 'GA', 'vet',
              'manual_import'::"SourceLeadProvider", 'g12', 'aged'::"LeadInventoryClass",
              'available'::"LeadInventoryItemStatus", now(), now(), now()
       FROM generate_series(1, 30) g`,
    );
    const before = control();
    const bucketUpdates = stat("historical_catalog_summary_bucket", "n_tup_upd");
    const projectionUpdates = stat("historical_catalog_projection", "n_tup_upd");
    psql(db, `UPDATE "InventoryLot" SET "lotKey" = 'vet-c-renamed', "updatedAt" = now() WHERE id = 'lot-c'`);
    const after = control();
    assert.equal(after.ready, "false");
    assert.equal(after.epoch, before.epoch + 1);
    assert.equal(after.failure, before.failure);
    assert.equal(after.invalidation, "lot_key_rename");
    assert.equal(stat("historical_catalog_summary_bucket", "n_tup_upd"), bucketUpdates);
    assert.equal(stat("historical_catalog_projection", "n_tup_upd") - projectionUpdates, 30);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE lot_key = 'vet-c-renamed'`), "0");
    assert.equal(scalar(db, `SELECT count(DISTINCT lot_key)::text FROM historical_catalog_projection WHERE item_id LIKE 'ren-item-%'`), "1");
    assert.equal(scalar(db, `SELECT min(lot_key) FROM historical_catalog_projection WHERE item_id LIKE 'ren-item-%'`), "vet-c-renamed");
    const found = issues();
    assert.equal(found.ok, false);
    assert.ok(Number(found.fieldMismatches) >= 30);
    assert.ok(Number(found.rawLotMismatches) >= 30);
    assert.equal(found.epochMismatch, true);
    psql(db, `SELECT historical_catalog_summary_apply_items_work(ARRAY(SELECT 'ren-item-' || g FROM generate_series(1, 30) g))`);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE lot_key = 'vet-c' AND july_label = 'Rename Lot'`), "0");
    assert.equal(scalar(db, `SELECT n::text FROM historical_catalog_summary_bucket WHERE lot_key = 'vet-c-renamed' AND july_label = 'Rename Lot'`), "30");
  });

  it("keeps concurrent same-bucket, same-item, and new-bucket writes consistent", async () => {
    insertHistorical({ item: "hot-1", event: "hot-evt-1", campaign: "Hot", status: "pending_review", lot: "lot-a" });
    insertHistorical({ item: "hot-2", event: "hot-evt-2", campaign: "Hot", status: "pending_review", lot: "lot-a" });
    const sameBucket = await Promise.all([
      psqlAsync(`UPDATE "LeadInventoryItem" SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now() WHERE id = 'hot-1'`),
      psqlAsync(`UPDATE "LeadInventoryItem" SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now() WHERE id = 'hot-2'`),
    ]);
    for (const result of sameBucket) assert.equal(result.status, 0, result.output);
    const db = localDatabaseUrl(database);
    assert.equal(scalar(db, `SELECT n::text FROM historical_catalog_summary_bucket WHERE july_label = 'Hot' AND item_status = 'reserved'`), "2");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE n < 0`), "0");
    const sameItem = await Promise.all([
      psqlAsync(`UPDATE "LeadInventoryItem" SET status = 'available', "availableAt" = now(), "updatedAt" = now() WHERE id = 'hot-1'`),
      psqlAsync(`UPDATE "LeadInventoryItem" SET "nicheKey" = 'dental', "updatedAt" = now() WHERE id = 'hot-1'`),
    ]);
    for (const result of sameItem) assert.equal(result.status, 0, result.output);
    assert.equal(
      scalar(db, `SELECT (p.item_status = b.item_status AND p.niche_key = b.niche_key)::text
        FROM historical_catalog_projection p
        JOIN historical_catalog_summary_membership m ON m.item_id = p.item_id
        JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id
        WHERE p.item_id = 'hot-1'`),
      "true",
    );
    const created = await Promise.all([
      psqlAsync(`
        INSERT INTO "SourceLeadEvent" (id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName", "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt")
        VALUES ('newb-evt-1', 'manual_import', 'csv_import', 'bulk_import', 'approved', 'Brand New', '{"importRequestId":"imp-new"}'::jsonb, '{"campaign_name":"Brand New"}'::jsonb, now(), now(), now());
        INSERT INTO "LeadInventoryItem" (id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey", "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt")
        VALUES ('newb-1', 'lot-a', 'newb-evt-1', now(), 'GA', 'vet', 'manual_import', 'g12', 'aged', 'available', now(), now(), now());
      `),
      psqlAsync(`
        INSERT INTO "SourceLeadEvent" (id, "sourceProvider", "sourceSystem", "sourceType", status, "sourceCampaignName", "rawPayloadJson", "normalizedPayloadJson", "receivedAt", "createdAt", "updatedAt")
        VALUES ('newb-evt-2', 'manual_import', 'csv_import', 'bulk_import', 'approved', 'Brand New', '{"importRequestId":"imp-new"}'::jsonb, '{"campaign_name":"Brand New"}'::jsonb, now(), now(), now());
        INSERT INTO "LeadInventoryItem" (id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState", "nicheKey", "sourceProvider", "sourceLane", "inventoryClass", status, "availableAt", "createdAt", "updatedAt")
        VALUES ('newb-2', 'lot-a', 'newb-evt-2', now(), 'GA', 'vet', 'manual_import', 'g12', 'aged', 'available', now(), now(), now());
      `),
    ]);
    for (const result of created) assert.equal(result.status, 0, result.output);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE july_label = 'Brand New'`), "1");
    assert.equal(scalar(db, `SELECT n::text FROM historical_catalog_summary_bucket WHERE july_label = 'Brand New'`), "2");
  });

  it("retries a bounded vanished-bucket failure without double counting", () => {
    insertHistorical({ item: "van-1", event: "van-evt", campaign: "Vanish", status: "pending_review" });
    const db = localDatabaseUrl(database);
    const before = control();
    const output = psql(db, `SET g12.vanish_seq = 'on'; UPDATE "LeadInventoryItem" SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now() WHERE id = 'van-1'`);
    assert.match(output, /summary apply retry 1 after bucket_vanished/);
    assert.match(output, /summary apply retry 2 after bucket_vanished/);
    assert.equal(scalar(db, `SELECT n::text FROM historical_catalog_summary_bucket WHERE july_label = 'Vanish' AND item_status = 'reserved'`), "1");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE july_label = 'Vanish' AND item_status = 'pending_review'`), "0");
    assert.equal(control().failure, before.failure);
    const forced = psql(db, `SET g12.always_vanish = 'on'; UPDATE "LeadInventoryItem" SET "nicheKey" = 'dental', "updatedAt" = now() WHERE id = 'van-1'`);
    assert.match(forced, /summary apply retry 1 after bucket_vanished/);
    assert.match(forced, /summary apply retry 2 after bucket_vanished/);
    assert.equal(scalar(db, `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'van-1'`), "dental");
    assert.equal(scalar(db, `SELECT niche_key FROM historical_catalog_projection WHERE item_id = 'van-1'`), "dental");
    assert.equal(
      scalar(db, `SELECT b.raw_niche_key FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'van-1'`),
      "vet",
    );
    assert.equal(control().invalidation, "bucket_vanished");
    assert.equal(scalar(db, `SELECT n::text FROM historical_catalog_summary_bucket WHERE july_label = 'Vanish' AND item_status = 'reserved'`), "1");
    psql(db, `SELECT historical_catalog_summary_apply_item('van-1')`);
    assert.equal(
      scalar(db, `SELECT b.raw_niche_key FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'van-1'`),
      "dental",
    );
  });

  it("does not let a backfill chunk overwrite or double-count a live update", async () => {
    insertHistorical({ item: "ov-item", event: "ov-evt", campaign: "Overlap", status: "pending_review" });
    const holder = psqlAsync(`
      BEGIN;
      SELECT pg_advisory_xact_lock(8142003, hashtext('ov-item'));
      SELECT pg_sleep(1);
      SELECT historical_catalog_summary_apply_items_work(ARRAY['ov-item']);
      COMMIT;
    `);
    await sleep(200);
    const updated = await psqlAsync(`UPDATE "LeadInventoryItem" SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now() WHERE id = 'ov-item'`);
    const held = await holder;
    assert.equal(held.status, 0, held.output);
    assert.equal(updated.status, 0, updated.output);
    const db = localDatabaseUrl(database);
    psql(db, `CALL historical_catalog_summary_backfill_range('', 'ov-item')`);
    const beforeN = scalar(db, `SELECT coalesce(sum(n),0)::text FROM historical_catalog_summary_bucket WHERE july_label = 'Overlap'`);
    psql(db, `CALL historical_catalog_summary_backfill_range('', 'ov-item')`);
    assert.equal(scalar(db, `SELECT coalesce(sum(n),0)::text FROM historical_catalog_summary_bucket WHERE july_label = 'Overlap'`), beforeN);
    assert.equal(scalar(db, `SELECT b.item_status FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'ov-item'`), "reserved");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_membership WHERE item_id = 'ov-item' AND accounted`), "1");
  });

  it("rolls the summary delta back and the authoritative write with it when invalidation cannot commit", () => {
    insertHistorical({ item: "fail-1", event: "fail-evt", campaign: "Failure", status: "pending_review" });
    const db = localDatabaseUrl(database);
    const beforeBomb = control();
    psql(db, `SET g12.fail_bucket = 'on'; UPDATE "LeadInventoryItem" SET status = 'reserved', "reservedAt" = now(), "updatedAt" = now() WHERE id = 'fail-1'`);
    assert.equal(scalar(db, `SELECT status::text FROM "LeadInventoryItem" WHERE id = 'fail-1'`), "reserved");
    assert.equal(scalar(db, `SELECT item_status FROM historical_catalog_projection WHERE item_id = 'fail-1'`), "reserved");
    assert.equal(scalar(db, `SELECT b.item_status FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'fail-1'`), "pending_review");
    assert.equal(scalar(db, `SELECT n::text FROM historical_catalog_summary_bucket WHERE july_label = 'Failure' AND item_status = 'pending_review'`), "1");
    const afterBomb = control();
    assert.equal(afterBomb.ready, "false");
    assert.equal(afterBomb.epoch, beforeBomb.epoch + 1);
    assert.equal(afterBomb.failure, beforeBomb.failure + 1);
    assert.equal(afterBomb.invalidation, "sqlstate_P0001");
    psql(db, `SELECT historical_catalog_summary_apply_item('fail-1')`);
    psql(db, `UPDATE historical_catalog_summary_control SET summary_ready = true, reconciled_epoch = summary_epoch, reconciled_at = clock_timestamp() WHERE singleton`);
    const armed = control();
    assert.equal(armed.ready, "true");
    const both = psqlCapture(db, `SET g12.fail_bucket = 'on'; SET g12.fail_unready = 'on'; UPDATE "LeadInventoryItem" SET "nicheKey" = 'dental', "updatedAt" = now() WHERE id = 'fail-1'`);
    assert.notEqual(both.status, 0);
    assert.match(both.stderr, /injected unready failure/);
    assert.equal(scalar(db, `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'fail-1'`), "vet");
    assert.equal(scalar(db, `SELECT niche_key FROM historical_catalog_projection WHERE item_id = 'fail-1'`), "vet");
    assert.equal(control().ready, "true");
    assert.equal(control().epoch, armed.epoch);
  });

  it("propagates statement timeout and does not mark the summary unready", () => {
    const db = localDatabaseUrl(database);
    const probe = psqlCapture(db, `SET statement_timeout = '200ms'; SELECT g12_cancel_probe()`);
    assert.notEqual(probe.status, 0);
    assert.match(probe.stderr, /canceling statement due to statement timeout/);
    assert.equal(probe.stdout.includes("caught:"), false);
    const before = control();
    const niche = scalar(db, `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'fail-1'`);
    const slow = psqlCapture(db, `SET statement_timeout = '300ms'; SET g12.slow_bucket = 'on'; UPDATE "LeadInventoryItem" SET "nicheKey" = 'vision', "updatedAt" = now() WHERE id = 'fail-1'`);
    assert.notEqual(slow.status, 0);
    assert.match(slow.stderr, /canceling statement due to statement timeout/);
    assert.equal(scalar(db, `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'fail-1'`), niche);
    assert.equal(scalar(db, `SELECT niche_key FROM historical_catalog_projection WHERE item_id = 'fail-1'`), niche);
    assert.deepEqual(control(), before);
  });

  it("rolls back when the control row is missing or lock-timeout, and invalidates when only a bucket lock times out", async () => {
    const db = localDatabaseUrl(database);
    const beforeMissing = scalar(db, `SELECT status::text || '|' || "nicheKey" FROM "LeadInventoryItem" WHERE id = 'fail-1'`);
    const missing = psqlCapture(db, `
      BEGIN;
      DELETE FROM historical_catalog_summary_control;
      UPDATE "LeadInventoryItem" SET "nicheKey" = 'missing-control', "updatedAt" = now() WHERE id = 'fail-1';
      COMMIT;
    `);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /SB008|summary control row missing/);
    assert.equal(scalar(db, `SELECT status::text || '|' || "nicheKey" FROM "LeadInventoryItem" WHERE id = 'fail-1'`), beforeMissing);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_control`), "1");
    const rolled = psqlCapture(db, `
      BEGIN;
      UPDATE "LeadInventoryItem" SET "nicheKey" = 'rolled', "updatedAt" = now() WHERE id = 'fail-1';
      ROLLBACK;
    `);
    assert.equal(rolled.status, 0, rolled.stderr);
    assert.equal(scalar(db, `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'fail-1'`), "vet");

    const holder = psqlAsync(`BEGIN; SELECT summary_epoch FROM historical_catalog_summary_control FOR UPDATE; SELECT pg_sleep(3); COMMIT;`);
    await sleep(300);
    const beforeLock = control();
    const locked = await psqlAsync(`SET lock_timeout = '400ms'; SET g12.fail_bucket = 'on'; UPDATE "LeadInventoryItem" SET "nicheKey" = 'locked-control', "updatedAt" = now() WHERE id = 'fail-1'`);
    await holder;
    assert.notEqual(locked.status, 0);
    assert.match(locked.output, /lock timeout/);
    assert.match(locked.output, /historical_catalog_summary_control/);
    assert.equal(scalar(db, `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'fail-1'`), "vet");
    assert.equal(control().epoch, beforeLock.epoch);
    assert.equal(control().ready, beforeLock.ready);

    const bucketId = scalar(db, `SELECT bucket_id::text FROM historical_catalog_summary_membership WHERE item_id = 'fail-1'`);
    const bucketHolder = psqlAsync(`BEGIN; SELECT n FROM historical_catalog_summary_bucket WHERE bucket_id = ${bucketId} FOR UPDATE; SELECT pg_sleep(3); COMMIT;`);
    await sleep(300);
    const bucketWait = await psqlAsync(`SET lock_timeout = '400ms'; UPDATE "LeadInventoryItem" SET "nicheKey" = 'bucket-wait', "updatedAt" = now() WHERE id = 'fail-1'`);
    await bucketHolder;
    assert.equal(bucketWait.status, 0, bucketWait.output);
    assert.equal(scalar(db, `SELECT "nicheKey" FROM "LeadInventoryItem" WHERE id = 'fail-1'`), "bucket-wait");
    assert.equal(scalar(db, `SELECT niche_key FROM historical_catalog_projection WHERE item_id = 'fail-1'`), "bucket-wait");
    assert.equal(scalar(db, `SELECT b.raw_niche_key FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'fail-1'`), "vet");
    assert.equal(control().invalidation, "lock_not_available");
    assert.equal(control().ready, "false");
    psql(db, `SELECT historical_catalog_summary_apply_item('fail-1')`);
    assert.equal(scalar(db, `SELECT b.raw_niche_key FROM historical_catalog_summary_membership m JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id WHERE m.item_id = 'fail-1'`), "bucket-wait");
  });

  it("deadlocks in bounded retries and does not leave negative or double counts", async () => {
    insertHistorical({ item: "dl-low", event: "dl-low-evt", campaign: "Deadlock", lot: "lot-a", status: "pending_review" });
    insertHistorical({ item: "dl-high", event: "dl-high-evt", campaign: "Deadlock", lot: "lot-b", status: "pending_review" });
    const db = localDatabaseUrl(database);
    const lowBucket = scalar(db, `SELECT bucket_id::text FROM historical_catalog_summary_membership WHERE item_id = 'dl-low'`);
    const highBucket = scalar(db, `SELECT bucket_id::text FROM historical_catalog_summary_membership WHERE item_id = 'dl-high'`);
    assert.ok(Number(lowBucket) < Number(highBucket));
    const first = psqlAsync(`
      BEGIN;
      SELECT n FROM historical_catalog_summary_bucket WHERE bucket_id = ${highBucket} FOR UPDATE;
      SELECT pg_sleep(0.8);
      UPDATE "LeadInventoryItem" SET "inventoryLotId" = 'lot-a', "updatedAt" = now() WHERE id = 'dl-high';
      COMMIT;
    `);
    await sleep(250);
    const second = psqlAsync(`
      BEGIN;
      SELECT n FROM historical_catalog_summary_bucket WHERE bucket_id = ${lowBucket} FOR UPDATE;
      UPDATE "LeadInventoryItem" SET "inventoryLotId" = 'lot-b', "updatedAt" = now() WHERE id = 'dl-low';
      COMMIT;
    `);
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.status, 0, left.output);
    assert.equal(right.status, 0, right.output);
    assert.match(left.output + right.output, /summary apply retry 1 after deadlock_detected/);
    assert.equal(control().invalidation, "deadlock_detected");
    assert.equal(control().ready, "false");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE n < 0`), "0");
    assert.equal(
      scalar(db, `SELECT (
          coalesce((SELECT sum(n) FROM historical_catalog_summary_bucket WHERE july_label = 'Deadlock'), 0)
          = (SELECT count(*) FROM historical_catalog_summary_membership WHERE item_id IN ('dl-low','dl-high') AND accounted)
        )::text`),
      "true",
    );
    psql(db, `SELECT historical_catalog_summary_apply_item('dl-low'); SELECT historical_catalog_summary_apply_item('dl-high')`);
    assert.equal(issues().fieldMismatches, 0);
  });

  it("rejects an overlong grain, keeps a label-hash collision on the text match, and reports reconcile defects", () => {
    const db = localDatabaseUrl(database);
    const tokenHash = scalar(db, `SELECT md5(historical_catalog_summary_label_token('Real July', 'Real July'))`);
    psql(db, `INSERT INTO historical_catalog_summary_label (july_label, normalized_label, label_hash) VALUES ('Fake July', 'Fake July', '${tokenHash}')`);
    insertHistorical({ item: "real-1", event: "real-evt", campaign: "Real July" });
    assert.equal(
      scalar(db, `SELECT l.july_label FROM historical_catalog_summary_membership m
        JOIN historical_catalog_summary_bucket b ON b.bucket_id = m.bucket_id
        JOIN historical_catalog_summary_label l ON l.label_pair_id = b.label_pair_id
        WHERE m.item_id = 'real-1'`),
      "Real July",
    );
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_label WHERE label_hash = '${tokenHash}'`), "2");

    const longKey = "K".repeat(2500);
    psql(
      db,
      `INSERT INTO "InventoryLot" (id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey", "inventoryClass", status, "createdAt", "updatedAt")
       VALUES ('lot-long', '${longKey}', 'Long', 'manual_import', 'g12', 'vet', 'aged', 'active', now(), now())`,
    );
    const before = control();
    insertHistorical({ item: "long-1", event: "long-evt", lot: "lot-long", campaign: "Too Long" });
    const after = control();
    assert.equal(after.ready, "false");
    assert.equal(after.invalidation, "grain_too_long");
    assert.equal(after.failure, before.failure + 1);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_projection WHERE item_id = 'long-1'`), "1");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_membership WHERE item_id = 'long-1'`), "0");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_bucket WHERE lot_key = '${longKey}'`), "0");
    psql(db, `DELETE FROM "LeadInventoryItem" WHERE id = 'long-1'; DELETE FROM "InventoryLot" WHERE id = 'lot-long'`);

    const cap = psqlCapture(db, `SELECT historical_catalog_summary_apply_items_work(ARRAY(SELECT 'cap-' || g FROM generate_series(1, 501) g))`);
    assert.notEqual(cap.status, 0);
    assert.match(cap.stderr, /chunk exceeds 500/);
    const nullId = psqlCapture(db, `SELECT historical_catalog_summary_apply_items_work(ARRAY[NULL]::text[])`);
    assert.notEqual(nullId.status, 0);
    assert.match(nullId.stderr, /null item ids/);

    psql(db, `INSERT INTO historical_catalog_summary_label (july_label, normalized_label, label_hash) VALUES ('dup-text', 'dup-text', 'h1'), ('dup-text', 'dup-text', 'h2')`);
    assert.ok(Number(issues().duplicateLabels) >= 1);
    psql(db, `DELETE FROM historical_catalog_summary_label WHERE july_label = 'dup-text'`);
    const labelId = scalar(db, `SELECT label_pair_id::text FROM historical_catalog_summary_label LIMIT 1`);
    psql(
      db,
      `INSERT INTO historical_catalog_summary_bucket (
         lot_key, raw_lot_key, import_request, label_pair_id, niche_key, raw_niche_key, item_status, label_agreement, n
       ) VALUES ('zero-lot', 'zero-lot', 'zero-imp', ${labelId}, 'vet', 'vet', 'available', 'july_column_only', 0)`,
    );
    assert.ok(Number(issues().zeroBuckets) >= 1);
    psql(db, `DELETE FROM historical_catalog_summary_bucket WHERE lot_key = 'zero-lot'`);
    const negative = psqlCapture(db, `INSERT INTO historical_catalog_summary_bucket (
         lot_key, raw_lot_key, import_request, label_pair_id, niche_key, raw_niche_key, item_status, label_agreement, n
       ) VALUES ('neg-lot', 'neg-lot', 'neg-imp', ${labelId}, 'vet', 'vet', 'available', 'july_column_only', -1)`);
    assert.notEqual(negative.status, 0);
    assert.match(negative.stderr, /23514|n_nonnegative/);
  });

  it("refuses to authorize a partial backfill, a running checkpoint, or a failed checkpoint", () => {
    const db = localDatabaseUrl(database);
    psql(db, `ALTER TABLE "LeadInventoryItem" DISABLE TRIGGER historical_catalog_summary_item_apply`);
    insertHistorical({ item: "part-1", event: "part-evt", campaign: "Partial" });
    psql(db, `ALTER TABLE "LeadInventoryItem" ENABLE TRIGGER historical_catalog_summary_item_apply`);
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_projection WHERE item_id = 'part-1'`), "1");
    assert.equal(scalar(db, `SELECT count(*)::text FROM historical_catalog_summary_membership WHERE item_id = 'part-1' AND accounted`), "0");
    const denied = JSON.parse(scalar(db, `SELECT historical_catalog_summary_authorize()::text`)) as { authorized: boolean };
    assert.equal(denied.authorized, false);
    assert.equal(control().ready, "false");
    assert.equal(control().invalidation, "authorize_rejected");
    psql(db, `SELECT historical_catalog_summary_apply_item('part-1')`);

    psql(db, `INSERT INTO historical_catalog_summary_checkpoint (range_after, range_until, status) VALUES ('', 'part-1', 'running')`);
    const running = JSON.parse(scalar(db, `SELECT historical_catalog_summary_authorize()::text`)) as { authorized: boolean };
    assert.equal(running.authorized, false);
    assert.equal(control().ready, "false");
    psql(db, `UPDATE historical_catalog_summary_checkpoint SET status = 'failed', finished_at = clock_timestamp(), note = 'superseded' WHERE status = 'running'`);
    psql(db, `INSERT INTO historical_catalog_summary_checkpoint (range_after, range_until, status, finished_at) VALUES ('gap', 'gap-end', 'failed', clock_timestamp())`);
    assert.ok(Number(issues().blockingCheckpoints) >= 1);
    const blocked = JSON.parse(scalar(db, `SELECT historical_catalog_summary_authorize()::text`)) as { authorized: boolean };
    assert.equal(blocked.authorized, false);
    psql(db, `UPDATE historical_catalog_summary_checkpoint SET note = 'superseded' WHERE range_after = 'gap' AND status = 'failed'`);
    assert.equal(issues().blockingCheckpoints, 0);
  });

  it("authorizes only a clean disposable summary and then refuses backfill", () => {
    const db = localDatabaseUrl(database);
    const before = issues();
    assert.equal(before.ok, true, JSON.stringify(before));
    assert.equal(before.negativeBuckets, 0);
    assert.equal(before.zeroBuckets, 0);
    assert.equal(before.duplicateGrains, 0);
    assert.equal(before.projectionMissingMembership, 0);
    assert.equal(before.membershipWithoutProjection, 0);
    assert.equal(before.fieldMismatches, 0);
    assert.equal(before.labelMismatches, 0);
    assert.equal(before.bucketMemberMismatches, 0);
    const authorized = JSON.parse(scalar(db, `SELECT historical_catalog_summary_authorize()::text`)) as { authorized: boolean };
    assert.equal(authorized.authorized, true);
    assert.equal(scalar(db, `SELECT historical_catalog_summary_readable()::text`), "true");
    assert.equal(control().ready, "true");
    const refused = psqlCapture(db, `SELECT historical_catalog_summary_backfill_chunk('', 'zzz')`);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /refused while summary_ready/);
    const second = JSON.parse(scalar(db, `SELECT historical_catalog_summary_authorize()::text`)) as { authorized: boolean };
    assert.equal(second.authorized, true);
    assert.equal(control().ready, "true");
  });
});
