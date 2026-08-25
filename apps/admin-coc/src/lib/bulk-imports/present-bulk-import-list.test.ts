import assert from "node:assert/strict";
import test from "node:test";

import {
  presentBulkImportList,
  readBulkImportListPayload,
} from "./present-bulk-import-list.ts";

const sampleItem = {
  id: "imp_1",
  fileName: "leads.csv",
  status: "READY_FOR_REVIEW",
  totalRows: 10,
  validRows: 8,
  deliveredRows: 2,
  createdAt: "2026-05-18T12:00:00.000Z",
};

test("readBulkImportListPayload treats a missing items array as failure, not empty", () => {
  const missing = readBulkImportListPayload({});
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error, "invalid_list_payload");

  const notArray = readBulkImportListPayload({ items: null });
  assert.equal(notArray.ok, false);
});

test("presentBulkImportList treats a successful empty list as empty, not unavailable", () => {
  const presented = presentBulkImportList({ ok: true, data: { items: [] } });
  assert.equal(presented.availability, "empty");
  assert.deepEqual(presented.items, []);
  assert.equal(presented.title, null);
});

test("presentBulkImportList preserves healthy-path list fields", () => {
  const presented = presentBulkImportList({ ok: true, data: { items: [sampleItem] } });
  assert.equal(presented.availability, "ok");
  assert.deepEqual(presented.items, [sampleItem]);
  assert.equal(presented.title, null);
});

test("presentBulkImportList treats fetch failure as unavailable", () => {
  const presented = presentBulkImportList({
    ok: false,
    status: 503,
    error: "api_error",
    message: "upstream unavailable",
  });
  assert.equal(presented.availability, "unavailable");
  assert.deepEqual(presented.items, []);
  assert.equal(presented.title, "Bulk imports unavailable");
  assert.equal(presented.message, "upstream unavailable");
});

test("presentBulkImportList distinguishes authorization failures", () => {
  const presented = presentBulkImportList({
    ok: false,
    status: 401,
    error: "unauthorized",
    message: "Admin key rejected",
  });
  assert.equal(presented.availability, "unavailable");
  assert.equal(presented.title, "Unable to load bulk imports — authorization failed");
  assert.match(presented.message ?? "", /Admin key rejected/);
});

test("presentBulkImportList sanitizes malformed HTML/non-JSON responses", () => {
  const presented = presentBulkImportList({
    ok: false,
    status: 200,
    error: "api_error",
    message: "Invalid JSON from admin API",
  });
  assert.equal(presented.availability, "unavailable");
  assert.match(presented.message ?? "", /non-JSON response/i);
  assert.doesNotMatch(presented.message ?? "", /<!DOCTYPE/);
});

test("presentBulkImportList sanitizes gateway HTML that is not at the start of the body", () => {
  const presented = presentBulkImportList({
    ok: false,
    status: 502,
    error: "api_error",
    message: "502 Bad Gateway\n<html><head><title>502</title></head><body>nginx</body></html>",
  });
  assert.equal(presented.availability, "unavailable");
  assert.match(presented.message ?? "", /non-JSON response/i);
  assert.doesNotMatch(presented.message ?? "", /<html/i);
  assert.doesNotMatch(presented.message ?? "", /nginx/i);
});

test("presentBulkImportList does not treat ordinary 5xx text as an auth failure", () => {
  const presented = presentBulkImportList({
    ok: false,
    status: 500,
    error: "api_error",
    message: "upstream unavailable",
  });
  assert.equal(presented.title, "Bulk imports unavailable");
  assert.doesNotMatch(presented.title ?? "", /authorization/i);
});
