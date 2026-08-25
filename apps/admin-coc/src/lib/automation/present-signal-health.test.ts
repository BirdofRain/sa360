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

test("presentAutomationSignalHealth preserves a healthy signal payload including zeros", () => {
  const presented = presentAutomationSignalHealth({
    ok: true,
    signalSent: 0,
    signalFailed: 2,
    webhookFailures: 1,
    duplicatesOrSkipped: 0,
    eventsByInternalName: [{ eventNameInternal: "appointment_set", count: 3 }],
    failedWebhookLogs: [
      {
        id: "log_1",
        receivedAt: "2026-05-18T09:00:00.000Z",
        processingStatus: "failed",
        eventNameInternal: "appointment_set",
        clientAccountId: "client_test",
        errorSummary: "timeout",
      },
    ],
  });
  assert.equal(presented.signalSent, 0);
  assert.equal(presented.signalFailed, 2);
  assert.equal(presented.webhookFailures, 1);
  assert.equal(presented.duplicatesOrSkipped, 0);
  assert.equal(presented.eventsAvailability, "ok");
  assert.equal(presented.failedWebhookLogsAvailability, "ok");
  assert.deepEqual(presented.eventsByInternalName, [
    { eventNameInternal: "appointment_set", count: 3 },
  ]);
  assert.equal(presented.failedWebhookLogs[0]?.errorSummary, "timeout");
});
