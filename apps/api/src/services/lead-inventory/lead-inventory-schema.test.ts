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
