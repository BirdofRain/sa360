import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "../../../../..");
const migrationName = "20261022170000_historical_catalog_summary_schema_v1";
const migrationPath = join(repoRoot, "prisma/migrations", migrationName, "migration.sql");
const migrationSql = readFileSync(migrationPath, "utf8");
const schema = readFileSync(join(repoRoot, "prisma/schema.prisma"), "utf8");
const projectionMigration = readFileSync(
  join(repoRoot, "prisma/migrations/20261020200000_historical_catalog_projection_v1/migration.sql"),
  "utf8",
);
const catalogSource = readFileSync(
  join(repoRoot, "apps/api/src/services/ppl-fulfillment/historical-campaign-ownership-preview.ts"),
  "utf8",
);

const sqlStatements = migrationSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .trim();

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) found.push(path);
  }
  return found;
}

test("gate 11 migration is one transactional empty summary schema", () => {
  const statements = sqlStatements
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements[1], "SET LOCAL lock_timeout = '3s'");
  assert.equal(statements.at(-1), "COMMIT");
  assert.equal(statements.filter((part) => part === "BEGIN").length, 1);
  assert.equal(statements.filter((part) => part === "COMMIT").length, 1);
  assert.equal(statements.filter((part) => part === "ROLLBACK").length, 0);
  assert.equal(
    migrationSql.split("\n").some((line) => /^\s*CALL\s/i.test(line)),
    false,
  );
  assert.doesNotMatch(migrationSql, /\bCREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER|VIEW)\b/i);
  assert.doesNotMatch(migrationSql, /\bDROP\s+(TABLE|INDEX|FUNCTION|TRIGGER|TYPE|CONSTRAINT|SCHEMA)\b/i);
  assert.doesNotMatch(migrationSql, /\bALTER\s+TABLE\s+"?(LeadInventoryItem|SourceLeadEvent|InventoryLot|historical_catalog_projection)/i);
  assert.equal(
    sqlStatements.split("\n").some((line) => /^\s*UPDATE\b/i.test(line)),
    false,
  );
  assert.doesNotMatch(migrationSql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migrationSql, /SA360_HISTORICAL_CAMPAIGN_/);
  assert.doesNotMatch(migrationSql, /summary_ready\s*=\s*true/i);
  assert.match(migrationSql, /UNIQUE NULLS NOT DISTINCT/);
  assert.match(migrationSql, /historical_catalog_summary_bucket_grain/);
  assert.match(migrationSql, /CHECK \("n" >= 0\)/);
  assert.match(migrationSql, /CHECK \("accounted" = \("bucket_id" IS NOT NULL\)\)/);
  assert.match(migrationSql, /CHECK \("singleton"\)/);
  assert.match(migrationSql, /CHECK \("status" IN \('running', 'complete', 'failed'\)\)/);
  assert.match(migrationSql, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
  assert.equal(migrationSql.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g)?.length, 2);
  assert.equal(migrationSql.match(/^CREATE INDEX /gm)?.length, 6);
  assert.doesNotMatch(migrationSql, /CREATE UNIQUE INDEX "[^"]*label_hash/i);
  assert.doesNotMatch(migrationSql, /UNIQUE \("label_hash"\)/i);
  assert.match(
    migrationSql,
    /INSERT INTO "historical_catalog_summary_control" \("singleton", "summary_ready", "note"\)/,
  );
  assert.match(migrationSql, /true,\n  false,/);
  assert.doesNotMatch(migrationSql, /rawPayloadJson|normalizedPayloadJson/);
});

test("prisma schema maps the summary tables and leaves the projection contract intact", () => {
  for (const model of [
    "model HistoricalCatalogSummaryLabel {",
    "model HistoricalCatalogSummaryBucket {",
    "model HistoricalCatalogSummaryMembership {",
    "model HistoricalCatalogSummaryControl {",
    "model HistoricalCatalogSummaryCheckpoint {",
  ]) {
    assert.match(schema, new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(schema, /summaryReady\s+Boolean\s+@default\(false\)\s+@map\("summary_ready"\)/);
  assert.match(schema, /reconciledEpoch\s+BigInt\?\s+@map\("reconciled_epoch"\)/);
  assert.match(schema, /reconciledAt\s+DateTime\?\s+@map\("reconciled_at"\)\s+@db\.Timestamptz\(6\)/);
  assert.match(schema, /map: "historical_catalog_summary_bucket_grain"/);
  assert.match(schema, /map: "historical_catalog_summary_label_hash"/);
  assert.match(schema, /onDelete: Restrict, onUpdate: Restrict/);
  assert.match(schema, /model HistoricalCatalogProjection \{/);
  assert.match(schema, /model HistoricalCatalogProjectionControl \{/);
  assert.match(schema, /ready\s+Boolean\s+@default\(false\)/);
  assert.match(projectionMigration, /CREATE TRIGGER historical_catalog_projection_item_refresh/);
  assert.match(projectionMigration, /CREATE TRIGGER historical_catalog_projection_event_refresh/);
  assert.match(projectionMigration, /CREATE TRIGGER historical_catalog_projection_lot_refresh/);
  assert.doesNotMatch(catalogSource, /historical_catalog_summary_/);
  assert.doesNotMatch(catalogSource, /SA360_HISTORICAL_CAMPAIGN_SUMMARY_READ_ENABLED/);
});

test("application code does not read or maintain the summary", () => {
  const roots = [
    join(repoRoot, "apps/api/src"),
    join(repoRoot, "apps/worker/src"),
    join(repoRoot, "apps/admin-coc/src"),
    join(repoRoot, "packages/shared/src"),
  ];
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (file.endsWith("historical-catalog-summary-schema.migration.test.ts")) continue;
      if (file.endsWith("historical-catalog-summary-schema.integration.test.ts")) continue;
      // Gate 12 proof runs only against disposable databases. It is not a reader.
      if (file.includes("historical-catalog-summary-maintenance.")) continue;
      const source = readFileSync(file, "utf8");
      if (source.includes("historical_catalog_summary_")) offenders.push(file);
      if (source.includes("SA360_HISTORICAL_CAMPAIGN_SUMMARY_READ_ENABLED")) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});
