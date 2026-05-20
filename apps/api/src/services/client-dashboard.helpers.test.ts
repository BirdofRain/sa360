import test from "node:test";
import assert from "node:assert/strict";
import {
  computeFunnelConversion,
  presentLifecycleActivity,
  LIFECYCLE_TO_CLIENT_ACTIVITY,
} from "./client-dashboard.helpers.js";

test("presentLifecycleActivity never returns internal event names", () => {
  for (const [internal, presentation] of Object.entries(LIFECYCLE_TO_CLIENT_ACTIVITY)) {
    assert.notEqual(presentation.title, internal);
    assert.ok(!presentation.title.includes("eventNameInternal"));
    const mapped = presentLifecycleActivity(internal);
    assert.equal(mapped?.title, presentation.title);
  }
});

test("presentLifecycleActivity returns null for unknown internal events", () => {
  assert.equal(presentLifecycleActivity("signal_sent"), null);
  assert.equal(presentLifecycleActivity("validation_failed"), null);
});

test("computeFunnelConversion calculates rates", () => {
  const c = computeFunnelConversion({
    leadsReceived: 10,
    replied: 5,
    appointmentsSet: 2,
    appointmentsShowed: 1,
    sold: 1,
  });
  assert.equal(c.replyRate, 0.5);
  assert.equal(c.setRate, 0.2);
  assert.equal(c.showRate, 0.5);
  assert.equal(c.soldRate, 1);
});
