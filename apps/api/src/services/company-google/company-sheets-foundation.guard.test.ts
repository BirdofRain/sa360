import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getExecutionAdapter } from "../fulfillment-execution/execution-adapter.registry.js";
import { getDeliveryAdapter } from "../fulfillment-shadow/delivery-adapter.registry.js";

const here = dirname(fileURLToPath(import.meta.url));

test("company sheets migration is additive and does not rewrite delivery or intake tables", () => {
  const sql = readFileSync(
    join(here, "../../../../../prisma/migrations/20261020183000_company_google_sheets_foundation/migration.sql"),
    "utf8"
  );
  assert.match(sql, /CREATE TABLE "CompanyGoogleConnection"/);
  assert.match(sql, /CREATE TABLE "CompanySheetsDestination"/);
  assert.match(sql, /CompanyGoogleConnection_googleUserId_active_key/);
  assert.equal(/ALTER TABLE "(DeliveryTarget|LeadOrder|LeadAllocation|SourceLeadEvent|GoogleAccountConnection)"/.test(sql), false);
  assert.equal(sql.includes("DROP "), false);
});

test("company sheets foundation does not append rows, enqueue jobs, or deliver live", () => {
  const files = readdirSync(here).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
  for (const name of files) {
    const source = readFileSync(join(here, name), "utf8");
    assert.equal(source.includes("values:append"), false, name);
    assert.equal(source.includes("spreadsheets.values"), false, name);
    assert.equal(source.includes("bullmq"), false, name);
    assert.equal(source.includes("deliverLive"), false, name);
    assert.equal(source.includes("LeadAllocation"), false, name);
    assert.equal(source.includes("LeadOrder"), false, name);
    assert.equal(source.includes("permissions.create"), false, name);
    assert.equal(source.includes("type=anyone"), false, name);
  }
  assert.equal(getExecutionAdapter("google_sheets.company.v1"), null);
  const shadow = getDeliveryAdapter("google_sheets.company.v1");
  assert.ok(shadow);
  const validation = shadow.validateTarget({ configMetadata: { spreadsheetId: "abc", worksheetId: 0 } });
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "google_sheets_live_delivery_not_enabled");
});
