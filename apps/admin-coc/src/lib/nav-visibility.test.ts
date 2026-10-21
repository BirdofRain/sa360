import assert from "node:assert/strict";
import test from "node:test";

import { OBSERVER_DOCUMENT_PATHS } from "./admin-coc-observer-access.ts";
import { isNavItemActive } from "./bulk-imports/nav-active.ts";
import {
  adminToolsSectionItems,
  teamNav,
  visibleAdminNavItems,
} from "./nav.ts";
import { deriveObserverNavigation } from "./nav-visibility.ts";

const adminItems = visibleAdminNavItems({ bulkImports: true, supportTickets: true });

test("observer navigation is the allowlist intersection, not a separate list", () => {
  const derived = deriveObserverNavigation(adminItems);
  const intersection = adminItems.filter((item) =>
    (OBSERVER_DOCUMENT_PATHS as readonly string[]).includes(item.href)
  );

  assert.deepEqual(
    derived.map((item) => item.href),
    intersection.map((item) => item.href)
  );
  assert.deepEqual(
    [...derived.map((item) => item.href)].sort(),
    [...OBSERVER_DOCUMENT_PATHS].sort()
  );
  assert.equal(derived.length, OBSERVER_DOCUMENT_PATHS.length);
  assert.equal(OBSERVER_DOCUMENT_PATHS.length, 10);
});

test("observer navigation does not gain team-only or placeholder routes", () => {
  const hrefs = new Set(deriveObserverNavigation(adminItems).map((item) => item.href));
  for (const href of [
    "/review",
    "/clients",
    "/fulfillment-ops",
    "/front-office",
    "/front-office/orders",
    "/flags",
    "/settings",
    "/facebook-intake",
    "/direct-delivery-demo",
    "/action-center",
    "/agent-workspace",
  ]) {
    assert.equal(hrefs.has(href), false, href);
  }
});

test("orders and front office do not share an active state", () => {
  assert.equal(
    isNavItemActive("/front-office/orders", "/front-office/orders", adminItems),
    true
  );
  assert.equal(isNavItemActive("/front-office/orders", "/front-office", adminItems), false);
  assert.equal(isNavItemActive("/front-office", "/front-office", adminItems), true);
  assert.equal(isNavItemActive("/front-office", "/front-office/orders", adminItems), false);
  assert.equal(
    isNavItemActive("/front-office/pipeline-studio", "/front-office", adminItems),
    true
  );
});

test("bulk import paths stay active on Bulk Imports when both entries are present", () => {
  assert.equal(
    isNavItemActive("/source-intake/imports/new", "/source-intake", adminItems),
    false
  );
  assert.equal(
    isNavItemActive("/source-intake/imports/new", "/source-intake/imports", adminItems),
    true
  );
  assert.equal(isNavItemActive("/source-intake", "/source-intake", adminItems), true);
});

test("team group is the everyday admin list and omits the unwired review queue", () => {
  assert.deepEqual(
    teamNav.map((item) => item.href),
    [
      "/",
      "/lead-fulfillment",
      "/front-office/orders",
      "/fulfillment-ops",
      "/lead-inventory",
      "/clients",
      "/source-intake",
      "/lead-timeline",
    ]
  );
  assert.equal(
    adminToolsSectionItems({ bulkImports: false, supportTickets: false }).some(
      (item) => item.href === "/review"
    ),
    false
  );
});
