/**
 * Local disposable benchmark for facets supply snapshot rebuild + lookup.
 *
 * Safety:
 * - Requires DATABASE_URL host to be localhost/127.0.0.1
 *
 * Usage (from repo root):
 *   $env:DATABASE_URL="postgresql://sa360:<local-password>@127.0.0.1:5432/sa360_facets_snapshot_bench"
 *   pnpm --filter @sa360/api exec tsx src/scripts/facet-snapshot-local-benchmark.ts
 */

import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readActiveFacetSnapshotSupply,
  rebuildLeadInventoryFacetSupplySnapshot,
} from "../services/lead-inventory/lead-inventory-facet-snapshot.service.js";

const TARGET_ITEMS = Number(process.env.FACET_SNAPSHOT_BENCH_ITEMS ?? 243_056);
const ADMIN_URL = process.env.SA360_API_INTERNAL_URL?.trim() || "http://127.0.0.1:3001";

function assertLocalDatabaseUrl(url: string): URL {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`refusing_non_local_database:${host}`);
  }
  return parsed;
}

function repoRootFromScript(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../");
}

async function measureLookup(
  db: PrismaClient,
  label: string,
  filters: Parameters<typeof readActiveFacetSnapshotSupply>[0]
) {
  const started = Date.now();
  const result = await readActiveFacetSnapshotSupply(filters, db);
  const ms = Date.now() - started;
  if (!result.ok) {
    console.log(JSON.stringify({ lookup: label, ok: false, reason: result.reason, wallMs: ms }));
    return;
  }
  console.log(
    JSON.stringify({
      lookup: label,
      ok: true,
      wallMs: ms,
      queryDurationMs: result.queryDurationMs,
      rows: result.rows.length,
      inventoryCount: result.inventoryCount,
      aggregateRowCount: result.aggregateRowCount,
    })
  );
}

