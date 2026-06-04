import test from "node:test";
import assert from "node:assert/strict";
import {
  canOpenWebhookRequest,
  webhookOpenRequestUnavailableLabel,
} from "./lead-timeline-open-request.ts";

test("canOpenWebhookRequest is true when webhookLogId present", () => {
  assert.equal(canOpenWebhookRequest({ webhookLogId: "wh_1" }), true);
});

test("lead_created lifecycle without webhook shows request unavailable", () => {
  assert.equal(
    webhookOpenRequestUnavailableLabel({
      webhookLogId: null,
      sourceTable: "LifecycleEvent",
      eventNameInternal: "lead_created",
    }),
    "request unavailable"
  );
});
