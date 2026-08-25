import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { presentAutomationSignalHealth } from "@/lib/automation/present-signal-health.ts";

import { AutomationSignalHealthPanel } from "./automation-signal-health-panel.tsx";

test("partial signal payload keeps counters and does not crash on missing events", () => {
  const signal = presentAutomationSignalHealth({
    ok: true,
    signalSent: 4,
    signalFailed: 1,
    webhookFailures: 2,
    duplicatesOrSkipped: 0,
  } as never);
  render(<AutomationSignalHealthPanel signal={signal} />);
  assert.ok(screen.getByText("Lifecycle events unavailable"));
  assert.ok(screen.getByText("4"));
  assert.ok(screen.getByText("Failed webhook log unavailable"));
  cleanup();
});

test("empty events list is distinct from unavailable", () => {
  const signal = presentAutomationSignalHealth({
    ok: true,
    signalSent: 0,
    eventsByInternalName: [],
    failedWebhookLogs: [],
  } as never);
  render(<AutomationSignalHealthPanel signal={signal} />);
  assert.ok(screen.getByText("No lifecycle events in range"));
  assert.equal(screen.queryByText("Lifecycle events unavailable"), null);
  assert.equal(screen.queryByText("Failed webhook log unavailable"), null);
  cleanup();
});

test("healthy signal payload renders counts, events, and failed webhook rows", () => {
  const signal = presentAutomationSignalHealth({
    ok: true,
    signalSent: 4,
    signalFailed: 1,
    webhookFailures: 2,
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
  render(<AutomationSignalHealthPanel signal={signal} />);
  assert.ok(screen.getByText("4"));
  assert.ok(screen.getAllByText("appointment_set").length >= 1);
  assert.ok(screen.getByText("3"));
  assert.ok(screen.getByText("timeout"));
  assert.ok(screen.getAllByText("failed").length >= 1);
  assert.equal(screen.queryByText("Lifecycle events unavailable"), null);
  assert.equal(screen.queryByText("No lifecycle events in range"), null);
  cleanup();
});
