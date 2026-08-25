import assert from "node:assert/strict";
import test from "node:test";

import { presentAutomationSignalHealth } from "./present-signal-health.ts";

test("presentAutomationSignalHealth marks missing events as unavailable", () => {
  const presented = presentAutomationSignalHealth({
    ok: true,
    signalSent: 3,
    signalFailed: 1,
  } as never);
  assert.equal(presented.eventsAvailability, "unavailable");
  assert.deepEqual(presented.eventsByInternalName, []);
  assert.equal(presented.signalSent, 3);
  assert.equal(presented.signalFailed, 1);
});

test("presentAutomationSignalHealth marks missing failedWebhookLogs as unavailable", () => {
  const presented = presentAutomationSignalHealth({
    ok: true,
    eventsByInternalName: [{ eventNameInternal: "appointment_set", count: 2 }],
  } as never);
  assert.equal(presented.failedWebhookLogsAvailability, "unavailable");
  assert.equal(presented.eventsAvailability, "ok");
});

test("presentAutomationSignalHealth treats empty events as empty, not unavailable", () => {
  const presented = presentAutomationSignalHealth({
    ok: true,
    eventsByInternalName: [],
    failedWebhookLogs: [],
    signalSent: 0,
  } as never);
  assert.equal(presented.eventsAvailability, "empty");
  assert.equal(presented.failedWebhookLogsAvailability, "empty");
});
