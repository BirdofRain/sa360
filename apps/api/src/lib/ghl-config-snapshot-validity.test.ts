import test from "node:test";
import assert from "node:assert/strict";
import {
  discoveryFailureSummary,
  dominantSnapshotOutcome,
  explicitDiscoveryCollection,
  isUsableGhlLocationConfigSnapshot,
  isWellFormedDiscoveredLocation,
  previouslyCapturedSnapshotMessage,
  redactGhlDiscoveryText,
} from "./ghl-config-snapshot-validity.js";

test("an explicit empty workflow list is not the same as a missing collection", () => {
  assert.deepEqual(explicitDiscoveryCollection({ workflows: [] }), []);
  assert.deepEqual(explicitDiscoveryCollection([]), []);
  assert.equal(explicitDiscoveryCollection({ message: "Invalid JWT" }), null);
  assert.equal(explicitDiscoveryCollection({ workflows: "none" }), null);
  assert.equal(explicitDiscoveryCollection(null), null);
});

test("a location payload for a different location is not well formed", () => {
  assert.equal(isWellFormedDiscoveredLocation({ id: "loc_a", name: "A" }, "loc_a"), true);
  assert.equal(isWellFormedDiscoveredLocation({ id: "loc_b", name: "B" }, "loc_a"), false);
  assert.equal(isWellFormedDiscoveredLocation({ message: "Invalid JWT" }, "loc_a"), false);
});

test("legacy complete snapshots stay usable and failure markers do not", () => {
  assert.equal(isUsableGhlLocationConfigSnapshot({ errorsJson: null, warningsJson: null }), true);
  assert.equal(
    isUsableGhlLocationConfigSnapshot({
      errorsJson: [{ discoveryOutcome: "complete", usable: true }],
      warningsJson: [],
    }),
    true
  );
  assert.equal(
    isUsableGhlLocationConfigSnapshot({
      errorsJson: [{ discoveryOutcome: "authentication", usable: false }, "GoHighLevel rejected this location's credentials (Invalid JWT)."],
      warningsJson: [],
    }),
    false
  );
  assert.equal(
    isUsableGhlLocationConfigSnapshot({
      errorsJson: [],
      warningsJson: ["workflows: HTTP 401"],
    }),
    false
  );
});

test("failure copy names reconnect and previously captured data without secrets", () => {
  const summary = discoveryFailureSummary({
    outcome: "authentication",
    providerDetail: "Invalid JWT access_token=secret-value",
  });
  assert.match(summary, /Invalid JWT/);
  assert.match(summary, /Reconnect the location/);
  assert.doesNotMatch(summary, /secret-value|access_token/);
  const fallback = previouslyCapturedSnapshotMessage(summary);
  assert.match(fallback, /previously captured/);
  assert.match(fallback, /not current GoHighLevel verification/);
  assert.equal(redactGhlDiscoveryText("Bearer secret-token"), "[redacted]");
  assert.equal(dominantSnapshotOutcome(["timeout", "timeout"], 2), "timeout");
  assert.equal(dominantSnapshotOutcome(["provider_outage"], 6), "partial_failure");
  assert.equal(dominantSnapshotOutcome(["authentication"], 6), "authentication");
  assert.equal(dominantSnapshotOutcome(["provider_outage", "network"], 2), "provider_outage");
});
