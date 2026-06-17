import assert from "node:assert/strict";
import test from "node:test";
import {
  compareDraftMapping,
  MAPPING_IGNORE,
  MAPPING_UNMAPPED,
  normalizeMappingForComparison,
} from "./mapping-editor.ts";

test("normalizeMappingForComparison treats omitted columns as preserve", () => {
  const normalized = normalizeMappingForComparison({ phone: "phone" }, ["phone", "email"]);
  assert.equal(normalized.phone, "phone");
  assert.equal(normalized.email, MAPPING_UNMAPPED);
});

test("compareDraftMapping detects remapped columns", () => {
  const saved = { phone: "phone", email: MAPPING_UNMAPPED };
  const draft = { phone: "phone", email: "email" };
  const result = compareDraftMapping(saved, draft, ["phone", "email"]);
  assert.equal(result.mappingChanged, true);
  assert.equal(result.changeSummary.remappedColumns, 1);
});

test("compareDraftMapping is false for unchanged mapping", () => {
  const mapping = { phone: "phone", notes: MAPPING_IGNORE };
  const result = compareDraftMapping(mapping, { ...mapping }, ["phone", "notes"]);
  assert.equal(result.mappingChanged, false);
});

test("compareDraftMapping counts preserve and ignore transitions", () => {
  const saved = { a: "first_name", b: "email" };
  const draft = { a: MAPPING_UNMAPPED, b: MAPPING_IGNORE };
  const result = compareDraftMapping(saved, draft, ["a", "b"]);
  assert.equal(result.mappingChanged, true);
  assert.equal(result.changeSummary.toPreserveColumns, 1);
  assert.equal(result.changeSummary.toIgnoreColumns, 1);
});