async function probeHealthDuringRebuild<T>(rebuildPromise: Promise<T>): Promise<{
  result: T;
  health: {
    attempted: number;
    successful: number;
    failed: number;
    maxLatencyMs: number;
    apiReachable: boolean;
  };
}> {
  const probes: Array<{ path: string; ok: boolean; ms: number }> = [];
  let stop = false;
  let apiReachable = false;
  const loop = (async () => {
    while (!stop) {
      for (const pathName of ["/health", "/health/db", "/health/queue"]) {
        const started = Date.now();
        try {
          const res = await fetch(`${ADMIN_URL}${pathName}`, { signal: AbortSignal.timeout(2_000) });
          const ok = res.ok;
          if (ok) apiReachable = true;
          probes.push({ path: pathName, ok, ms: Date.now() - started });
        } catch {
          probes.push({ path: pathName, ok: false, ms: Date.now() - started });
        }
      }
      await sleep(500);
    }
  })();

  const result = await rebuildPromise;
  stop = true;
  await loop;

  const successful = probes.filter((p) => p.ok).length;
  return {
    result,
    health: {
      attempted: probes.length,
      successful,
      failed: probes.length - successful,
      maxLatencyMs: probes.reduce((m, p) => Math.max(m, p.ms), 0),
      apiReachable,
    },
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const parsed = assertLocalDatabaseUrl(databaseUrl);
  const dbName = parsed.pathname.replace(/^\//, "") || "sa360_facets_snapshot_bench";
  const root = repoRootFromScript();

  console.log(JSON.stringify({ phase: "migrate", database: dbName, root }));
  execSync("pnpm prisma migrate deploy", {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });

  const db = new PrismaClient();
  try {
    const bandCount = await db.leadAgeBandDefinition.count({ where: { version: "v1", active: true } });
    if (bandCount === 0) throw new Error("age_bands_missing_after_migrate");

    const existingItems = await db.leadInventoryItem.count();
    if (existingItems < TARGET_ITEMS) {
      console.log(JSON.stringify({ phase: "seed", existingItems, target: TARGET_ITEMS }));

      await db.$executeRawUnsafe(`
        INSERT INTO "InventoryLot" (
          id, "lotKey", "displayName", "sourceProvider", "sourceLane", "nicheKey",
          "inventoryClass", "exclusivityMode", status, "createdAt", "updatedAt"
        )
        VALUES
          ('lot_vet_bench', 'lot_vet_bench', 'Vet Bench Lot', 'manual_import', 'aged_inventory_bulk_csv', 'vet',
           'aged', 'configurable', 'active', NOW(), NOW()),
          ('lot_truck_bench', 'lot_truck_bench', 'Truck Bench Lot', 'manual_import', 'aged_inventory_bulk_csv', 'trucker',
           'aged', 'configurable', 'active', NOW(), NOW())
        ON CONFLICT ("lotKey") DO NOTHING;
      `);

      // Seed in batches to keep memory/WAL bounded.
      const batchSize = 20_000;
      for (let start = existingItems + 1; start <= TARGET_ITEMS; start += batchSize) {
        const end = Math.min(TARGET_ITEMS, start + batchSize - 1);
        console.log(JSON.stringify({ phase: "seed_batch", start, end }));

        await db.$executeRawUnsafe(`
          INSERT INTO "SourceLeadEvent" (
            id, "sourceProvider", "sourceSystem", "sourceType", "sourceLeadUid",
            "rawPayloadJson", "receivedAt", "createdAt", "updatedAt"
          )
          SELECT
            'sle_bench_' || g.i,
            'manual_import',
            'csv_import',
            'bulk_import',
            'uid_bench_' || g.i,
            '{}'::jsonb,
            NOW() - ((g.i % 400) || ' days')::interval,
            NOW(),
            NOW()
          FROM generate_series(${start}, ${end}) AS g(i)
          ON CONFLICT (id) DO NOTHING;
        `);

        await db.$executeRawUnsafe(`
          INSERT INTO "LeadInventoryItem" (
            id, "inventoryLotId", "sourceLeadEventId", "generatedAt", "normalizedState",
            "nicheKey", "productType", "sourceProvider", "sourceLane", "inventoryClass",
            "exclusivityMode", status, "availableAt", "maxFulfillments", "fulfillmentCount",
            "createdAt", "updatedAt"
          )
          SELECT
            'lii_bench_' || g.i,
            CASE WHEN g.i % 9 = 0 THEN 'lot_truck_bench' ELSE 'lot_vet_bench' END,
            'sle_bench_' || g.i,
            NOW() - ((g.i % 400) || ' days')::interval,
            CASE (g.i % 51)
              WHEN 0 THEN 'NC' WHEN 1 THEN 'SC' WHEN 2 THEN 'VA' WHEN 3 THEN 'GA' WHEN 4 THEN 'FL'
              WHEN 5 THEN 'TX' WHEN 6 THEN 'CA' WHEN 7 THEN 'NY' WHEN 8 THEN 'OH' WHEN 9 THEN 'PA'
              ELSE 'S' || ((g.i % 41) + 10)::text
            END,
            CASE WHEN g.i % 9 = 0 THEN 'trucker' ELSE 'vet' END,
            NULL,
            'manual_import',
            'aged_inventory_bulk_csv',
            'aged',
            'configurable',
            'available',
            NOW() - ((g.i % 400) || ' days')::interval,
            1,
            0,
            NOW(),
            NOW()
          FROM generate_series(${start}, ${end}) AS g(i)
          ON CONFLICT (id) DO NOTHING;
        `);

        await db.$executeRawUnsafe(`
          INSERT INTO "LeadVerificationResult" (
            id, "leadUid", "verificationStatus", "duplicateStatus", "createdAt", "updatedAt"
          )
          SELECT
            'lvr_bench_' || g.i,
            'uid_bench_' || g.i,
            'PASSED',
            'UNIQUE',
            NOW(),
            NOW()
          FROM generate_series(${start}, ${end}) AS g(i)
          ON CONFLICT ("leadUid") DO NOTHING;
        `);
      }
    } else {
      console.log(JSON.stringify({ phase: "seed_skip", existingItems }));
    }

    const inventoryCount = await db.leadInventoryItem.count();
    console.log(JSON.stringify({ phase: "rebuild_start", inventoryCount }));

    const { result: rebuild, health } = await probeHealthDuringRebuild(
      rebuildLeadInventoryFacetSupplySnapshot({
        ageBandVersion: "v1",
        db,
        skipIfLocked: false,
      })
    );
    console.log(JSON.stringify({ phase: "rebuild_result", rebuild }));
    console.log(JSON.stringify({ phase: "health_during_rebuild", health }));

    const sizes = await db.$queryRaw<
      Array<{ relation: string; total_bytes: bigint; table_bytes: bigint; index_bytes: bigint }>
    >`
      SELECT
        c.relname AS relation,
        pg_total_relation_size(c.oid)::bigint AS total_bytes,
        pg_relation_size(c.oid)::bigint AS table_bytes,
        pg_indexes_size(c.oid)::bigint AS index_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('LeadInventoryFacetBuild', 'LeadInventoryFacetSupplyAggregate')
      ORDER BY c.relname
    `;
    console.log(
      JSON.stringify({
        phase: "table_sizes",
        sizes: sizes.map((s) => ({
          relation: s.relation,
          totalBytes: Number(s.total_bytes),
          tableBytes: Number(s.table_bytes),
          indexBytes: Number(s.index_bytes),
        })),
      })
    );

    const spill = await db.$queryRaw<Array<{ temp_files: bigint; temp_bytes: bigint }>>`
      SELECT
        COALESCE(SUM(temp_files), 0)::bigint AS temp_files,
        COALESCE(SUM(temp_bytes), 0)::bigint AS temp_bytes
      FROM pg_stat_database
      WHERE datname = current_database()
    `;
    console.log(
      JSON.stringify({
        phase: "temp_stats",
        tempFiles: Number(spill[0]?.temp_files ?? 0),
        tempBytes: Number(spill[0]?.temp_bytes ?? 0),
      })
    );

    await measureLookup(db, "unfiltered", {});
    await measureLookup(db, "niche_vet", { nicheKey: "vet" });
    await measureLookup(db, "lot_filtered", { lotId: "lot_vet_bench" });
    await measureLookup(db, "source_lane", { sourceLane: "aged_inventory_bulk_csv" });
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
