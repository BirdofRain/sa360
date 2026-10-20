/**
 * Operator guard and local dry-run/execute proof for the historical catalog backfill.
 * Execute runs only against SA360_TEST_DATABASE_URL and only inside the g3bf id window.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  CONFIRMATION,
  sanitizeDatabaseError,
  validateInvocation,
  withCatalogSession,
} from "../../../../../scripts/historical-catalog-projection-backfill.mjs";

const repoRoot = join(import.meta.dirname, "../../../../..");
const scriptPath = join(repoRoot, "scripts/historical-catalog-projection-backfill.mjs");
const PREFIX = "g3bf";
const RANGE_AFTER = `${PREFIX}-`;
const RANGE_UNTIL = `${PREFIX}-~`;
const SECRET_LABEL = "g3bf-secret-july-label";
const SECRET_IMPORT = "g3bf-secret-import";
const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrl);

function runCli(args: string[], envOverrides: Record<string, string | undefined>) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value != null) env[key] = value;
  }
  delete env.NODE_ENV;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

describe("historical catalog backfill operator guards", () => {
  const checkpoint = join(tmpdir(), "historical-catalog-backfill-guard.json");
  const localUrl = "postgresql://sa360:sa360password@127.0.0.1:5432/sa360_test";

  it("refuses NODE_ENV=test before opening a database connection", () => {
    const run = runCli(["--checkpoint", checkpoint], { NODE_ENV: "test", DATABASE_URL: localUrl });
    assert.equal(run.status, 2, run.output);
    assert.match(run.stderr, /REFUSED_TEST_RUNTIME/);
    assert.doesNotMatch(run.stdout, /DRY_RUN/);
  });

  it("refuses a chunk above the conservative cap", () => {
    const decision = validateInvocation(
      { "chunk-size": "101", checkpoint: "/tmp/historical-catalog-backfill.json" },
      { DATABASE_URL: localUrl },
    );
    assert.equal(decision.error?.reasonCode, "invalid_operator_input");
    assert.equal(decision.error?.field, "chunk-size");
  });

  it("refuses execute without the confirmation phrase", () => {
    const decision = validateInvocation(
      {
        execute: "true",
        confirm: "yes",
        "expected-db-host": "127.0.0.1:5432",
        checkpoint: "/tmp/historical-catalog-backfill.json",
      },
      { DATABASE_URL: localUrl },
    );
    assert.equal(decision.error?.reasonCode, "confirmation_required");
  });

  it("refuses a non-local execute that skips the health check", () => {
    const decision = validateInvocation(
      {
        execute: "true",
        confirm: CONFIRMATION,
        "expected-db-host": "db.example:25060",
        checkpoint: "/tmp/historical-catalog-backfill.json",
        "init-checkpoint": "true",
      },
      { DATABASE_URL: "postgresql://sa360:secret@db.example:25060/defaultdb" },
    );
    assert.equal(decision.error?.reasonCode, "api_health_url_required");
    assert.equal(decision.error?.writesAttempted, false);
    assert.doesNotMatch(JSON.stringify(decision.error), /secret/);
  });

  it("refuses a host mismatch without connecting", () => {
    const run = runCli(
      [
        "--execute",
        "--confirm",
        CONFIRMATION,
        "--expected-db-host",
        "db.example:25060",
        "--checkpoint",
        checkpoint,
      ],
      { DATABASE_URL: localUrl },
    );
    assert.equal(run.status, 2, run.output);
    assert.match(run.stderr, /db_host_mismatch/);
    assert.doesNotMatch(run.output, /sa360password/);
  });

  it("refuses a checkpoint stored inside the repository", () => {
    const decision = validateInvocation(
      { checkpoint: "scripts/historical-catalog-backfill.json" },
      { DATABASE_URL: localUrl },
    );
    assert.equal(decision.error?.reasonCode, "checkpoint_inside_repo");
  });

  it("keeps the procedure call as the only projection write", () => {
    const source = readFileSync(scriptPath, "utf8");
    const calls = source.match(/CALL historical_catalog_projection_backfill_chunk/g) ?? [];
    assert.equal(calls.length, 1);
    assert.doesNotMatch(source, /INSERT INTO historical_catalog_projection/i);
    assert.doesNotMatch(source, /DISABLE\s+TRIGGER/i);
    assert.doesNotMatch(source, /DROP\s+TRIGGER/i);
    assert.doesNotMatch(source, /CREATE\s+INDEX/i);
    assert.doesNotMatch(source, /UPDATE\s+"LeadInventoryItem"/i);
    assert.doesNotMatch(source, /UPDATE\s+"SourceLeadEvent"/i);
    assert.doesNotMatch(source, /UPDATE\s+"InventoryLot"/i);
    assert.doesNotMatch(source, /UPDATE\s+historical_catalog_projection_control/i);
    assert.doesNotMatch(source, /ready\s*=\s*true/i);
    assert.match(source, /STATEMENT_TIMEOUT = "20s"/);
    assert.match(source, /SET TRANSACTION READ ONLY/);
    assert.doesNotMatch(source, /default_transaction_read_only/);
    const readOnly = source.indexOf("SET TRANSACTION READ ONLY");
    const statementTimeout = source.indexOf("SET LOCAL statement_timeout");
    assert.ok(readOnly >= 0 && readOnly < statementTimeout);
  });

  it("returns driver codes and durations without driver text", () => {
    const secret = "postgres://sa360:secret-password@db.example/defaultdb July secret label";
    const error = Object.assign(new Error(secret), {
      code: "P2010",
      meta: { code: "57014", message: secret },
    });
    const sanitized = sanitizeDatabaseError(error, 20123);
    assert.equal(sanitized.reasonCode, "statement_timeout");
    assert.equal(sanitized.driverCode, "57014");
    assert.equal(sanitized.prismaCode, "P2010");
    assert.equal(sanitized.durationMs, 20123);
    assert.doesNotMatch(JSON.stringify(sanitized), /secret|July|postgres|defaultdb/);
  });

  it("drops unrecognized driver text instead of echoing it", () => {
    const error = Object.assign(new Error("contact@example.com campaign label raw payload"), {
      meta: { code: "contact@example.com", message: "raw payload" },
    });
    const sanitized = sanitizeDatabaseError(error, 4);
    assert.equal(sanitized.reasonCode, "runner_failed");
    assert.equal(sanitized.driverCode, undefined);
    assert.equal(sanitized.durationMs, 4);
    assert.doesNotMatch(JSON.stringify(sanitized), /contact|campaign|payload|example/);
  });

});

describe("historical catalog backfill local dry-run", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let expectedHost = "";
  let databaseUrl = "";
  let checkpointDir = "";

  before(async () => {
    databaseUrl = assertSafeTestDatabaseUrl(integrationUrl);
    const endpoint = new URL(databaseUrl);
    expectedHost = `${endpoint.hostname}:${endpoint.port || "5432"}`;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    checkpointDir = mkdtempSync(join(tmpdir(), "historical-catalog-backfill-"));
    await cleanup();
  });

  after(async () => {
    if (db) {
      await db.historicalCatalogProjectionControl.update({
        where: { singleton: true },
        data: { ready: false },
      }).catch(() => undefined);
      await cleanup();
      await db.$disconnect();
    }
    if (checkpointDir) rmSync(checkpointDir, { recursive: true, force: true });
  });

  async function cleanup() {
    await db.$executeRaw`
      DELETE FROM historical_catalog_projection
      WHERE item_id > ${RANGE_AFTER} AND item_id <= ${RANGE_UNTIL}
    `.catch(() => undefined);
    await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.inventoryLot.deleteMany({ where: { lotKey: { startsWith: PREFIX } } });
  }

  async function seed() {
    await cleanup();
    const lot = await db.inventoryLot.create({
      data: {
        lotKey: `${PREFIX}-lot`,
        displayName: "Gate 3 lot",
        sourceProvider: "manual_import",
        sourceLane: PREFIX,
        nicheKey: "vet",
        inventoryClass: "aged",
        status: "active",
      },
    });
    async function historical(id: string) {
      const eventId = `${PREFIX}-evt-${id}`;
      const itemId = `${PREFIX}-${id}`;
      await db.sourceLeadEvent.create({
        data: {
          id: eventId,
          sourceProvider: "manual_import",
          sourceSystem: "csv_import",
          sourceType: "bulk_import",
          sourceCampaignName: SECRET_LABEL,
          bulkImportId: SECRET_IMPORT,
          status: "approved",
          rawPayloadJson: { importRequestId: SECRET_IMPORT, master: {} } as Prisma.InputJsonValue,
          normalizedPayloadJson: { campaign_name: SECRET_LABEL } as Prisma.InputJsonValue,
        },
      });
      await db.leadInventoryItem.create({
        data: {
          id: itemId,
          inventoryLotId: lot.id,
          sourceLeadEventId: eventId,
          generatedAt: new Date("2026-01-15T00:00:00.000Z"),
          normalizedState: "GA",
          nicheKey: "vet",
          sourceProvider: "manual_import",
          sourceLane: PREFIX,
          inventoryClass: "aged",
          status: "available",
          availableAt: new Date("2026-02-01T00:00:00.000Z"),
        },
      });
      return { eventId, itemId };
    }
    const first = await historical("a");
    const second = await historical("b");
    const liveEvent = await db.sourceLeadEvent.create({
      data: {
        id: `${PREFIX}-evt-live`,
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceCampaignName: SECRET_LABEL,
        status: "received",
        rawPayloadJson: { id: "live" },
      },
    });
    const liveItem = await db.leadInventoryItem.create({
      data: {
        id: `${PREFIX}-live`,
        inventoryLotId: lot.id,
        sourceLeadEventId: liveEvent.id,
        generatedAt: new Date("2026-01-15T00:00:00.000Z"),
        normalizedState: "GA",
        nicheKey: "vet",
        sourceProvider: "leadcapture_io",
        sourceLane: PREFIX,
        inventoryClass: "aged",
        status: "available",
        availableAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    await db.historicalCatalogProjection.delete({ where: { itemId: first.itemId } });
    await db.historicalCatalogProjection.create({
      data: {
        itemId: liveItem.id,
        lotKey: "(blank)",
        importRequest: "(none)",
        nicheKey: "vet",
        itemStatus: "available",
        labelAgreement: "all_missing",
        refreshedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    return { first, second, liveItem };
  }

  function checkpointPath(name: string) {
    return join(checkpointDir, name);
  }

  function cli(args: string[]) {
    return runCli(args, { DATABASE_URL: databaseUrl });
  }

  it("previews discrepancies and does not write", async () => {
    const seeded = await seed();
    const before = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: seeded.first.eventId } });
    const run = cli([
      "--expected-db-host",
      expectedHost,
      "--checkpoint",
      checkpointPath("preview.json"),
      "--after",
      RANGE_AFTER,
      "--until",
      RANGE_UNTIL,
      "--confirm",
      CONFIRMATION,
    ]);
    assert.equal(run.status, 0, run.output);
    assert.doesNotMatch(run.output, new RegExp(SECRET_LABEL));
    assert.doesNotMatch(run.output, new RegExp(SECRET_IMPORT));
    const report = JSON.parse(run.stdout);
    assert.equal(report.outcome, "DRY_RUN");
    assert.equal(report.writesAttempted, false);
    assert.equal(report.readyChanged, false);
    assert.equal(report.ready, false);
    assert.equal(report.chunks[0].items, 3);
    assert.equal(report.chunks[0].sourceRows, 2);
    assert.equal(report.chunks[0].applied, false);
    assert.equal(report.chunks[0].diff.missing_projection, 1);
    assert.equal(report.chunks[0].diff.not_historical, 1);
    assert.equal(report.chunks[0].duplicateSourceIds, 0);
    assert.equal(
      await db.historicalCatalogProjection.findUnique({ where: { itemId: seeded.first.itemId } }),
      null,
    );
    assert.ok(await db.historicalCatalogProjection.findUnique({ where: { itemId: seeded.liveItem.id } }));
    const after = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: seeded.first.eventId } });
    assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
    const control = await db.historicalCatalogProjectionControl.findUniqueOrThrow({
      where: { singleton: true },
    });
    assert.equal(control.ready, false);
  });

  it("applies one explicit chunk, keeps ready false, and repeats cleanly", async () => {
    const seeded = await seed();
    const before = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: seeded.first.eventId } });
    const firstCheckpoint = checkpointPath("apply.json");
    const apply = cli([
      "--execute",
      "--confirm",
      CONFIRMATION,
      "--expected-db-host",
      expectedHost,
      "--checkpoint",
      firstCheckpoint,
      "--init-checkpoint",
      "--after",
      RANGE_AFTER,
      "--until",
      RANGE_UNTIL,
    ]);
    assert.equal(apply.status, 0, apply.output);
    assert.doesNotMatch(apply.output, new RegExp(SECRET_LABEL));
    assert.doesNotMatch(apply.output, new RegExp(SECRET_IMPORT));
    const report = JSON.parse(apply.stdout);
    assert.equal(report.outcome, "APPLIED");
    assert.equal(report.ready, false);
    assert.equal(report.readyChanged, false);
    assert.equal(report.chunks[0].applied, true);
    assert.deepEqual(report.chunks[0].diff, {});
    assert.equal(report.chunks[0].diffTruncated, false);
    assert.equal(report.chunks[0].duplicateSourceIds, 0);
    const projected = await db.historicalCatalogProjection.findUniqueOrThrow({
      where: { itemId: seeded.first.itemId },
    });
    assert.equal(projected.itemStatus, "available");
    assert.equal(projected.nicheKey, "vet");
    assert.notEqual(projected.julyLabel, undefined);
    assert.equal(
      await db.historicalCatalogProjection.findUnique({ where: { itemId: seeded.liveItem.id } }),
      null,
    );
    const after = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: seeded.first.eventId } });
    assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
    assert.equal(after.sourceCampaignName, SECRET_LABEL);
    const control = await db.historicalCatalogProjectionControl.findUniqueOrThrow({
      where: { singleton: true },
    });
    assert.equal(control.ready, false);
    const saved = JSON.parse(readFileSync(firstCheckpoint, "utf8"));
    assert.equal(saved.version, 2);
    assert.equal(saved.appliedAfterId, RANGE_UNTIL);
    assert.equal(saved.chunksCompleted, 1);
    assert.equal(saved.database.host, new URL(databaseUrl).hostname);
    assert.equal(saved.database.name, new URL(databaseUrl).pathname.replace(/^\//, ""));
    assert.match(saved.database.oid, /^\d+$/);
    assert.deepEqual(report.checkpointRecovery, saved);
    const password = new URL(databaseUrl).password;
    if (password) assert.doesNotMatch(apply.output, new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const resumed = cli([
      "--execute",
      "--confirm",
      CONFIRMATION,
      "--expected-db-host",
      expectedHost,
      "--checkpoint",
      firstCheckpoint,
      "--after",
      RANGE_AFTER,
      "--until",
      RANGE_UNTIL,
    ]);
    assert.equal(resumed.status, 2, resumed.output);
    assert.match(resumed.output, /checkpoint_cursor_mismatch/);
    assert.equal(JSON.parse(readFileSync(firstCheckpoint, "utf8")).chunksCompleted, 1);

    const second = cli([
      "--execute",
      "--confirm",
      CONFIRMATION,
      "--expected-db-host",
      expectedHost,
      "--checkpoint",
      checkpointPath("repeat.json"),
      "--init-checkpoint",
      "--after",
      RANGE_AFTER,
      "--until",
      RANGE_UNTIL,
    ]);
    assert.equal(second.status, 0, second.output);
    const repeated = JSON.parse(second.stdout);
    assert.equal(repeated.outcome, "APPLIED");
    assert.deepEqual(repeated.chunks[0].diff, {});
    assert.equal(repeated.ready, false);
    const afterRepeat = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: seeded.first.eventId } });
    assert.equal(afterRepeat.updatedAt.toISOString(), before.updatedAt.toISOString());
    assert.equal(
      (await db.historicalCatalogProjectionControl.findUniqueOrThrow({ where: { singleton: true } })).ready,
      false,
    );
  });

  it("rejects writes inside the dry-run transaction and still allows execute to call the procedure", async () => {
    const probe = `${PREFIX}-ro-probe`;
    const statements = [
      `INSERT INTO historical_catalog_projection (item_id, lot_key, import_request, niche_key, item_status, label_agreement, refreshed_at) VALUES ('${probe}', '(blank)', '(none)', 'vet', 'available', 'all_missing', clock_timestamp())`,
      `UPDATE historical_catalog_projection SET niche_key = niche_key WHERE item_id = '${probe}'`,
      `DELETE FROM historical_catalog_projection WHERE item_id = '${probe}'`,
      `CALL historical_catalog_projection_backfill_chunk('${RANGE_AFTER}', '${RANGE_UNTIL}')`,
    ];
    for (const sql of statements) {
      let caught = null;
      try {
        await withCatalogSession(db, true, async (tx) => {
          await tx.$executeRawUnsafe(sql);
        });
      } catch (error) {
        caught = error;
      }
      const sanitized = sanitizeDatabaseError(caught, 15);
      assert.equal(sanitized.driverCode, "25006", sql);
      assert.equal(sanitized.reasonCode, "read_only_transaction");
      assert.equal(sanitized.durationMs, 15);
      assert.doesNotMatch(JSON.stringify(sanitized), new RegExp(`${PREFIX}|July|postgres`));
    }
    await withCatalogSession(db, false, async (tx) => {
      await tx.$executeRaw`CALL historical_catalog_projection_backfill_chunk(${RANGE_AFTER}, ${RANGE_UNTIL})`;
      await tx.$executeRaw`
        INSERT INTO historical_catalog_projection (
          item_id, lot_key, import_request, niche_key, item_status, label_agreement, refreshed_at
        ) VALUES (
          ${probe}, '(blank)', '(none)', 'vet', 'available', 'all_missing', clock_timestamp()
        )
      `;
      await tx.$executeRaw`DELETE FROM historical_catalog_projection WHERE item_id = ${probe}`;
    });
    const control = await db.historicalCatalogProjectionControl.findUniqueOrThrow({
      where: { singleton: true },
    });
    assert.equal(control.ready, false);
    assert.equal(await db.historicalCatalogProjection.findUnique({ where: { itemId: probe } }), null);
  });

  it("rejects a checkpoint bound to a different database", async () => {
    const seeded = await seed();
    const checkpoint = checkpointPath("foreign.json");
    const endpoint = new URL(databaseUrl);
    writeFileSync(
      checkpoint,
      JSON.stringify({
        version: 2,
        database: {
          host: endpoint.hostname,
          port: endpoint.port || "5432",
          name: endpoint.pathname.replace(/^\//, ""),
          oid: "0",
        },
        appliedAfterId: RANGE_AFTER,
        chunkSize: 100,
        chunksCompleted: 4,
        secretLabel: SECRET_LABEL,
      }),
    );
    const run = cli([
      "--expected-db-host",
      expectedHost,
      "--checkpoint",
      checkpoint,
      "--after",
      RANGE_AFTER,
      "--until",
      RANGE_UNTIL,
    ]);
    assert.equal(run.status, 2, run.output);
    assert.match(run.stdout, /checkpoint_database_mismatch/);
    assert.match(run.stdout, /"mismatch":\s*\[\s*"oid"\s*\]/);
    assert.doesNotMatch(run.output, new RegExp(SECRET_LABEL));
    assert.equal(
      await db.historicalCatalogProjection.findUnique({ where: { itemId: seeded.first.itemId } }),
      null,
    );
    assert.equal(JSON.parse(readFileSync(checkpoint, "utf8")).chunksCompleted, 4);
  });

  it("does not advance the checkpoint when ready is already true", async () => {
    const seeded = await seed();
    const checkpoint = checkpointPath("ready.json");
    await db.historicalCatalogProjectionControl.update({
      where: { singleton: true },
      data: { ready: true },
    });
    try {
      const run = cli([
        "--execute",
        "--confirm",
        CONFIRMATION,
        "--expected-db-host",
        expectedHost,
        "--checkpoint",
        checkpoint,
        "--init-checkpoint",
        "--after",
        RANGE_AFTER,
        "--until",
        RANGE_UNTIL,
      ]);
      assert.equal(run.status, 1, run.output);
      const report = JSON.parse(run.stdout);
      assert.equal(report.outcome, "STOPPED");
      assert.equal(report.reasonCode, "ready_not_false");
      assert.equal(report.writesAttempted, false);
      assert.equal(report.checkpointAdvanced, false);
      assert.equal(
        await db.historicalCatalogProjection.findUnique({ where: { itemId: seeded.first.itemId } }),
        null,
      );
      const saved = JSON.parse(readFileSync(checkpoint, "utf8"));
      assert.equal(saved.appliedAfterId, RANGE_AFTER);
      assert.equal(saved.chunksCompleted, 0);
    } finally {
      await db.historicalCatalogProjectionControl.update({
        where: { singleton: true },
        data: { ready: false },
      });
    }
  });
});
