import test from "node:test";
import assert from "node:assert/strict";

import {
  isPortalNavItemActive,
  PORTAL_NAV_ITEMS,
  safePortalNextPath,
} from "./portal-nav.ts";

test("portal nav includes overview, orders, leads, and account", () => {
  assert.deepEqual(
    PORTAL_NAV_ITEMS.map((item) => item.href),
    ["/portal", "/portal/orders", "/portal/leads", "/portal/account"]
  );
});

test("overview is exact-match only", () => {
  const overview = PORTAL_NAV_ITEMS[0];
  assert.equal(isPortalNavItemActive("/portal", overview), true);
  assert.equal(isPortalNavItemActive("/portal/orders", overview), false);
  assert.equal(isPortalNavItemActive("/portal/leads", overview), false);
});

test("orders and leads match their prefixes", () => {
  const orders = PORTAL_NAV_ITEMS[1];
  const leads = PORTAL_NAV_ITEMS[2];
  assert.equal(isPortalNavItemActive("/portal/orders", orders), true);
  assert.equal(isPortalNavItemActive("/portal/orders/abc", orders), true);
  assert.equal(isPortalNavItemActive("/portal/leads", leads), true);
  assert.equal(isPortalNavItemActive("/portal/leads/lead_1", leads), true);
  assert.equal(isPortalNavItemActive("/portal", orders), false);
});

test("safePortalNextPath rejects open redirects", () => {
  assert.equal(safePortalNextPath(undefined), "/portal");
  assert.equal(safePortalNextPath("/portal/orders"), "/portal/orders");
  assert.equal(safePortalNextPath("//evil.example"), "/portal");
  assert.equal(safePortalNextPath("/admin"), "/portal");
  assert.equal(safePortalNextPath("/portal\\login"), "/portal");
});
