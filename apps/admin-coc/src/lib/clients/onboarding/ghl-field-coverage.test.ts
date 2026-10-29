import assert from "node:assert/strict";
import test from "node:test";

import { classifyGhlFieldCoverage, resolveSavedFieldIds, savedFieldIds } from "./ghl-field-coverage.ts";

const FIELD_ID = "ghl_field_primary_reason";

test("a present value without a discovered id is a missing mapping", () => {
  const coverage = classifyGhlFieldCoverage({
    sourceAttributes: { primary_reason: "Family", age: "64" },
    mappings: { primary_reason: FIELD_ID },
    discoveredIds: new Set([FIELD_ID]),
  });
  assert.deepEqual(coverage.mapped, [{ key: "primary_reason", fieldId: FIELD_ID, sourceValue: "Family" }]);
  assert.deepEqual(coverage.missingMappings, [{ key: "age", fieldId: null, sourceValue: "64" }]);
  assert.deepEqual(coverage.missingSourceValues, []);
});

test("a mapped field with a blank source value is not called a missing mapping", () => {
  const coverage = classifyGhlFieldCoverage({
    sourceAttributes: { primary_reason: "  ", beneficiary: null },
    mappings: { primary_reason: FIELD_ID, beneficiary: "ghl_field_beneficiary" },
    discoveredIds: new Set([FIELD_ID, "ghl_field_beneficiary"]),
  });
  assert.deepEqual(coverage.mapped, []);
  assert.deepEqual(coverage.missingMappings, []);
  assert.deepEqual(
    coverage.missingSourceValues.map((row) => row.key).sort(),
    ["beneficiary", "primary_reason"]
  );
});

test("a stored field key resolves to the discovered field id", () => {
  const saved = savedFieldIds({
    primary_reason: { ghlFieldKey: "contact.primary_reason", requirement: "optional" },
  });
  const resolved = resolveSavedFieldIds(saved, [
    { id: FIELD_ID, fieldKey: "contact.primary_reason", key: "contact.primary_reason" },
  ]);
  assert.equal(resolved.primary_reason, FIELD_ID);
});
