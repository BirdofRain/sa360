import assert from "node:assert/strict";
import test from "node:test";

import { leadTimelineEventLabel } from "./lead-timeline-event-label";

test("LeadCapture routing_matched webhook is labeled as intake status", () => {
  const label = leadTimelineEventLabel({
    source: "leadcapture_io",
    sourceTable: "WebhookRequestLog",
    eventNameInternal: "lead_created",
    processingStatus: "routing_matched",
  });
  assert.equal(label, "intake webhook · routing_matched");
  assert.equal(label.includes("lead_created"), false);
  assert.equal(label.includes("delivered"), false);
});

test("a persisted GHL lifecycle event keeps its event name", () => {
  assert.equal(
    leadTimelineEventLabel({
      source: "lifecycle_event",
      sourceTable: "LifecycleEvent",
      eventNameInternal: "lead_created",
      processingStatus: "received",
    }),
    "lead_created"
  );
  assert.equal(
    leadTimelineEventLabel({
      source: "ghl_lifecycle",
      sourceTable: "WebhookRequestLog",
      eventNameInternal: "lead_created",
      processingStatus: "stored",
    }),
    "lead_created"
  );
});
