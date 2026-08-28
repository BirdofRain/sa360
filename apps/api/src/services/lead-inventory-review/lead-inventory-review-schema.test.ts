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

test("exactly 71 migrations and prior aged migration unchanged", () => {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.equal(dirs.length, 71);
  assert.ok(dirs.includes("20260715140000_aged_lead_inventory_ingestion_v1"));
  assert.ok(dirs.includes("20260716180000_lead_inventory_review_activation_v1"));
  assert.ok(dirs.includes("20260727180000_ppl_aged_inventory_selection_v1"));
  assert.ok(dirs.includes("20260727190000_ppl_buyer_csv_export_v1"));
  assert.ok(dirs.includes("20260727200000_ppl_duplicate_replacement_v1"));
  assert.ok(dirs.includes("20260728120000_ppl_spreadsheet_delivery_recorded_v1"));
  assert.ok(dirs.includes("20260729180000_aged_inventory_bulk_import_v1"));
  assert.ok(dirs.includes("20260729190000_aged_inventory_ops_verify_v1"));
  assert.ok(dirs.includes("20260810200000_lead_inventory_facet_supply_snapshot_v1"));
  assert.ok(dirs.includes("20260813120000_ppl_commercial_export_metadata_v1"));
  assert.ok(dirs.includes("20260817120000_campaign_inventory_identity_v1"));
  assert.ok(dirs.includes("20260817120100_campaign_inv_phone_fp_idx"));
  assert.ok(dirs.includes("20260817120700_source_event_norm_contact_email_idx"));
  assert.ok(dirs.includes("20260824160000_lead_inventory_commerce_exclusion_v1"));
  assert.ok(dirs.includes("20260827210000_lead_order_payment_confirmation_v1"));
  assert.ok(dirs.includes("20260828180000_delivery_release_customer_notify_v1"));
  const aged = readFileSync(
    new URL(
      "../../../../../prisma/migrations/20260715140000_aged_lead_inventory_ingestion_v1/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(aged, /LeadInventoryImportBatch/);
});
