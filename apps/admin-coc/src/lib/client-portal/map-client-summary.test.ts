import test from "node:test";
import assert from "node:assert/strict";

import {
  emptyPortalAccountSnapshot,
  mapClientFrontOfficeSummary,
} from "./map-client-summary.ts";

test("maps front-office summary KPIs used by the portal snapshot", () => {
  const snapshot = mapClientFrontOfficeSummary({
    ok: true,
    kpis: {
      ordersActive: 3,
      ordersNeedingSetup: 1,
      leadsDelivered: 12,
      trustWarnings: 2,
      latestLeadEvent: "2026-08-24T09:00:00.000Z",
    },
  });
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.ordersActive, 3);
  assert.equal(snapshot.leadsDelivered, 12);
});

test("missing KPI object is an unavailable snapshot, not zeros", () => {
  const snapshot = mapClientFrontOfficeSummary({ ok: true });
  assert.deepEqual(snapshot, emptyPortalAccountSnapshot());
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.ordersActive, null);
});
