import test from "node:test";
import assert from "node:assert/strict";

import {
  isPortalOrderNotFoundStatus,
  parsePortalExportId,
  parsePortalOrderId,
} from "./portal-order-detail.ts";

test("parsePortalOrderId accepts a simple id and rejects traversal", () => {
  assert.equal(parsePortalOrderId("ord_1"), "ord_1");
  assert.equal(parsePortalOrderId("  LO-1001  "), "LO-1001");
  assert.equal(parsePortalOrderId("../secret"), null);
  assert.equal(parsePortalOrderId("a/b"), null);
  assert.equal(parsePortalOrderId(""), null);
  assert.equal(parsePortalOrderId(undefined), null);
});

test("parsePortalExportId rejects path and arbitrary filename input", () => {
  assert.equal(parsePortalExportId("pkg_released"), "pkg_released");
  assert.equal(parsePortalExportId("../secret.csv"), null);
  assert.equal(parsePortalExportId("a/b"), null);
  assert.equal(parsePortalExportId("file.csv"), null);
  assert.equal(parsePortalExportId(""), null);
});

test("not-found statuses include missing and denied orders without leaking tenant", () => {
  assert.equal(isPortalOrderNotFoundStatus(404), true);
  assert.equal(isPortalOrderNotFoundStatus(403), true);
  assert.equal(isPortalOrderNotFoundStatus(401), true);
  assert.equal(isPortalOrderNotFoundStatus(400), true);
  assert.equal(isPortalOrderNotFoundStatus(502), false);
  assert.equal(isPortalOrderNotFoundStatus(0), false);
});
