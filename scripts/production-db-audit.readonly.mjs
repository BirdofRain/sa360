import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "prisma", "migrations");

function loadRepoMigrationNames() {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function parseExpectedPendingMigrations() {
  const raw = process.env.EXPECTED_PENDING_MIGRATIONS?.trim();
  if (!raw) return null;
  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

function maskDbUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || "5432",
      database: u.pathname.replace(/^\//, ""),
      user: u.username ? `${u.username.slice(0, 3)}***` : null,
      ssl: u.searchParams.get("sslmode") ?? u.search.includes("sslmode") ? "configured" : "unknown",
    };
  } catch {
    return { host: "unparseable" };
  }
}

function sanitizeMigrationRow(row) {
  const { logs, ...rest } = row;
  return {
    ...rest,
    hasLogs: logs != null && String(logs).length > 0,
  };
}

const db = new PrismaClient();

try {
  const repoMigrations = loadRepoMigrationNames();
  const expectedPending = parseExpectedPendingMigrations();

  const migrations = await db.$queryRaw`
    SELECT migration_name, started_at, finished_at, applied_steps_count, logs, rolled_back_at
    FROM _prisma_migrations
    ORDER BY started_at ASC NULLS LAST, migration_name ASC
  `;

  const failed = migrations.filter(
    (m) => m.rolled_back_at != null || (m.started_at && !m.finished_at)
  );
  const unfinished = migrations.filter((m) => m.started_at && !m.finished_at);

  const lf2Tables = [
    "LeadEligibilityAssessment",
    "LeadAllocation",
    "DeliveryTarget",
    "DeliveryInstruction",
    "FulfillmentOutbox",
    "DeliveryAttempt",
  ];

  const tableCheck = await db.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${lf2Tables})
    ORDER BY table_name
  `;

  const leadOrderCount = await db.$queryRaw`SELECT COUNT(*)::int AS count FROM "LeadOrder"`;
  const leadOrders = await db.$queryRaw`
    SELECT id,
           "orderNumber",
           status,
           "createdAt",
           "updatedAt",
           "requestedQuantity",
           "reservedQuantity",
           "fulfilledQuantity",
           "proposedQuantity"
    FROM "LeadOrder"
    ORDER BY "createdAt" DESC
    LIMIT 5
  `;

  const leadOrderCols = await db.$queryRaw`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'LeadOrder'
    ORDER BY ordinal_position
  `;

  const destCols = await db.$queryRaw`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ClientGhlDestination'
      AND column_name IN ('sa360CustomFieldOptionMapJson', 'destinationSubaccountIdGhl', 'deliveryMode', 'deliveryEnabled')
    ORDER BY column_name
  `;

  const dbSize = await db.$queryRaw`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
           current_database() AS database_name
  `;

  const connections = await db.$queryRaw`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE state = 'active')::int AS active,
           count(*) FILTER (WHERE state = 'idle')::int AS idle,
           count(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting
    FROM pg_stat_activity
    WHERE datname = current_database()
  `;

  const longQueries = await db.$queryRaw`
    SELECT pid,
           usename,
           state,
           wait_event_type,
           wait_event,
           now() - query_start AS duration
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
    ORDER BY query_start ASC
    LIMIT 10
  `;

  const locks = await db.$queryRaw`
    SELECT l.locktype, l.mode, c.relname AS relation, l.granted, count(*)::int AS count
    FROM pg_locks l
    LEFT JOIN pg_class c ON c.oid = l.relation
    WHERE l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
    GROUP BY l.locktype, l.mode, c.relname, l.granted
    ORDER BY count DESC
    LIMIT 15
  `;

  const appliedNames = new Set(migrations.map((m) => m.migration_name));
  const pendingFromLedger = repoMigrations.filter((name) => !appliedNames.has(name));
  const unexpectedApplied = [...appliedNames].filter((name) => !repoMigrations.includes(name));

  let pendingMatchesExpected;
  if (expectedPending) {
    pendingMatchesExpected =
      pendingFromLedger.length === expectedPending.size &&
      pendingFromLedger.every((name) => expectedPending.has(name));
  } else {
    pendingMatchesExpected = pendingFromLedger.length === 0;
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        database: maskDbUrl(process.env.DATABASE_URL),
        dbSize: dbSize[0],
        migrationSummary: {
          appliedCount: migrations.length,
          repoTotal: repoMigrations.length,
          expectedPendingMigrations: expectedPending ? [...expectedPending].sort() : null,
          pendingFromLedger,
          pendingMatchesExpected,
          failedCount: failed.length,
          unfinishedCount: unfinished.length,
          unexpectedApplied,
        },
        migrations: migrations.map(sanitizeMigrationRow),
        failed: failed.map(sanitizeMigrationRow),
        unfinished: unfinished.map(sanitizeMigrationRow),
        lf2TablesFound: tableCheck,
        leadOrderCount: leadOrderCount[0]?.count,
        leadOrders,
        leadOrderFulfillmentColumns: leadOrderCols.filter((c) =>
          ["orderKind", "requestedQuantity", "reservedQuantity", "fulfilledQuantity"].includes(
            c.column_name
          )
        ),
        clientGhlDestinationKeyColumns: destCols,
        connections: connections[0],
        longQueries,
        locks,
      },
      null,
      2
    )
  );
} finally {
  await db.$disconnect();
}
