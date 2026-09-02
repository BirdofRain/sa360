import assert from "node:assert/strict";
import test from "node:test";

import {
  isUnmodifiedPortalLeadListClick,
  portalLeadListHref,
  portalLeadListNeedsExplicitRefresh,
} from "./portal-lead-list-navigation.ts";

test("All href is exactly /portal/leads with no status query", () => {
  assert.equal(portalLeadListHref("all"), "/portal/leads");
  assert.equal(portalLeadListHref("delivered"), "/portal/leads?status=delivered");
});

test("toggling All ↔ Delivered always needs an explicit RSC refresh", () => {
  assert.equal(portalLeadListNeedsExplicitRefresh("all", "delivered"), true);
  assert.equal(portalLeadListNeedsExplicitRefresh("delivered", "all"), true);
  assert.equal(portalLeadListNeedsExplicitRefresh("all", "all"), false);
  assert.equal(portalLeadListNeedsExplicitRefresh("delivered", "delivered"), false);
});

test("modified clicks keep native link behavior (new tab / download)", () => {
  assert.equal(isUnmodifiedPortalLeadListClick({ button: 0 }), true);
  assert.equal(isUnmodifiedPortalLeadListClick({ button: 1 }), false);
  assert.equal(isUnmodifiedPortalLeadListClick({ metaKey: true, button: 0 }), false);
  assert.equal(isUnmodifiedPortalLeadListClick({ ctrlKey: true, button: 0 }), false);
  assert.equal(isUnmodifiedPortalLeadListClick({ shiftKey: true, button: 0 }), false);
  assert.equal(isUnmodifiedPortalLeadListClick({ altKey: true, button: 0 }), false);
});
