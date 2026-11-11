import assert from "node:assert/strict";
import test from "node:test";

import {
  ghlDestinationChanged,
  guidedGhlConfigurationWrite,
  isGuidedLiveDestination,
  presentGuidedGhlDestination,
} from "./ghl-destination.ts";

const savedAt = "2026-11-10T12:00:00.000Z";

function destination(overrides: Record<string, unknown> = {}) {
  return {
    destinationSubaccountIdGhl: "loc_saved",
    locationName: "Saved location",
    ghlConnectionStatus: "connected",
    destinationWorkflowIdGhl: "wf_saved",
    workflowTriggerMode: "tag_trigger",
    deliveryMode: "shadow",
    deliveryEnabled: false,
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    updatedAt: savedAt,
    sourceAttributeFieldMapJson: {
      desired_coverage: "field_coverage",
      branch_of_service: "field_branch",
      primary_reason: "field_reason",
    },
    sa360CustomFieldIdMapJson: { sa360_lead_uid: "field_uid" },
    ...overrides,
  };
}

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn_saved",
    locationId: "loc_saved",
    locationName: "Saved location",
    connectionStatus: "connected",
    lastError: null,
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    locationId: "loc_saved",
    workflows: [
      { id: "wf_saved", name: "Published LAL AI BOT-1 VET Webform workflow #8" },
      { id: "wf_other", name: "Another Webform" },
    ],
    customFields: [
      { id: "field_coverage", name: "Desired Coverage", fieldKey: "contact.desired_coverage" },
      { id: "field_branch", name: "Branch of Service", fieldKey: "contact.branch_of_service" },
      { id: "field_reason", name: "Primary Reason", fieldKey: "contact.primary_reason" },
      { id: "field_uid", name: "SA360 Lead UID", fieldKey: "contact.sa360_lead_uid" },
    ],
    fetchedAt: savedAt,
    fromCache: true,
    errors: [],
    ...overrides,
  };
}

function present(overrides: Parameters<typeof presentGuidedGhlDestination>[0] = {}) {
  return presentGuidedGhlDestination({
    clientAccountId: "phase2g_demo",
    destination: destination(),
    connections: [connection()],
    snapshot: snapshot(),
    ...overrides,
  });
}

test("a partial destination is configured only when a location id is saved", () => {
  const empty = presentGuidedGhlDestination({ clientAccountId: "phase2g_demo", destination: null, connections: [] });
  assert.equal(empty.configured, false);
  assert.equal(empty.verified, false);
  assert.equal(empty.active, false);
  assert.equal(empty.issues.some((issue) => /no gohighlevel location is saved/i.test(issue)), true);
  assert.equal(empty.issues.some((issue) => /no gohighlevel credentials are linked/i.test(issue)), true);
  assert.equal(guidedGhlConfigurationWrite().allowed, false);
});

test("missing credentials stay unverified when a location id is already saved", () => {
  const view = present({ connections: [], connection: null });
  assert.equal(view.configured, true);
  assert.equal(view.verified, false);
  assert.equal(view.issues.some((issue) => /no credentials are linked/i.test(issue)), true);
});

test("revoked credentials are not a verified location", () => {
  const view = present({
    connections: [connection({ connectionStatus: "revoked", lastError: "token revoked" })],
    issueCodes: ["oauth_revoked"],
  });
  assert.equal(view.verified, false);
  assert.equal(view.active, false);
  assert.equal(view.issues.some((issue) => /revoked/i.test(issue)), true);
});

test("a display name is not a saved field id", () => {
  const view = present({
    destination: destination({
      sourceAttributeFieldMapJson: { branch_of_service: "field_branch", primary_reason: "field_reason" },
    }),
  });
  const coverage = view.fields.find((field) => field.key === "desired_coverage");
  assert.equal(coverage?.status, "name_only");
  assert.equal(coverage?.savedId, null);
  assert.equal(view.verified, false);
  assert.match(coverage?.detail ?? "", /not a saved field id/i);
});

test("a field key and an unknown value stay unresolved", () => {
  const view = present({
    destination: destination({
      sourceAttributeFieldMapJson: {
        desired_coverage: "contact.desired_coverage",
        branch_of_service: "missing_field",
        primary_reason: "field_reason",
      },
    }),
  });
  assert.equal(view.fields.find((field) => field.key === "desired_coverage")?.status, "unresolved");
  assert.equal(view.fields.find((field) => field.key === "branch_of_service")?.status, "unresolved");
  assert.equal(view.verified, false);
});

test("duplicate saved field ids are reported and block verification", () => {
  const view = present({
    destination: destination({
      sourceAttributeFieldMapJson: {
        desired_coverage: "field_coverage",
        branch_of_service: "field_coverage",
        primary_reason: "field_reason",
      },
    }),
  });
  assert.equal(view.fields.find((field) => field.key === "desired_coverage")?.status, "duplicate");
  assert.equal(view.fields.find((field) => field.key === "branch_of_service")?.status, "duplicate");
  assert.equal(view.verified, false);
});

test("a workflow id is verified only when that id is in the snapshot", () => {
  const mismatch = present({
    destination: destination({ destinationWorkflowIdGhl: "wf_missing" }),
  });
  assert.equal(mismatch.workflowInSnapshot, false);
  assert.equal(mismatch.verified, false);
  assert.equal(mismatch.issues.some((issue) => /workflow id is not in the location snapshot/i.test(issue)), true);
  assert.match(mismatch.webformNote ?? "", /not selected by name/i);

  const matched = present();
  assert.equal(matched.workflowInSnapshot, true);
  assert.equal(matched.workflowName?.includes("Webform"), true);
  assert.equal(matched.verified, true);
  assert.equal(matched.active, false);
  assert.equal(matched.configured, true);

  const captured = present({
    snapshot: snapshot({ snapshotVerification: "previously_captured" }),
  });
  assert.equal(captured.workflowInSnapshot, true);
  assert.equal(captured.verified, false);
  assert.match(captured.issues.join(" "), /not current GoHighLevel verification/i);
});

test("delivery flags distinguish a shadow row from a live destination", () => {
  const shadow = present({
    destination: destination({ deliveryEnabled: true, deliveryMode: "shadow" }),
  });
  assert.equal(shadow.active, false);
  assert.equal(shadow.verified, true);
  const live = present({
    destination: destination({
      deliveryEnabled: true,
      deliveryMode: "live",
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
    }),
  });
  assert.equal(live.active, true);
  assert.equal(live.live, true);
  assert.equal(isGuidedLiveDestination({
    locationId: "loc_saved",
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
  }), true);
  assert.equal(live.issues.some((issue) => /already live/i.test(issue)), true);
});

test("a snapshot for a different location does not verify the saved destination", () => {
  const view = present({ snapshot: snapshot({ locationId: "loc_other" }) });
  assert.equal(view.snapshotLoaded, false);
  assert.equal(view.verified, false);
  assert.equal(view.issues.some((issue) => /different location/i.test(issue)), true);
});

test("a changed saved timestamp is stale and an unread snapshot is not verified", () => {
  assert.equal(ghlDestinationChanged(savedAt, "2026-11-10T13:00:00.000Z"), true);
  assert.equal(ghlDestinationChanged(savedAt, savedAt), false);
  assert.equal(ghlDestinationChanged(null, savedAt), false);
  const unread = present({ snapshot: null });
  assert.equal(unread.fields.every((field) => field.status === "unverified"), true);
  assert.equal(unread.verified, false);
  assert.equal(unread.issues.some((issue) => /not been read/i.test(issue)), true);
});
