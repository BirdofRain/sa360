import test from "node:test";
import assert from "node:assert/strict";
import { ghlSnapshotOutcomeMarker } from "../../lib/ghl-config-snapshot-validity.js";
import { GHL_DESTINATION_CONFIG_SNAPSHOT_MAX_AGE_MS } from "../ghl-destination-config-request.js";
import { LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME } from "../ghl-delivery-adapter/lal-ai-bot1-vet-snapshot.js";
import {
  assessOperationalGhlSnapshot,
  canaryDiscoveryBlocker,
  GHL_OPERATIONAL_SNAPSHOT_MAX_AGE_MS,
  operationalSaveRejection,
} from "./ghl-operational-snapshot.js";

const NOW = new Date("2026-11-11T18:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    locationId: "loc_a",
    fetchedAt: NOW,
    errorsJson: [ghlSnapshotOutcomeMarker("complete")],
    warningsJson: [],
    ...overrides,
  };
}

test("operational freshness uses the 24 hour and five minute configuration-request window", () => {
  assert.equal(GHL_OPERATIONAL_SNAPSHOT_MAX_AGE_MS, GHL_DESTINATION_CONFIG_SNAPSHOT_MAX_AGE_MS);
  assert.equal(GHL_OPERATIONAL_SNAPSHOT_MAX_AGE_MS, 24 * 60 * 60 * 1000);
});

test("a complete snapshot for the same location is current", () => {
  assert.deepEqual(assessOperationalGhlSnapshot(row(), "loc_a", NOW), { state: "current" });
  assert.deepEqual(
    assessOperationalGhlSnapshot(row({ workflowsJson: [], customFieldsJson: [] }), "loc_a", NOW),
    { state: "current" }
  );
});

test("failed, stale, future, and wrong-location snapshots are not authorization", () => {
  const cases = [
    row({ errorsJson: [ghlSnapshotOutcomeMarker("authentication"), "Invalid JWT"] }),
    row({ errorsJson: [ghlSnapshotOutcomeMarker("timeout")] }),
    row({ errorsJson: [ghlSnapshotOutcomeMarker("partial_failure")] }),
    row({ errorsJson: [ghlSnapshotOutcomeMarker("provider_outage")] }),
    row({ errorsJson: [], warningsJson: ["workflows: the request timed out."] }),
  ];
  for (const failed of cases) {
    const assessment = assessOperationalGhlSnapshot(failed, "loc_a", NOW);
    assert.equal(assessment.state, "failed");
    const rejection = operationalSaveRejection(assessment as Exclude<typeof assessment, { state: "current" }>);
    assert.equal(rejection.code, "SNAPSHOT_NOT_CURRENT");
    assert.match(rejection.error, /left unchanged/);
  }
  assert.equal(
    operationalSaveRejection({ state: "failed", outcome: "authentication", reconnect: true }).code,
    "SNAPSHOT_NOT_CURRENT"
  );
  assert.match(
    operationalSaveRejection({ state: "failed", outcome: "authentication", reconnect: true }).error,
    /Reconnect the location/
  );
  assert.equal(assessOperationalGhlSnapshot(null, "loc_a", NOW).state, "missing");
  assert.equal(assessOperationalGhlSnapshot(row({ locationId: "loc_b" }), "loc_a", NOW).state, "wrong_location");
  assert.equal(
    assessOperationalGhlSnapshot(
      row({ fetchedAt: new Date(NOW.getTime() - GHL_OPERATIONAL_SNAPSHOT_MAX_AGE_MS - 1) }),
      "loc_a",
      NOW
    ).state,
    "expired"
  );
  assert.equal(
    assessOperationalGhlSnapshot(row({ fetchedAt: new Date(NOW.getTime() + 6 * 60 * 1000) }), "loc_a", NOW).state,
    "future"
  );
});

test("canary evidence distinguishes an unavailable discovery from fields the current discovery does not contain", () => {
  const failed = canaryDiscoveryBlocker(
    { state: "failed", outcome: "authentication", reconnect: true },
    ["field_keep"],
    []
  );
  assert.equal(failed.kind, "unavailable");
  assert.match(failed.blocker ?? "", /not a finding that fields are missing/);
  assert.doesNotMatch(failed.blocker ?? "", /field_keep/);

  const stale = canaryDiscoveryBlocker({ state: "expired" }, ["field_keep"], []);
  assert.equal(stale.kind, "stale");
  assert.match(stale.blocker ?? "", /were not treated as missing/);

  const genuine = canaryDiscoveryBlocker({ state: "current" }, ["field_keep"], []);
  assert.equal(genuine.kind, "missing_fields");
  assert.match(genuine.blocker ?? "", /field_keep/);
  assert.match(genuine.blocker ?? "", /separate from a failed refresh/);

  const present = canaryDiscoveryBlocker(
    { state: "current" },
    ["field_keep"],
    [{ id: "field_keep", name: "Lead", key: null, fieldKey: "contact.sa360_lead_uid", dataType: "TEXT" }]
  );
  assert.equal(present.kind, "current");
  assert.equal(present.blocker, null);
  assert.equal(LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME.length > 0, true);
});
