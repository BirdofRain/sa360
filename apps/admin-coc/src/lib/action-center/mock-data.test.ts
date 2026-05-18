import test from "node:test";
import assert from "node:assert/strict";
import { getMockActionCenterDashboard } from "./mock-data.ts";

test("mock dashboard matches ActionCenterDashboardResponse shape", () => {
  const d = getMockActionCenterDashboard({
    clientAccountId: "client_test",
    locationId: "loc_1",
  });
  assert.equal(d.ok, true);
  assert.equal(d.clientAccountId, "client_test");
  assert.equal(d.ghlConnection.status, "connected");
  assert.ok(d.priorityCalls.length >= 1);
  assert.ok(d.kpis.hotActionsWaiting >= 0);
  assert.equal(d.priorityCalls[0].rank, 1);
});
