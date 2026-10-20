/**
 * Local proof for the Gate 2 historical catalog projection.
 * Uses SA360_TEST_DATABASE_URL (localhost, database name contains "test")
 * and a disposable database created from that same local server.
 * No production connection. The backfill procedure is called only on fixture ids.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrl);
const PREFIX = "g2proj";
const RANGE_AFTER = "g2proj-";
const RANGE_UNTIL = "g2proj-~";
const repoRoot = join(import.meta.dirname, "../../../../..");
const migrationName = "20261020200000_historical_catalog_projection_v1";
const migrationSql = readFileSync(
  join(repoRoot, "prisma/migrations", migrationName, "migration.sql"),
  "utf8",
);
const triggerSql = migrationSql.slice(
  migrationSql.indexOf("CREATE TRIGGER historical_catalog_projection_item_refresh"),
);
const triggerStatements = triggerSql
  .split(/;\s*\n/)
  .map((part) => part.trim())
  .filter((part) => part.startsWith("CREATE TRIGGER"));
const dropTriggerStatements = [
  `DROP TRIGGER IF EXISTS historical_catalog_projection_item_refresh ON "LeadInventoryItem"`,
  `DROP TRIGGER IF EXISTS historical_catalog_projection_event_refresh ON "SourceLeadEvent"`,
  `DROP TRIGGER IF EXISTS historical_catalog_projection_lot_refresh ON "InventoryLot"`,
];

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

function terminateClients(adminUrl: string, database: string): void {
  psql(
    adminUrl,
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = '${database}'
       AND pid <> pg_backend_pid()
       AND backend_type = 'client backend'
       AND usename = current_user`,
  );
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

type DiffRow = {
  item_id: string;
  discrepancy: string;
  source_value: string | null;
  projection_value: string | null;
};

type LockRow = { relname: string; mode: string; granted: boolean };

describe("historical catalog projection gate 2", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const scratchDatabase = "sa360_proj_gate2_test";

  before(async () => {
    db = new PrismaClient({ datasources: { db: { url: assertSafeTestDatabaseUrl(integrationUrl) } } });
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
    const admin = localDatabaseUrl("sa360");
    terminateClients(admin, scratchDatabase);
    psql(admin, `DROP DATABASE IF EXISTS ${scratchDatabase};`);
  });

  async function cleanup(): Promise<void> {
    await db.$executeRaw`
      DELETE FROM historical_catalog_projection
      WHERE item_id > ${RANGE_AFTER} AND item_id <= ${RANGE_UNTIL}
    `.catch(() => undefined);
    await db.leadInventoryItem.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await db.inventoryLot.deleteMany({ where: { lotKey: { startsWith: PREFIX } } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { startsWith: PREFIX } } });
  }

  async function diff(): Promise<DiffRow[]> {
    return db.$queryRaw<DiffRow[]>`
      SELECT item_id, discrepancy, source_value, projection_value
      FROM historical_catalog_projection_diff(${RANGE_AFTER}, ${RANGE_UNTIL}, 50)
    `;
  }

  async function seedHistorical(input?: {
    id?: string;
    campaign?: string | null;
    workbook?: string | null;
    rawLabel?: string | null;
    importRequest?: string | null;
    bulkImportId?: string | null;
    status?: "available" | "pending_review";
    niche?: string;
    origin?: string | null;
    lotKey?: string;
  }): Promise<{ itemId: string; eventId: string; lotId: string }> {
    const id = input?.id ?? "item";
    const lotKey = input?.lotKey ?? `${PREFIX}-lot`;
    const lot = await db.inventoryLot.upsert({
      where: { lotKey },
      update: {},
      create: {
        lotKey,
        displayName: "Gate 2 lot",
        sourceProvider: "manual_import",
        sourceLane: PREFIX,
        nicheKey: "vet",
        inventoryClass: "aged",
        status: "active",
      },
    });
    const raw: Record<string, unknown> = { master: {} };
    if (input?.importRequest !== null) raw.importRequestId = input?.importRequest ?? `${PREFIX}-import`;
    if (input?.rawLabel) (raw.master as Record<string, unknown>).lead_type = input.rawLabel;
    const normalized: Record<string, unknown> = {};
    if (input?.workbook) normalized.campaign_name = input.workbook;
    const eventId = `${PREFIX}-evt-${id}`;
    const itemId = `${PREFIX}-${id}`;
    await db.sourceLeadEvent.create({
      data: {
        id: eventId,
        sourceProvider: "manual_import",
        sourceSystem: "csv_import",
        sourceType: "bulk_import",
        sourceCampaignName: input?.campaign === undefined ? "July Label" : input.campaign,
        bulkImportId: input?.bulkImportId ?? null,
        status: "approved",
        rawPayloadJson: raw as Prisma.InputJsonValue,
        normalizedPayloadJson: normalized as Prisma.InputJsonValue,
      },
    });
    const status = input?.status ?? "available";
    await db.leadInventoryItem.create({
      data: {
        id: itemId,
        inventoryLotId: lot.id,
        sourceLeadEventId: eventId,
        generatedAt: new Date("2026-01-15T00:00:00.000Z"),
        normalizedState: "GA",
        nicheKey: input?.niche ?? "vet",
        sourceProvider: "manual_import",
        sourceLane: PREFIX,
        inventoryClass: "aged",
        status,
        availableAt: status === "available" ? new Date("2026-02-01T00:00:00.000Z") : null,
        originClientAccountId: input?.origin ?? null,
      },
    });
    return { itemId, eventId, lotId: lot.id };
  }

  it("projects the catalog fields and does not rewrite source rows", async () => {
    await db.clientAccount.create({
      data: { clientAccountId: `${PREFIX}-origin`, clientDisplayName: "Gate 2 origin", status: "active" },
    });
    const seeded = await seedHistorical({
      campaign: "  July   Label ",
      workbook: "Other Workbook",
      rawLabel: "  July   Label ",
      importRequest: "",
      bulkImportId: `${PREFIX}-bulk`,
      niche: "trucker",
      origin: `${PREFIX}-origin`,
    });
    const before = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: seeded.eventId } });
    const projected = await db.historicalCatalogProjection.findUniqueOrThrow({
      where: { itemId: seeded.itemId },
    });
    assert.equal(projected.lotKey, `${PREFIX}-lot`);
    assert.equal(projected.importRequest, `${PREFIX}-bulk`);
    assert.equal(projected.julyLabel, "July   Label");
    assert.equal(projected.normalizedLabel, "July Label");
    assert.equal(projected.labelAgreement, "july_column_conflicts");
    assert.equal(projected.itemStatus, "available");
    assert.equal(projected.originId, `${PREFIX}-origin`);
    assert.equal(projected.nicheKey, "trucker");
    assert.deepEqual(await diff(), []);

    await db.$executeRaw`
      CALL historical_catalog_projection_backfill_chunk(${RANGE_AFTER}, ${RANGE_UNTIL})
    `;
    const after = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: seeded.eventId } });
    assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
    assert.equal(after.sourceCampaignName, before.sourceCampaignName);
    assert.deepEqual(after.rawPayloadJson, before.rawPayloadJson);
    const control = await db.historicalCatalogProjectionControl.findUniqueOrThrow({
      where: { singleton: true },
    });
    assert.equal(control.ready, false);
    assert.deepEqual(await diff(), []);
  });

  it("follows status, label, lot key, insert, and delete without a source rewrite", async () => {
    const seeded = await seedHistorical({ campaign: "Kept Label", workbook: "Kept Label" });
    const eventBefore = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: seeded.eventId } });
    await db.leadInventoryItem.update({
      where: { id: seeded.itemId },
      data: { status: "withdrawn", withdrawnAt: new Date("2026-03-01T00:00:00.000Z") },
    });
    await db.sourceLeadEvent.update({
      where: { id: seeded.eventId },
      data: { sourceCampaignName: "Relabeled Campaign" },
    });
    await db.inventoryLot.update({
      where: { id: seeded.lotId },
      data: { lotKey: `${PREFIX}-lot-renamed` },
    });
    const projected = await db.historicalCatalogProjection.findUniqueOrThrow({
      where: { itemId: seeded.itemId },
    });
    assert.equal(projected.itemStatus, "withdrawn");
    assert.equal(projected.julyLabel, "Relabeled Campaign");
    assert.equal(projected.labelAgreement, "july_column_conflicts");
    assert.equal(projected.lotKey, `${PREFIX}-lot-renamed`);
    const eventAfter = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: seeded.eventId } });
    assert.equal(eventAfter.rawPayloadJson && JSON.stringify(eventAfter.rawPayloadJson), JSON.stringify(eventBefore.rawPayloadJson));

    await db.leadInventoryItem.delete({ where: { id: seeded.itemId } });
    assert.equal(
      await db.historicalCatalogProjection.findUnique({ where: { itemId: seeded.itemId } }),
      null,
    );
    assert.ok(await db.sourceLeadEvent.findUnique({ where: { id: seeded.eventId } }));

    const live = await db.sourceLeadEvent.create({
      data: {
        id: `${PREFIX}-evt-live`,
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceCampaignName: "Live intake",
        status: "received",
        rawPayloadJson: { id: "live" },
      },
    });
    const liveProjection = await db.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n
      FROM historical_catalog_projection
      WHERE item_id = ${live.id}
    `;
    assert.equal(liveProjection[0]?.n, 0);
  });

  async function withBackfillBlockedOnProjection(
    mutate: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    const writer = new PrismaClient({ datasources: { db: { url: assertSafeTestDatabaseUrl(integrationUrl) } } });
    const watcher = new PrismaClient({ datasources: { db: { url: assertSafeTestDatabaseUrl(integrationUrl) } } });
    let releaseWriter: () => void = () => undefined;
    const writerMayFinish = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let writerReady: () => void = () => undefined;
    const writerHolding = new Promise<void>((resolve) => {
      writerReady = resolve;
    });
    let writerTransaction: Promise<unknown> | undefined;
    let backfill: Promise<unknown> | undefined;
    try {
      writerTransaction = writer.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ item_id: string }>>`
            SELECT item_id FROM historical_catalog_projection
            WHERE item_id > ${RANGE_AFTER} AND item_id <= ${RANGE_UNTIL}
            FOR UPDATE
          `;
          assert.ok(locked.length > 0, "expected projection rows to lock");
          writerReady();
          await writerMayFinish;
          await mutate(tx);
        },
        { maxWait: 5_000, timeout: 25_000 },
      );
      const writerGate = await Promise.race([
        writerHolding.then(() => "holding" as const),
        writerTransaction.then(() => "finished" as const, () => "failed" as const),
      ]);
      if (writerGate !== "holding") {
        await writerTransaction;
        throw new Error("writer finished before the backfill was blocked");
      }
      backfill = db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('application_name', 'g2proj-backfill', true)`;
        await tx.$executeRaw`
          CALL historical_catalog_projection_backfill_chunk(${RANGE_AFTER}, ${RANGE_UNTIL})
        `;
      }, { maxWait: 5_000, timeout: 25_000 });

      const started = Date.now();
      let sawLockWait = false;
      let activity = "";
      while (Date.now() - started < 5_000) {
        const waiting = await watcher.$queryRaw<Array<{
          application_name: string | null;
          wait_event_type: string | null;
          query: string | null;
        }>>`
          SELECT application_name, wait_event_type::text AS wait_event_type, left(query, 240) AS query
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
        `;
        activity = JSON.stringify(waiting);
        sawLockWait = waiting.some((row) =>
          row.wait_event_type === "Lock"
          && (
            row.application_name === "g2proj-backfill"
            || (row.query ?? "").includes("historical_catalog_projection")
          ));
        if (sawLockWait) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!sawLockWait) {
        throw new Error(`backfill did not wait on the projection row lock: ${activity}`);
      }
      releaseWriter();
      await writerTransaction;
      await backfill;
    } finally {
      releaseWriter();
      if (writerTransaction) await writerTransaction.catch(() => undefined);
      if (backfill) await backfill.catch(() => undefined);
      await writer.$disconnect().catch(() => undefined);
      await watcher.$disconnect().catch(() => undefined);
    }
  }

  it("does not let a blocked backfill overwrite trigger writes", { timeout: 40_000 }, async () => {
    await db.clientAccount.create({
      data: {
        clientAccountId: `${PREFIX}-origin-race`,
        clientDisplayName: "Gate 2 race origin",
        status: "active",
      },
    });
    const statusItem = await seedHistorical({
      id: "status",
      campaign: "Status Label",
      workbook: "Status Label",
      lotKey: `${PREFIX}-lot-race`,
    });
    const eventItem = await seedHistorical({
      id: "event",
      campaign: "Original Label",
      workbook: "Original Label",
      importRequest: null,
      bulkImportId: `${PREFIX}-bulk-old`,
      lotKey: `${PREFIX}-lot-race`,
    });
    const deleteItem = await seedHistorical({
      id: "delete",
      campaign: "Delete Label",
      workbook: "Delete Label",
      lotKey: `${PREFIX}-lot-race`,
    });
    const untouchedEvent = await db.sourceLeadEvent.findUniqueOrThrow({
      where: { id: statusItem.eventId },
    });
    const untouchedItem = await db.leadInventoryItem.findUniqueOrThrow({
      where: { id: eventItem.itemId },
    });

    await withBackfillBlockedOnProjection(async (tx) => {
      await tx.leadInventoryItem.update({
        where: { id: statusItem.itemId },
        data: {
          status: "withdrawn",
          withdrawnAt: new Date("2026-03-02T00:00:00.000Z"),
          nicheKey: "trucker",
          originClientAccountId: `${PREFIX}-origin-race`,
        },
      });
      await tx.sourceLeadEvent.update({
        where: { id: eventItem.eventId },
        data: {
          sourceCampaignName: "Trigger Label",
          bulkImportId: `${PREFIX}-bulk-new`,
        },
      });
      await tx.inventoryLot.update({
        where: { id: statusItem.lotId },
        data: { lotKey: `${PREFIX}-lot-raced` },
      });
      await tx.leadInventoryItem.delete({ where: { id: deleteItem.itemId } });
      await tx.leadInventoryItem.create({
        data: {
          id: `${PREFIX}-fresh`,
          inventoryLotId: statusItem.lotId,
          sourceLeadEventId: (await tx.sourceLeadEvent.create({
            data: {
              id: `${PREFIX}-evt-fresh`,
              sourceProvider: "manual_import",
              sourceSystem: "csv_import",
              sourceType: "bulk_import",
              sourceCampaignName: "Inserted During Chunk",
              status: "approved",
              rawPayloadJson: { importRequestId: `${PREFIX}-import-fresh` },
              normalizedPayloadJson: { campaign_name: "Inserted During Chunk" },
            },
          })).id,
          generatedAt: new Date("2026-01-15T00:00:00.000Z"),
          normalizedState: "GA",
          nicheKey: "vet",
          sourceProvider: "manual_import",
          sourceLane: PREFIX,
          inventoryClass: "aged",
          status: "pending_review",
        },
      });
    });

    const statusProjected = await db.historicalCatalogProjection.findUniqueOrThrow({
      where: { itemId: statusItem.itemId },
    });
    assert.equal(statusProjected.itemStatus, "withdrawn");
    assert.equal(statusProjected.nicheKey, "trucker");
    assert.equal(statusProjected.originId, `${PREFIX}-origin-race`);
    assert.equal(statusProjected.lotKey, `${PREFIX}-lot-raced`);
    assert.equal(statusProjected.julyLabel, "Status Label");

    const eventProjected = await db.historicalCatalogProjection.findUniqueOrThrow({
      where: { itemId: eventItem.itemId },
    });
    assert.equal(eventProjected.julyLabel, "Trigger Label");
    assert.equal(eventProjected.normalizedLabel, "Trigger Label");
    assert.equal(eventProjected.labelAgreement, "july_column_conflicts");
    assert.equal(eventProjected.importRequest, `${PREFIX}-bulk-new`);
    assert.equal(eventProjected.lotKey, `${PREFIX}-lot-raced`);

    assert.equal(
      await db.historicalCatalogProjection.findUnique({ where: { itemId: deleteItem.itemId } }),
      null,
    );
    assert.ok(await db.sourceLeadEvent.findUnique({ where: { id: deleteItem.eventId } }));

    const fresh = await db.historicalCatalogProjection.findUniqueOrThrow({
      where: { itemId: `${PREFIX}-fresh` },
    });
    assert.equal(fresh.julyLabel, "Inserted During Chunk");
    assert.equal(fresh.labelAgreement, "july_column_agrees");
    assert.equal(fresh.importRequest, `${PREFIX}-import-fresh`);
    assert.equal(fresh.itemStatus, "pending_review");
    assert.equal(fresh.lotKey, `${PREFIX}-lot-raced`);
    assert.deepEqual(await diff(), []);

    const statusEventAfter = await db.sourceLeadEvent.findUniqueOrThrow({
      where: { id: statusItem.eventId },
    });
    assert.equal(statusEventAfter.updatedAt.toISOString(), untouchedEvent.updatedAt.toISOString());
    assert.equal(statusEventAfter.sourceCampaignName, untouchedEvent.sourceCampaignName);
    const eventItemAfter = await db.leadInventoryItem.findUniqueOrThrow({
      where: { id: eventItem.itemId },
    });
    assert.equal(eventItemAfter.updatedAt.toISOString(), untouchedItem.updatedAt.toISOString());
    assert.equal(eventItemAfter.status, untouchedItem.status);
    const control = await db.historicalCatalogProjectionControl.findUniqueOrThrow({
      where: { singleton: true },
    });
    assert.equal(control.ready, false);
  });

  it("keeps a newer refreshed_at when the chunk would otherwise write stale fields", async () => {
    const seeded = await seedHistorical({ id: "guard", campaign: "Source Label", workbook: "Source Label" });
    await db.$executeRaw`
      UPDATE historical_catalog_projection
      SET july_label = 'Trigger Wins',
          normalized_label = 'Trigger Wins',
          label_agreement = 'july_column_only',
          refreshed_at = clock_timestamp() + interval '1 hour'
      WHERE item_id = ${seeded.itemId}
    `;
    await db.$executeRaw`
      CALL historical_catalog_projection_backfill_chunk(${RANGE_AFTER}, ${RANGE_UNTIL})
    `;
    const kept = await db.historicalCatalogProjection.findUniqueOrThrow({
      where: { itemId: seeded.itemId },
    });
    assert.equal(kept.julyLabel, "Trigger Wins");

    await db.leadInventoryItem.update({
      where: { id: seeded.itemId },
      data: { status: "pending_review", availableAt: null },
    });
    const repaired = await db.historicalCatalogProjection.findUniqueOrThrow({
      where: { itemId: seeded.itemId },
    });
    assert.equal(repaired.julyLabel, "Source Label");
    assert.equal(repaired.itemStatus, "pending_review");
    assert.deepEqual(await diff(), []);
  });

  it("removes a non-historical projection row without restoring it from a stale chunk", async () => {
    const seeded = await seedHistorical({ id: "drop", campaign: "Will Leave" });
    await db.leadInventoryItem.update({
      where: { id: seeded.itemId },
      data: { sourceProvider: "leadcapture_io" },
    });
    await db.sourceLeadEvent.update({
      where: { id: seeded.eventId },
      data: { sourceProvider: "leadcapture_io", sourceSystem: "leadcapture_io_nextgen" },
    });
    assert.equal(
      await db.historicalCatalogProjection.findUnique({ where: { itemId: seeded.itemId } }),
      null,
    );
    await db.$executeRaw`
      INSERT INTO historical_catalog_projection (
        item_id, lot_key, import_request, niche_key, item_status, july_label,
        normalized_label, label_agreement, refreshed_at
      )
      VALUES (
        ${seeded.itemId}, 'stale-lot', 'stale-import', 'vet', 'available', 'Stale',
        'Stale', 'july_column_only', transaction_timestamp() - interval '1 day'
      )
    `;
    await db.$executeRaw`
      CALL historical_catalog_projection_backfill_chunk(${RANGE_AFTER}, ${RANGE_UNTIL})
    `;
    assert.equal(
      await db.historicalCatalogProjection.findUnique({ where: { itemId: seeded.itemId } }),
      null,
    );
  });

  async function ensureProjectionTriggers(): Promise<void> {
    const triggers = await db.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname::text
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname LIKE 'historical_catalog_projection_%'
    `;
    const names = triggers.map((row) => row.tgname).sort();
    const expected = [
      "historical_catalog_projection_event_refresh",
      "historical_catalog_projection_item_refresh",
      "historical_catalog_projection_lot_refresh",
    ];
    if (names.length === expected.length && expected.every((name) => names.includes(name))) return;
    for (const statement of dropTriggerStatements) await db.$executeRawUnsafe(statement);
    for (const statement of triggerStatements) await db.$executeRawUnsafe(statement);
  }

  it("reports CREATE TRIGGER locks, open reads, and blocked writes", async () => {
    const reader = new PrismaClient({
      datasources: { db: { url: assertSafeTestDatabaseUrl(integrationUrl) } },
    });
    const writer = new PrismaClient({
      datasources: { db: { url: assertSafeTestDatabaseUrl(integrationUrl) } },
    });
    let locks: LockRow[] = [];
    try {
      // The drop commits first. CREATE TRIGGER is the only statement measured below.
      for (const statement of dropTriggerStatements) await db.$executeRawUnsafe(statement);
      locks = await db.$transaction(
        async (tx) => {
          for (const statement of triggerStatements) await tx.$executeRawUnsafe(statement);
          const held = await tx.$queryRaw<LockRow[]>`
            SELECT c.relname::text AS relname, l.mode::text AS mode, l.granted
            FROM pg_locks l
            JOIN pg_class c ON c.oid = l.relation
            WHERE l.pid = pg_backend_pid()
              AND l.granted
              AND c.relname IN ('LeadInventoryItem', 'SourceLeadEvent', 'InventoryLot')
            ORDER BY c.relname, l.mode
          `;
          const openRead = await reader.$queryRaw<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM "SourceLeadEvent"
          `;
          assert.equal(typeof openRead[0]?.n, "number");

          let writerAttempt: Promise<unknown> | undefined;
          try {
            writerAttempt = writer.$transaction(async (writeTx) => {
              await writeTx.$executeRaw`SELECT set_config('lock_timeout', '2s', true)`;
              await writeTx.$executeRaw`
                INSERT INTO "SourceLeadEvent" (
                  id, "sourceProvider", "sourceSystem", "sourceType", status, "rawPayloadJson",
                  "receivedAt", "createdAt", "updatedAt"
                ) VALUES (
                  ${`${PREFIX}-evt-blocked`},
                  'leadcapture_io'::"SourceLeadProvider",
                  'leadcapture_io_nextgen'::"SourceLeadSystem",
                  'webhook'::"SourceLeadType",
                  'received'::"SourceLeadEventStatus",
                  '{}'::jsonb,
                  now(), now(), now()
                )
              `;
            }, { maxWait: 5_000, timeout: 10_000 });
            const started = Date.now();
            let sawWriteWait = false;
            let activity = "";
            while (Date.now() - started < 3_000) {
              const waiting = await reader.$queryRaw<Array<{ wait_event_type: string | null; query: string | null }>>`
                SELECT wait_event_type::text AS wait_event_type, left(query, 180) AS query
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
              `;
              activity = JSON.stringify(waiting);
              sawWriteWait = waiting.some((row) =>
                row.wait_event_type === "Lock" && (row.query ?? "").includes("SourceLeadEvent"));
              if (sawWriteWait) break;
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            assert.equal(sawWriteWait, true, activity);
            const readDuringWrite = await reader.$queryRaw<Array<{ n: number }>>`
              SELECT count(*)::int AS n FROM "SourceLeadEvent"
            `;
            assert.equal(typeof readDuringWrite[0]?.n, "number");
            await assert.rejects(writerAttempt, /lock timeout|55P03/i);
          } finally {
            if (writerAttempt) await writerAttempt.catch(() => undefined);
          }
          return held;
        },
        { maxWait: 5_000, timeout: 20_000 },
      );
    } finally {
      await reader.$disconnect().catch(() => undefined);
      await writer.$disconnect().catch(() => undefined);
      await ensureProjectionTriggers();
    }

    for (const table of ["LeadInventoryItem", "SourceLeadEvent", "InventoryLot"]) {
      const modes = locks.filter((lock) => lock.relname === table).map((lock) => lock.mode);
      assert.deepEqual(modes, ["ShareRowExclusiveLock"], JSON.stringify(locks));
    }
    assert.equal(await db.sourceLeadEvent.findUnique({ where: { id: `${PREFIX}-evt-blocked` } }), null);

    const released = await db.sourceLeadEvent.create({
      data: {
        id: `${PREFIX}-evt-after-lock`,
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        status: "received",
        rawPayloadJson: { id: "after-lock" },
      },
    });
    assert.ok(released.id);
    const triggers = await db.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname::text
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname LIKE 'historical_catalog_projection_%'
      ORDER BY tgname
    `;
    assert.deepEqual(
      triggers.map((row) => row.tgname),
      [
        "historical_catalog_projection_event_refresh",
        "historical_catalog_projection_item_refresh",
        "historical_catalog_projection_lot_refresh",
      ],
    );
  });

  it("rejects an incompressible long label in the old covering index and accepts a lot-key index", async () => {
    const probe = "historical_catalog_projection_index_probe";
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${probe}`);
    await db.$executeRawUnsafe(`
      CREATE TABLE ${probe} (
        item_id text PRIMARY KEY,
        lot_key text NOT NULL,
        import_request text NOT NULL,
        niche_key text NOT NULL,
        item_status text NOT NULL,
        origin_id text,
        july_label text,
        normalized_label text,
        label_agreement text NOT NULL
      )
    `);
    try {
      await db.$executeRawUnsafe(`
        INSERT INTO ${probe}
        SELECT
          'wide',
          'lot-key',
          'import',
          'vet',
          'available',
          'origin',
          left(string_agg(encode(gen_random_bytes(1000), 'base64'), ''), 2704),
          'short',
          'july_column_only'
        FROM generate_series(1, 4)
      `);
      await assert.rejects(
        db.$executeRawUnsafe(`
          CREATE INDEX ${probe}_cover
          ON ${probe} (lot_key)
          INCLUDE (
            import_request, niche_key, item_status, origin_id,
            july_label, normalized_label, label_agreement
          )
        `),
        /54000|index row size/i,
      );
      await db.$executeRawUnsafe(`CREATE INDEX ${probe}_lot ON ${probe} (lot_key)`);
      await db.$executeRawUnsafe(`DROP INDEX ${probe}_lot`);
      await db.$executeRawUnsafe(`
        CREATE INDEX CONCURRENTLY ${probe}_lot_concurrent
        ON ${probe} (lot_key)
      `);
      const indexes = await db.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname::text
        FROM pg_indexes
        WHERE tablename = ${probe} AND indexname = ${`${probe}_lot_concurrent`}
      `;
      assert.equal(indexes.length, 1);
    } finally {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS ${probe}`);
    }
  });

  it("rolls a lock-timed-out predeploy back without partial objects", { timeout: 300_000 }, async () => {
    const scratchUrl = localDatabaseUrl(scratchDatabase);
    const adminUrl = localDatabaseUrl("sa360");
    terminateClients(adminUrl, scratchDatabase);
    psql(adminUrl, `DROP DATABASE IF EXISTS ${scratchDatabase};`);
    psql(adminUrl, `CREATE DATABASE ${scratchDatabase};`);

    const firstDeploy = command(["pnpm", "migrate:deploy"], scratchUrl);
    assert.equal(firstDeploy.status, 0, firstDeploy.output);
    const secondDeploy = command(["pnpm", "migrate:deploy"], scratchUrl);
    assert.equal(secondDeploy.status, 0, secondDeploy.output);
    assert.match(secondDeploy.output, /No pending migrations|already in sync|0 migrations/i);
    assert.match(
      psql(scratchUrl, `SELECT ready::text FROM historical_catalog_projection_control`),
      /f/,
    );
    assert.match(
      psql(scratchUrl, `SELECT count(*) FROM historical_catalog_projection`),
      /\n\s*0\s*\n/,
    );
    assert.match(
      psql(scratchUrl, `SELECT count(*) FROM "SourceLeadEvent"`),
      /\n\s*0\s*\n/,
    );

    psql(
      scratchUrl,
      `
      DROP TRIGGER historical_catalog_projection_item_refresh ON "LeadInventoryItem";
      DROP TRIGGER historical_catalog_projection_event_refresh ON "SourceLeadEvent";
      DROP TRIGGER historical_catalog_projection_lot_refresh ON "InventoryLot";
      DROP PROCEDURE historical_catalog_projection_backfill_chunk(text, text);
      DROP FUNCTION historical_catalog_projection_diff(text, text, integer);
      DROP FUNCTION historical_catalog_projection_item_trg();
      DROP FUNCTION historical_catalog_projection_event_trg();
      DROP FUNCTION historical_catalog_projection_lot_trg();
      DROP FUNCTION historical_catalog_projection_refresh_item(text);
      DROP VIEW historical_catalog_projection_source;
      DROP TABLE historical_catalog_projection;
      DROP TABLE historical_catalog_projection_control;
      DELETE FROM "_prisma_migrations" WHERE migration_name = '${migrationName}';
      `,
    );

    const locker = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
    let releaseLock: () => void = () => undefined;
    const lockMayFinish = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockHeld: () => void = () => undefined;
    const lockIsHeld = new Promise<void>((resolve) => {
      lockHeld = resolve;
    });
    const lockTransaction = locker.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "SourceLeadEvent" IN SHARE MODE`;
        lockHeld();
        await lockMayFinish;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    let failedDeploy: { status: number | null; output: string } = { status: null, output: "" };
    let elapsedMs = 0;
    try {
      const lockGate = await Promise.race([
        lockIsHeld.then(() => "held" as const),
        lockTransaction.then(() => "finished" as const, () => "failed" as const),
      ]);
      if (lockGate !== "held") {
        await lockTransaction;
        throw new Error("lock transaction finished before the deploy started");
      }
      const started = Date.now();
      failedDeploy = command(["pnpm", "migrate:deploy"], scratchUrl);
      elapsedMs = Date.now() - started;
    } finally {
      releaseLock();
      await lockTransaction.catch(() => undefined);
      await locker.$disconnect().catch(() => undefined);
    }

    assert.notEqual(failedDeploy.status, 0, failedDeploy.output);
    assert.match(failedDeploy.output, /lock timeout|55P03/i);
    assert.ok(elapsedMs >= 2_500, `expected the 3s lock timeout, deploy failed in ${elapsedMs}ms`);
    assert.ok(elapsedMs < 15_000, `deploy waited ${elapsedMs}ms, past the lock timeout`);
    assert.match(
      psql(
        scratchUrl,
        `SELECT COALESCE(to_regclass('public.historical_catalog_projection')::text, 'absent')`,
      ),
      /absent/,
    );
    assert.match(
      psql(
        scratchUrl,
        `SELECT COALESCE(to_regclass('public.historical_catalog_projection_control')::text, 'absent')`,
      ),
      /absent/,
    );
    assert.match(
      psql(
        scratchUrl,
        `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'historical_catalog_projection_%'`,
      ),
      /\n\s*0\s*\n/,
    );
    assert.match(
      psql(
        scratchUrl,
        `SELECT count(*) FROM pg_proc WHERE proname LIKE 'historical_catalog_projection_%'`,
      ),
      /\n\s*0\s*\n/,
    );

    const resolved = command(
      ["pnpm", "exec", "prisma", "migrate", "resolve", "--rolled-back", migrationName],
      scratchUrl,
    );
    assert.equal(resolved.status, 0, resolved.output);
    const recovered = command(["pnpm", "migrate:deploy"], scratchUrl);
    assert.equal(recovered.status, 0, recovered.output);
    assert.match(
      psql(scratchUrl, `SELECT ready::text FROM historical_catalog_projection_control`),
      /f/,
    );
    assert.match(
      psql(
        scratchUrl,
        `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'historical_catalog_projection_%'`,
      ),
      /\n\s*3\s*\n/,
    );
  });
});
