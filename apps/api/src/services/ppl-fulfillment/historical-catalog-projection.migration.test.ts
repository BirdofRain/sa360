import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "../../../../..");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20261020200000_historical_catalog_projection_v1/migration.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");
const schema = readFileSync(join(repoRoot, "prisma/schema.prisma"), "utf8");
const catalogSource = readFileSync(
  join(repoRoot, "apps/api/src/services/ppl-fulfillment/historical-campaign-ownership-preview.ts"),
  "utf8",
);

test("gate 2 migration is one transactional empty projection", () => {
  const sqlStatements = migrationSql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
  assert.match(sqlStatements, /^SET LOCAL lock_timeout = '3s';/);
  assert.equal(
    migrationSql.split("\n").some((line) => line.trim() === "COMMIT;"),
    false,
  );
  assert.equal(
    migrationSql.split("\n").some((line) => /^\s*CALL\s/i.test(line)),
    false,
  );
  assert.doesNotMatch(migrationSql, /^\s*CREATE INDEX\b/im);
  assert.doesNotMatch(migrationSql, /ALTER TABLE "SourceLeadEvent"/);
  assert.doesNotMatch(migrationSql, /UPDATE "SourceLeadEvent"/);
  assert.doesNotMatch(migrationSql, /UPDATE "LeadInventoryItem"/);
  assert.doesNotMatch(migrationSql, /UPDATE "InventoryLot"/);
  assert.doesNotMatch(migrationSql, /SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED/);
  assert.match(migrationSql, /INSERT INTO historical_catalog_projection_control \(singleton, ready, note\)/);
  assert.match(migrationSql, /true,\n  false,/);
  assert.match(migrationSql, /CREATE TRIGGER historical_catalog_projection_item_refresh/);
  assert.match(migrationSql, /CREATE TRIGGER historical_catalog_projection_event_refresh/);
  assert.match(migrationSql, /CREATE TRIGGER historical_catalog_projection_lot_refresh/);
  assert.match(migrationSql, /WHERE historical_catalog_projection\.refreshed_at < EXCLUDED\.refreshed_at/);
  assert.match(migrationSql, /clock_timestamp\(\)/);
  assert.match(migrationSql, /EXECUTE FUNCTION historical_catalog_projection_item_trg\(\)/);
});

test("prisma schema represents the projection and the catalog keeps both read paths", () => {
  assert.match(schema, /model HistoricalCatalogProjection \{/);
  assert.match(schema, /model HistoricalCatalogProjectionControl \{/);
  assert.match(schema, /@@map\("historical_catalog_projection"\)/);
  assert.match(schema, /ready\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /refreshedAt\s+DateTime\s+@map\("refreshed_at"\)\s+@db\.Timestamptz\(6\)/);
  assert.match(schema, /verifiedAt\s+DateTime\?\s+@map\("verified_at"\)\s+@db\.Timestamptz\(6\)/);
  assert.doesNotMatch(schema, /model HistoricalCatalogProjection \{[\s\S]*@@index/m);
  assert.match(catalogSource, /HISTORICAL_CATALOG_STATEMENT_TIMEOUT_MS = 20_000/);
  assert.match(catalogSource, /"SourceLeadEvent"/);
  assert.match(catalogSource, /FROM historical_catalog_projection p/);
  assert.match(catalogSource, /FROM historical_catalog_projection_control/);
  assert.match(catalogSource, /rows\[0\]\?\.ready === false/);
  assert.match(catalogSource, /rows\[0\]\?\.ready === true/);
  assert.doesNotMatch(catalogSource, /UPDATE\s+historical_catalog_projection_control/i);
  assert.doesNotMatch(catalogSource, /SET\s+ready\s*=\s*true/i);
});
