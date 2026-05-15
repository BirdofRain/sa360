import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAutomationDashboardDateRange,
  toAutomationDashboardFilters,
} from "./automation-dashboard.schema.js";
import { computeHealthStatus } from "../services/automation-dashboard.service.js";
import { WORKFLOW_CHECKPOINT_DEFS } from "../services/automation-dashboard.helpers.js";

test("resolveAutomationDashboardDateRange: default 7d when omitted", () => {
  const { from, to } = resolveAutomationDashboardDateRange({});
  const spanMs = to.getTime() - from.getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.ok(spanMs >= sevenDays - 60_000 && spanMs <= sevenDays + 60_000);
});

test("resolveAutomationDashboardDateRange: today uses UTC midnight", () => {
  const { from, to } = resolveAutomationDashboardDateRange({ range: "today" });
  assert.equal(from.getUTCHours(), 0);
  assert.equal(from.getUTCMinutes(), 0);
  assert.ok(to.getTime() >= from.getTime());
});

test("resolveAutomationDashboardDateRange: from after to throws", () => {
  assert.throws(
    () =>
      resolveAutomationDashboardDateRange({
        from: "2025-02-01T00:00:00.000Z",
        to: "2025-01-01T00:00:00.000Z",
      }),
    /from after to/
  );
});

test("toAutomationDashboardFilters maps locationId to subaccountIdGhl", () => {
  const f = toAutomationDashboardFilters({
    clientAccountId: "acct-1",
    locationId: "loc-ghl-1",
    range: "7d",
  });
  assert.equal(f.clientAccountId, "acct-1");
  assert.equal(f.subaccountIdGhl, "loc-ghl-1");
});

test("WORKFLOW_CHECKPOINT_DEFS has v1 funnel steps", () => {
  const names = WORKFLOW_CHECKPOINT_DEFS.map((d) => d.eventName);
  assert.ok(names.includes("lead_created"));
  assert.ok(names.includes("first_response"));
  assert.ok(names.includes("appointment_set"));
  assert.ok(names.includes("signal_sent"));
  assert.equal(names.length, 10);
});

test("computeHealthStatus thresholds", () => {
  assert.equal(
    computeHealthStatus({
      webhookFailures: 0,
      webhookTotal: 100,
      signalFailures: 0,
      signalAttempts: 10,
      validationFailures: 0,
    }),
    "HEALTHY"
  );
  assert.equal(
    computeHealthStatus({
      webhookFailures: 6,
      webhookTotal: 100,
      signalFailures: 0,
      signalAttempts: 0,
      validationFailures: 0,
    }),
    "WARNING"
  );
  assert.equal(
    computeHealthStatus({
      webhookFailures: 25,
      webhookTotal: 100,
      signalFailures: 0,
      signalAttempts: 0,
      validationFailures: 0,
    }),
    "BROKEN"
  );
});
