import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, "page.tsx"), "utf8");
const listPage = readFileSync(join(dir, "../page.tsx"), "utf8");

test("foreign and missing leads share the same not-found path", () => {
  assert.match(page, /isPortalLeadNotFoundStatus/);
  assert.match(page, /Lead not found/);
  assert.match(page, /This lead is not available on your account/);
  assert.doesNotMatch(page, /cross-tenant|wrong account|another client/i);
});

test("lead detail does not invent order linkage or change list navigation helpers", () => {
  assert.match(page, /portalLeadListPath\(listStatus\)/);
  assert.match(page, /PortalLeadDetail/);
  assert.match(page, /mapClientLeadDeliveryDetail/);
  assert.doesNotMatch(page, /orderId|orderNumber/);
});

test("leads list still uses the same detail path helper", () => {
  assert.match(listPage, /portalLeadListPath/);
  assert.match(listPage, /PortalLeadsList/);
  assert.match(listPage, /PortalLeadsStatusFilter/);
});
