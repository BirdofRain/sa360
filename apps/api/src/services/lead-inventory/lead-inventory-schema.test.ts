import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const schema = readFileSync(new URL("../../../../../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(
    "../../../../../prisma/migrations/20260715120000_lead_inventory_foundation_v1/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("LeadInventoryItem has no PII columns", () => {
  const block = schema.slice(schema.indexOf("model LeadInventoryItem"));
  const end = block.indexOf("\nmodel ", 1);
  const model = end === -1 ? block : block.slice(0, end);
  const forbidden = ["email", "phone", "firstName", "lastName", "address", "ipAddress", "userAgent"];
  for (const field of forbidden) {
    assert.equal(model.includes(`${field} `), false, `unexpected PII field ${field}`);
  }
});

test("LeadInventoryItem has additive indexed consumer fingerprints", () => {
  assert.match(schema, /phoneFingerprint\s+String\?/);
  assert.match(schema, /emailFingerprint\s+String\?/);
  assert.match(schema, /@@index\(\[phoneFingerprint\]\)/);
  assert.match(schema, /@@index\(\[emailFingerprint\]\)/);
});

test("LeadInventoryItem enforces one item per SourceLeadEvent", () => {
  assert.match(schema, /sourceLeadEventId\s+String\s+@unique/);
});

test("LeadAllocation allows multiple historical inventory links", () => {
  const block = schema.slice(schema.indexOf("model LeadAllocation"));
  assert.match(block, /leadOrderLineId\s+String\?/);
  assert.match(block, /leadInventoryItemId\s+String\?/);
  assert.equal(block.includes("@@unique([leadInventoryItemId])"), false);
  assert.match(block, /@@index\(\[leadInventoryItemId\]\)/);
  assert.equal(migration.includes('CREATE UNIQUE INDEX "LeadAllocation_leadInventoryItemId_key"'), false);
});

test("inventory migration includes integrity CHECK constraints", () => {
  assert.match(migration, /LeadInventoryItem_maxFulfillments_positive_chk/);
  assert.match(migration, /LeadOrderLine_reserved_within_requested_chk/);
  assert.match(migration, /LeadAgeBandDefinition_maxDaysExclusive_gt_min_chk/);
});

test("facets supply snapshot schema is additive with partition checks", () => {
  assert.match(schema, /model LeadInventoryFacetBuild/);
  assert.match(schema, /model LeadInventoryFacetSupplyAggregate/);
  assert.match(schema, /enum LeadInventoryFacetBuildStatus/);

  const snapshotMigration = readFileSync(
    new URL(
      "../../../../../prisma/migrations/20260810200000_lead_inventory_facet_supply_snapshot_v1/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(snapshotMigration, /CREATE TABLE "LeadInventoryFacetBuild"/);
  assert.match(snapshotMigration, /CREATE TABLE "LeadInventoryFacetSupplyAggregate"/);
  assert.match(snapshotMigration, /LeadInventoryFacetSupplyAggregate_partition_chk/);
  assert.match(snapshotMigration, /LeadInventoryFacetBuild_one_active_per_version_key/);
  assert.match(snapshotMigration, /WHERE status = 'active'/);
  assert.equal(snapshotMigration.includes("DROP TABLE"), false);
  assert.equal(snapshotMigration.includes('"LeadInventoryItem"'), false);
});
