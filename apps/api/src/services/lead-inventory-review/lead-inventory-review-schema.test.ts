import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const schema = readFileSync(new URL("../../../../../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(
    "../../../../../prisma/migrations/20260716180000_lead_inventory_review_activation_v1/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const migrationsDir = new URL("../../../../../prisma/migrations/", import.meta.url);

test("rejected status and rejectedAt exist", () => {
  assert.match(schema, /enum LeadInventoryItemStatus/);
  assert.match(schema, /rejected/);
  assert.match(schema, /rejectedAt\s+DateTime\?/);
  assert.match(migration, /ADD VALUE 'rejected'/);
  assert.match(migration, /ADD COLUMN "rejectedAt"/);
});

test("review audit tables exist without contact PII columns", () => {
  assert.match(schema, /model LeadInventoryReviewAction/);
  assert.match(schema, /model LeadInventoryReviewItemResult/);
  const actionBlock = schema.slice(schema.indexOf("model LeadInventoryReviewAction"));
  const actionModel = actionBlock.slice(0, actionBlock.indexOf("\nmodel ", 1));
  for (const field of ["email", "phone", "firstName", "lastName", "ipAddress", "consentText"]) {
    assert.equal(actionModel.includes(`${field} `), false, field);
  }
  assert.match(migration, /CREATE TABLE "LeadInventoryReviewAction"/);
  assert.match(migration, /CREATE TABLE "LeadInventoryReviewItemResult"/);
});

test("review migration adds indexes and count constraints", () => {
  assert.match(migration, /LeadInventoryReviewAction_requestId_key/);
  assert.match(migration, /LeadInventoryReviewItemResult_reviewActionId_leadInventoryItemId_key/);
  assert.match(migration, /LeadInventoryReviewAction_requestedCount_nonneg/);
  assert.match(migration, /LeadInventoryItem_available_requires_availableAt/);
  assert.match(migration, /LeadInventoryItem_no_available_and_rejected_timestamps/);
});

test("exactly 52 migrations and prior aged migration unchanged", () => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.equal(dirs.length, 52);
  assert.ok(dirs.includes("20260715140000_aged_lead_inventory_ingestion_v1"));
  assert.ok(dirs.includes("20260716180000_lead_inventory_review_activation_v1"));
  const aged = readFileSync(
    new URL(
      "../../../../../prisma/migrations/20260715140000_aged_lead_inventory_ingestion_v1/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(aged, /LeadInventoryImportBatch/);
});
