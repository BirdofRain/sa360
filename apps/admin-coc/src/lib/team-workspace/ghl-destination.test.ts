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
    fromCache: false,
    snapshotVerification: "live",
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
    now: new Date(savedAt),
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

const acceptanceSavedAt = "2026-11-11T23:10:37.772Z";

function acceptanceDestination(overrides: Record<string, unknown> = {}) {
  return {
    destinationSubaccountIdGhl: "loc_harbor_local",
    locationName: "Harbor location",
    ghlConnectionStatus: "connected",
    destinationWorkflowIdGhl: "wf_harbor_saved",
    workflowTriggerMode: "tag_trigger",
    deliveryMode: "shadow",
    deliveryEnabled: false,
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    updatedAt: acceptanceSavedAt,
    sourceAttributeFieldMapJson: {},
    ...overrides,
  };
}

test("Northshore has no operational destination, so a request id is not a saved operational id", () => {
  const view = presentGuidedGhlDestination({
    clientAccountId: "northshore_mutual",
    destination: null,
    connections: [],
  });
  const rendered = JSON.stringify(view);
  assert.equal(view.configured, false);
  assert.equal(view.stampFields.length, 0);
  assert.equal(view.fields.every((field) => field.savedId === null), true);
  assert.equal(rendered.includes("north_coverage"), false);
  assert.equal(rendered.includes("north_branch"), false);
  assert.equal(rendered.includes("north_reason"), false);

  const requestOnly = presentGuidedGhlDestination({
    clientAccountId: "northshore_mutual",
    destination: {
      sa360CustomFieldIdMapJson: {
        desired_coverage: "north_coverage",
        branch_of_service: "north_branch",
        primary_reason: "north_reason",
      },
    },
    connections: [],
  });
  assert.equal(requestOnly.configured, false);
  assert.equal(requestOnly.stampFields.length, 0);
  assert.equal(JSON.stringify(requestOnly).includes("north_coverage"), false);
});

test("Harbor shows saved survey ids and a failed snapshot does not verify them", () => {
  const savedMap = {
    desired_coverage: "harbor_keep_coverage",
    branch_of_service: "harbor_keep_branch",
    primary_reason: "harbor_keep_reason",
  };
  const historical = presentGuidedGhlDestination({
    clientAccountId: "harbor_benefits",
    destination: acceptanceDestination({ sa360CustomFieldIdMapJson: savedMap }),
    connections: [
      {
        id: "conn_harbor",
        locationId: "loc_harbor_local",
        locationName: "Harbor location",
        connectionStatus: "connected",
        lastError: null,
      },
    ],
    snapshot: {
      locationId: "loc_harbor_local",
      workflows: [{ id: "wf_harbor_saved", name: "Harbor saved workflow" }],
      customFields: [
        { id: "harbor_keep_coverage", name: "Desired Coverage" },
        { id: "harbor_keep_branch", name: "Branch of Service" },
        { id: "harbor_keep_reason", name: "Primary Reason" },
      ],
      fetchedAt: "2026-11-11T21:10:37.766Z",
      fromCache: true,
      snapshotVerification: "previously_captured",
      errors: ["The latest refresh failed: Invalid JWT"],
    },
  });
  for (const [key, savedId] of Object.entries(savedMap)) {
    const survey = historical.fields.find((field) => field.key === key);
    const stamp = historical.stampFields.find((field) => field.key === key);
    assert.equal(survey?.savedId, savedId);
    assert.equal(survey?.status, "unverified");
    assert.equal(stamp?.savedId, savedId);
    assert.equal(stamp?.status, "unverified");
    assert.match(survey?.detail ?? "", /not currently verified/i);
    assert.equal(/not a saved field id/i.test(survey?.detail ?? ""), false);
  }
  assert.equal(historical.verified, false);
  assert.equal(historical.active, false);
  assert.equal(historical.deliveryEnabled, false);
  assert.equal(historical.workflowId, "wf_harbor_saved");
  assert.equal(historical.issues.some((issue) => /no sa360 field ids are saved/i.test(issue)), false);

  const failedEmpty = presentGuidedGhlDestination({
    clientAccountId: "harbor_benefits",
    destination: acceptanceDestination({ sa360CustomFieldIdMapJson: savedMap }),
    connections: [
      {
        id: "conn_harbor",
        locationId: "loc_harbor_local",
        locationName: "Harbor location",
        connectionStatus: "connected",
      },
    ],
    snapshot: {
      locationId: "loc_harbor_local",
      workflows: [],
      customFields: [],
      snapshotVerification: "previously_captured",
      errors: ["Invalid JWT"],
    },
  });
  assert.equal(failedEmpty.fields.every((field) => field.status === "unverified" && field.savedId), true);
  assert.equal(failedEmpty.fields.some((field) => field.status === "verified" || field.status === "unresolved"), false);
});

