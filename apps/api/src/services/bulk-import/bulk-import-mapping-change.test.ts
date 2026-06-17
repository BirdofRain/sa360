import assert from "node:assert/strict";
import test from "node:test";
import {
  BULK_IMPORT_IGNORE_COLUMN,
  BULK_IMPORT_UNMAPPED_COLUMN,
} from "./bulk-import.types.js";
import {
  importFieldMappingsEqual,
  normalizeImportFieldMappingForComparison,
  summarizeImportMappingChanges,
} from "./csv-import-mapping.service.js";
import { MappingChangeRequiresResetError } from "./bulk-import-mapping-change.js";

test("normalizeImportFieldMappingForComparison fills missing columns with preserve", () => {
  const normalized = normalizeImportFieldMappingForComparison(
    { phone: "phone" },
    ["phone", "email"]
  );
  assert.equal(normalized.phone, "phone");
  assert.equal(normalized.email, BULK_IMPORT_UNMAPPED_COLUMN);
});

test("importFieldMappingsEqual ignores key order", () => {
  const a = { phone: "phone", email: BULK_IMPORT_UNMAPPED_COLUMN };
  const b = { email: "__unmapped__", phone: "phone" };
  assert.equal(importFieldMappingsEqual(a, b, ["phone", "email"]), true);
});

test("summarizeImportMappingChanges counts remapped columns", () => {
  const summary = summarizeImportMappingChanges(
    { phone: "phone", notes: BULK_IMPORT_UNMAPPED_COLUMN },
    { phone: "phone", notes: "notes" },
    ["phone", "notes"]
  );
  assert.equal(summary.remappedColumns, 1);
});

test("MappingChangeRequiresResetError carries impact payload", () => {
  const err = new MappingChangeRequiresResetError({
    mappingChanged: true,
    resetRequired: true,
    sourceLeadEventsToRemove: 3,
    simulationArtifactsToRemove: 2,
    deliveredRows: 0,
    destinationWillBePreserved: true,
  });
  assert.equal(err.message, "mapping_change_requires_reset");
  assert.equal(err.impact.sourceLeadEventsToRemove, 3);
});

test("importFieldMappingsEqual treats ignore and preserve distinctly", () => {
  const a = { col: BULK_IMPORT_IGNORE_COLUMN };
  const b = { col: BULK_IMPORT_UNMAPPED_COLUMN };
  assert.equal(importFieldMappingsEqual(a, b, ["col"]), false);
});
