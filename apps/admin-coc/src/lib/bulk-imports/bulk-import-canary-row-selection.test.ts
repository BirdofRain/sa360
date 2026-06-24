import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSelectedCanaryRowId,
  nextUndeliveredCanaryRowId,
  resolveBulkImportCanaryRowStatus,
} from "./bulk-import-canary-row-selection.ts";
import type { BulkImportReviewRow } from "@/components/bulk-imports/bulk-import-review-table";

function row(partial: Partial<BulkImportReviewRow> & Pick<BulkImportReviewRow, "id" | "rowNumber">): BulkImportReviewRow {
  return {
    name: "Lead",
    phone: null,
    email: null,
    validationStatus: "ready_for_simulation",
    duplicateStatus: "none",
    deliveryStatus: "simulated",
    blockerReasons: [],
    unmappedFieldCount: 0,
    excluded: false,
    ...partial,
  };
}

test("defaultSelectedCanaryRowId picks first matched undelivered row", () => {
  const rows = [
    row({ id: "row_1", rowNumber: 1, deliveryStatus: "delivered", ghlContactId: "ghl_1" }),
    row({ id: "row_2", rowNumber: 2 }),
    row({ id: "row_3", rowNumber: 3 }),
  ];
  const checks = [
    { rowId: "row_1", matched: true },
    { rowId: "row_2", matched: true },
    { rowId: "row_3", matched: false },
  ];
  assert.equal(defaultSelectedCanaryRowId(rows, checks, 1), "row_2");
});

test("nextUndeliveredCanaryRowId advances to the next selectable row", () => {
  const rows = [
    row({ id: "row_1", rowNumber: 1, deliveryStatus: "delivered", ghlContactId: "ghl_1" }),
    row({ id: "row_2", rowNumber: 2 }),
    row({ id: "row_3", rowNumber: 3 }),
  ];
  const checks = [
    { rowId: "row_2", matched: true },
    { rowId: "row_3", matched: true },
  ];
  assert.equal(nextUndeliveredCanaryRowId(rows, checks, "row_2"), "row_3");
});

test("delivered rows are not selectable", () => {
  const status = resolveBulkImportCanaryRowStatus(
    row({ id: "row_1", rowNumber: 1, deliveryStatus: "delivered", ghlContactId: "ghl_1" }),
    true
  );
  assert.equal(status, "delivered");
});