test("Summit keeps an active destination and saved ids without treating an old snapshot as current", () => {
  const savedMap = {
    desired_coverage: "summit_live_coverage",
    branch_of_service: "summit_live_branch",
    primary_reason: "summit_live_reason",
    sa360_lead_uid: "summit_live_uid",
  };
  const destination = acceptanceDestination({
    destinationSubaccountIdGhl: "loc_summit_local",
    locationName: "Summit location",
    destinationWorkflowIdGhl: "wf_summit_live",
    deliveryMode: "live",
    deliveryEnabled: true,
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
    sa360CustomFieldIdMapJson: savedMap,
  });
  const connection = {
    id: "conn_summit",
    locationId: "loc_summit_local",
    locationName: "Summit location",
    connectionStatus: "connected",
    lastError: null,
  };
  const current = presentGuidedGhlDestination({
    clientAccountId: "summit_agency",
    destination,
    connections: [connection],
    snapshot: {
      locationId: "loc_summit_local",
      workflows: [{ id: "wf_summit_live", name: "Summit live workflow" }],
      customFields: [
        { id: "summit_live_coverage", name: "Desired Coverage" },
        { id: "summit_live_branch", name: "Branch of Service" },
        { id: "summit_live_reason", name: "Primary Reason" },
        { id: "summit_live_uid", name: "SA360 Lead UID" },
      ],
      snapshotVerification: "live",
      fetchedAt: acceptanceSavedAt,
      errors: [],
    },
    now: new Date(acceptanceSavedAt),
  });
  assert.equal(current.active, true);
  assert.equal(current.deliveryEnabled, true);
  assert.equal(current.deliveryMode, "live");
  assert.equal(current.fields.find((field) => field.key === "desired_coverage")?.status, "verified");
  assert.equal(current.stampFields.find((field) => field.key === "sa360_lead_uid")?.savedId, "summit_live_uid");

  const older = presentGuidedGhlDestination({
    clientAccountId: "summit_agency",
    destination,
    connections: [connection],
    snapshot: {
      locationId: "loc_summit_local",
      workflows: [{ id: "wf_summit_live", name: "Summit live workflow" }],
      customFields: [{ id: "summit_live_coverage", name: "Desired Coverage" }],
      snapshotVerification: "previously_captured",
      errors: [],
    },
  });
  assert.equal(older.active, true);
  assert.equal(older.deliveryEnabled, true);
  assert.equal(older.verified, false);
  assert.equal(older.fields.every((field) => field.status === "unverified"), true);
  assert.equal(older.fields.find((field) => field.key === "desired_coverage")?.savedId, "summit_live_coverage");
});

test("null, missing, malformed, and legacy field maps do not invent saved ids", () => {
  const cases: unknown[] = [null, undefined, "legacy-string", [], { desired_coverage: { ghlFieldKey: "legacy_id" } }, { desired_coverage: "" }];
  for (const map of cases) {
    const view = presentGuidedGhlDestination({
      clientAccountId: "harbor_benefits",
      destination: acceptanceDestination({
        sa360CustomFieldIdMapJson: map,
        sourceAttributeFieldMapJson: map === undefined ? undefined : {},
      }),
      connections: [],
    });
    assert.equal(view.stampFields.length, 0, JSON.stringify(map));
    assert.equal(view.fields.every((field) => field.savedId === null), true);
    assert.equal(JSON.stringify(view).includes("legacy_id"), false);
  }
});

