import assert from "node:assert/strict";
import test from "node:test";

import {
  isPersistedLiveDestination,
  ongoingRunDisposition,
  runHadExternalCall,
} from "./ghl-destination-authorization.js";

const location = "yCziKRW26eFg8IXAQZ73";

function destination(overrides: Record<string, unknown> = {}) {
  return {
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
    destinationSubaccountIdGhl: location,
    ...overrides,
  };
}

test("persisted live authorization requires the saved location and the four flags", () => {
  assert.equal(isPersistedLiveDestination(destination(), location), true);
  assert.equal(isPersistedLiveDestination(destination({ deliveryEnabled: false }), location), false);
  assert.equal(isPersistedLiveDestination(destination({ deliveryMode: "shadow" }), location), false);
  assert.equal(isPersistedLiveDestination(destination({ clientCutoverApproved: false }), location), false);
  assert.equal(isPersistedLiveDestination(destination({ internalApprovalStatus: "not_reviewed" }), location), false);
  assert.equal(isPersistedLiveDestination(destination(), "other-location"), false);
  assert.equal(isPersistedLiveDestination(null, location), false);
});

test("uncertain and completed GHL runs are not retried", () => {
  assert.equal(ongoingRunDisposition(null), "create");
  assert.equal(ongoingRunDisposition({ status: "succeeded", stepRuns: [] }), "hold");
  assert.equal(ongoingRunDisposition({ status: "partial_success", stepRuns: [] }), "hold");
  assert.equal(ongoingRunDisposition({ status: "executing", stepRuns: [] }), "hold");
  assert.equal(ongoingRunDisposition({ status: "failed", stepRuns: [] }), "hold");
  assert.equal(
    ongoingRunDisposition({
      status: "failed",
      stepRuns: [{ errorCode: "http_transport", responseRedactedJson: { externalCallExecuted: true } }],
    }),
    "hold"
  );
  assert.equal(
    ongoingRunDisposition({
      status: "failed",
      stepRuns: [{ errorCode: "validation", responseRedactedJson: { externalCallExecuted: false } }],
    }),
    "retry"
  );
  assert.equal(
    runHadExternalCall({
      status: "failed",
      stepRuns: [{ errorCode: "http_422", responseRedactedJson: {} }],
    }),
    true
  );
  assert.equal(
    ongoingRunDisposition({
      status: "failed",
      stepRuns: [
        {
          stepType: "create_or_update_contact",
          status: "succeeded",
          externalId: "contact_1",
          errorCode: null,
          responseRedactedJson: { externalCallExecuted: true },
        },
        {
          stepType: "stamp_source_attributes",
          status: "failed",
          errorCode: "validation",
          responseRedactedJson: { externalCallExecuted: false },
        },
      ],
    }),
    "resume"
  );
  assert.equal(
    ongoingRunDisposition({
      status: "failed",
      stepRuns: [
        {
          stepType: "start_workflow",
          status: "failed",
          externalId: null,
          errorCode: "http_500",
          responseRedactedJson: { externalCallExecuted: true },
        },
      ],
    }),
    "hold"
  );
  assert.equal(
    ongoingRunDisposition({
      status: "failed",
      stepRuns: [
        {
          stepType: "create_or_update_contact",
          status: "failed",
          externalId: null,
          errorCode: "http_422",
          responseRedactedJson: { externalCallExecuted: true },
        },
      ],
    }),
    "hold"
  );
});
