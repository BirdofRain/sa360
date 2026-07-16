import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./lead-inventory-review-queue.tsx", import.meta.url), "utf8");

test("review queue shows disabled banner copy and no auto-retry", () => {
  assert.match(source, /Review activation is disabled/);
  assert.match(source, /no auto-retry/i);
  assert.match(source, /LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION/);
  assert.match(source, /LEAD_INVENTORY_REVIEW_QUARANTINE_CONFIRMATION/);
  assert.match(source, /LEAD_INVENTORY_REVIEW_REJECT_CONFIRMATION/);
  assert.match(source, /Recover by requestId/);
});

test("review queue preserves PII boundaries in UI columns", () => {
  assert.doesNotMatch(source, /contact name/i);
  assert.doesNotMatch(source, /\bemail\b.*column/i);
  assert.doesNotMatch(source, /street address/i);
});