test("field verification follows the 24-hour snapshot window and does not change delivery", () => {
  const now = new Date("2026-11-12T15:00:00.000Z");
  const fresh = new Date(now.getTime() - 60_000).toISOString();
  const withinSkew = new Date(now.getTime() + 4 * 60 * 1000).toISOString();
  const expired = new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1000).toISOString();
  const future = new Date(now.getTime() + 6 * 60 * 1000).toISOString();
  const savedMap = {
    desired_coverage: "summit_live_coverage",
    branch_of_service: "summit_live_branch",
    primary_reason: "summit_live_reason",
  };
  const viewFor = (snapshotOverrides: Record<string, unknown>, locationId = "loc_summit_local") =>
    presentGuidedGhlDestination({
      clientAccountId: "summit_agency",
      now,
      destination: acceptanceDestination({
        destinationSubaccountIdGhl: "loc_summit_local",
        locationName: "Summit location",
        destinationWorkflowIdGhl: "wf_summit_live",
        deliveryMode: "live",
        deliveryEnabled: true,
        clientCutoverApproved: true,
        internalApprovalStatus: "approved",
        sa360CustomFieldIdMapJson: savedMap,
      }),
      connections: [
        {
          id: "conn_summit",
          locationId: "loc_summit_local",
          locationName: "Summit location",
          connectionStatus: "connected",
        },
      ],
      snapshot: {
        locationId,
        workflows: [{ id: "wf_summit_live", name: "Summit live workflow" }],
        customFields: [
          { id: "summit_live_coverage", name: "Desired Coverage" },
          { id: "summit_live_branch", name: "Branch of Service" },
          { id: "summit_live_reason", name: "Primary Reason" },
        ],
        fetchedAt: fresh,
        snapshotVerification: "live",
        errors: [],
        ...snapshotOverrides,
      },
    });

  const live = viewFor({});
  assert.equal(live.fields.find((field) => field.key === "desired_coverage")?.status, "verified");
  assert.equal(live.fields.every((field) => field.savedId), true);
  assert.equal(live.deliveryEnabled, true);
  assert.equal(live.active, true);

  const cached = viewFor({ snapshotVerification: "cached", fromCache: true, fetchedAt: withinSkew });
  assert.equal(cached.fields.find((field) => field.key === "branch_of_service")?.status, "verified");
  assert.equal(cached.active, true);

  const captured = viewFor({ snapshotVerification: "previously_captured" });
  assert.equal(captured.fields.every((field) => field.status === "unverified" && field.savedId), true);
  assert.equal(captured.verified, false);
  assert.equal(captured.deliveryEnabled, true);

  const stale = viewFor({ snapshotVerification: "cached", fromCache: true, fetchedAt: expired });
  assert.equal(stale.fields.every((field) => field.status === "unverified"), true);
  assert.equal(stale.fields.find((field) => field.key === "primary_reason")?.savedId, "summit_live_reason");
  assert.equal(stale.active, true);
  assert.equal(stale.deliveryEnabled, true);
  assert.equal(stale.deliveryMode, "live");

  const ahead = viewFor({ fetchedAt: future });
  assert.equal(ahead.fields.every((field) => field.status === "unverified" && field.savedId), true);
  assert.equal(ahead.verified, false);

  const missingTime = viewFor({ fetchedAt: undefined });
  assert.equal(missingTime.fields.every((field) => field.status === "unverified"), true);
  assert.equal(missingTime.verified, false);

  const missingStatus = viewFor({ snapshotVerification: undefined });
  assert.equal(missingStatus.fields.every((field) => field.status === "unverified" && field.savedId), true);

  const unknownStatus = viewFor({ snapshotVerification: "complete" });
  assert.equal(unknownStatus.fields.every((field) => field.status === "unverified"), true);

  const failed = viewFor({ errors: ["Invalid JWT"] });
  assert.equal(failed.fields.every((field) => field.status === "unverified" && field.savedId), true);
  assert.equal(failed.verified, false);
  assert.equal(failed.deliveryEnabled, true);

  const mismatch = viewFor({}, "loc_other");
  assert.equal(mismatch.snapshotLoaded, false);
  assert.equal(mismatch.verified, false);
  assert.equal(mismatch.fields.every((field) => field.status === "unverified" && field.savedId), true);
  assert.equal(mismatch.active, true);
  assert.equal(mismatch.deliveryEnabled, true);
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
