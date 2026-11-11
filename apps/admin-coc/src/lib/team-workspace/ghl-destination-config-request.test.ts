import assert from "node:assert/strict";
import test from "node:test";

import {
  assessGhlConfigSnapshotFreshness,
  buildGhlConfigSubmitBody,
  emptyGhlConfigDraft,
  ghlConfigRequestErrorMessage,
  parseGhlConfigHead,
  presentGhlConfigRequestProgress,
  presentGhlLocationPreview,
  reviewGhlConfigDraft,
  surveyMappingsComplete,
  type GhlConfigHead,
  type GhlLocationPreview,
} from "./ghl-destination-config-request.ts";
import { isGhlDestinationConfigRequestEnabled } from "./ghl-destination-config-request-env.ts";

const now = new Date("2026-11-10T12:00:00.000Z");
const freshAt = "2026-11-10T11:00:00.000Z";

test("the configuration request flag is exact true", () => {
  assert.equal(isGhlDestinationConfigRequestEnabled({ SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: "true" }), true);
  assert.equal(isGhlDestinationConfigRequestEnabled({ SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: " true " }), true);
  assert.equal(isGhlDestinationConfigRequestEnabled({}), false);
  assert.equal(isGhlDestinationConfigRequestEnabled({ SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: "TRUE" }), false);
  assert.equal(isGhlDestinationConfigRequestEnabled({ SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: "1" }), false);
});

test("snapshot freshness matches the 24 hour and five minute limits", () => {
  assert.equal(assessGhlConfigSnapshotFreshness(freshAt, now), "fresh");
  assert.equal(assessGhlConfigSnapshotFreshness(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), now), "fresh");
  assert.equal(assessGhlConfigSnapshotFreshness(new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1).toISOString(), now), "expired");
  assert.equal(assessGhlConfigSnapshotFreshness(new Date(now.getTime() + 5 * 60 * 1000).toISOString(), now), "fresh");
  assert.equal(assessGhlConfigSnapshotFreshness(new Date(now.getTime() + 5 * 60 * 1000 + 1).toISOString(), now), "future");
  assert.equal(assessGhlConfigSnapshotFreshness("not-a-time", now), "malformed");
  assert.equal(assessGhlConfigSnapshotFreshness(null, now), "malformed");
});

test("a preview from another location is not used, and a name is not a field id", () => {
  const other = presentGhlLocationPreview({
    locationId: "loc_other",
    reportedLocationId: "loc_saved",
    workflows: [{ id: "wf_other", name: "Intake Webform" }],
    customFields: [{ id: "field_coverage", name: "Desired Coverage", fieldKey: "contact.desired_coverage" }],
    fetchedAt: freshAt,
  });
  assert.equal(other, null);
  const preview = presentGhlLocationPreview({
    locationId: "loc_other",
    reportedLocationId: "loc_other",
    workflows: [{ id: "wf_web", name: "Intake Webform" }, { name: "Missing id" }],
    customFields: [
      { id: "field_coverage", name: "Desired Coverage", fieldKey: "contact.desired_coverage" },
      { name: "No id", fieldKey: "contact.no_id" },
    ],
    fetchedAt: freshAt,
    fromCache: false,
    errors: [],
  });
  assert.ok(preview);
  assert.equal(preview?.workflows.some((workflow) => workflow.id === "wf_web"), true);
  assert.equal(preview?.workflows.some((workflow) => workflow.name === "Missing id"), false);
  const review = reviewGhlConfigDraft({
    draft: { ...emptyGhlConfigDraft(), locationId: "loc_saved", workflowId: "wf_web" },
    preview,
    locations: [connected("loc_saved")],
    liveDestination: false,
    head: head(),
    now,
  });
  assert.equal(review.snapshotStatus, "missing");
  assert.match(review.snapshotDetail, /another location is not used/i);
  assert.equal(review.rows.find((row) => row.key === "desired_coverage")?.fieldId, null);
  assert.equal(review.canSubmit, false);
});

test("webform names, duplicate ids, unresolved keys, and the three survey fields stay distinct", () => {
  const preview = readyPreview();
  const named = reviewGhlConfigDraft({
    draft: { locationId: "loc_other", workflowId: "", mappings: {} },
    preview,
    locations: [connected("loc_other")],
    liveDestination: false,
    head: head(),
    now,
  });
  assert.equal(named.workflowStatus, "missing");
  assert.match(named.webformNote ?? "", /not selected until you choose its id/i);
  assert.equal(named.rows.find((row) => row.key === "desired_coverage")?.status, "name_only");
  assert.equal(named.rows.find((row) => row.key === "branch_of_service")?.status, "name_only");
  assert.equal(named.rows.find((row) => row.key === "primary_reason")?.status, "name_only");
  assert.notEqual(
    named.rows.find((row) => row.key === "desired_coverage")?.key,
    named.rows.find((row) => row.key === "branch_of_service")?.key
  );

  const unresolved = reviewGhlConfigDraft({
    draft: {
      locationId: "loc_other",
      workflowId: "wf_missing",
      mappings: {
        desired_coverage: "contact.desired_coverage",
        branch_of_service: "Desired Coverage",
        primary_reason: "field_coverage",
      },
    },
    preview,
    locations: [connected("loc_other")],
    liveDestination: false,
    head: head(),
    now,
  });
  assert.equal(unresolved.workflowStatus, "unresolved");
  assert.match(unresolved.rows.find((row) => row.key === "desired_coverage")?.detail ?? "", /field key/i);
  assert.match(unresolved.rows.find((row) => row.key === "branch_of_service")?.detail ?? "", /display name/i);
  assert.equal(unresolved.rows.find((row) => row.key === "primary_reason")?.status, "ready");
  assert.equal(unresolved.rows.find((row) => row.key === "branch_of_service")?.fieldId, "Desired Coverage");
  assert.equal(unresolved.canSubmit, false);

  const duplicate = reviewGhlConfigDraft({
    draft: {
      locationId: "loc_other",
      workflowId: "wf_exact",
      mappings: {
        desired_coverage: "field_coverage",
        branch_of_service: "field_coverage",
        primary_reason: "field_reason",
      },
    },
    preview,
    locations: [connected("loc_other")],
    liveDestination: false,
    head: head(),
    now,
  });
  assert.equal(duplicate.rows.find((row) => row.key === "desired_coverage")?.status, "duplicate");
  assert.equal(duplicate.rows.find((row) => row.key === "branch_of_service")?.status, "duplicate");
  assert.equal(surveyMappingsComplete([
    { key: "desired_coverage", fieldId: "field_coverage" },
    { key: "branch_of_service", fieldId: "field_coverage" },
    { key: "primary_reason", fieldId: "field_reason" },
  ]), false);
});

test("progress follows the stored request and never treats it as applied", () => {
  const empty = presentGhlConfigRequestProgress(head());
  assert.equal(empty.find((step) => step.id === "request_saved")?.state, "waiting");
  assert.equal(empty.find((step) => step.id === "awaiting_application")?.state, "waiting");
  const stored = presentGhlConfigRequestProgress(head({
    configuration: {
      requestId: "11111111-1111-4111-8111-111111111111",
      revision: 4,
      locationId: "loc_other",
      workflowId: "wf_exact",
      fieldMappings: [
        { key: "branch_of_service", fieldId: "field_branch" },
        { key: "desired_coverage", fieldId: "field_coverage" },
        { key: "primary_reason", fieldId: "field_reason" },
      ],
      snapshotFetchedAt: freshAt,
      createdAt: freshAt,
    },
  }));
  assert.equal(stored.find((step) => step.id === "location_selected")?.state, "complete");
  assert.equal(stored.find((step) => step.id === "workflow_selected")?.state, "complete");
  assert.equal(stored.find((step) => step.id === "fields_mapped")?.state, "complete");
  assert.equal(stored.find((step) => step.id === "request_saved")?.state, "complete");
  assert.equal(stored.find((step) => step.id === "awaiting_application")?.state, "current");
  assert.match(stored.find((step) => step.id === "request_saved")?.detail ?? "", /not an operational destination/i);
  assert.equal(stored.some((step) => /active|verified/i.test(step.label)), false);
});

test("a live destination and a disconnected location block the draft without rewriting ids", () => {
  const body = buildGhlConfigSubmitBody({
    requestId: "11111111-1111-4111-8111-111111111111",
    head: head(),
    draft: {
      locationId: "loc_other",
      workflowId: "wf_exact",
      mappings: { desired_coverage: "contact.desired_coverage", primary_reason: "field_reason", branch_of_service: "field_branch" },
    },
  });
  assert.equal(body?.fieldMappings.find((row) => row.key === "desired_coverage")?.fieldId, "contact.desired_coverage");
  const live = reviewGhlConfigDraft({
    draft: { locationId: "loc_other", workflowId: "wf_exact", mappings: {} },
    preview: readyPreview(),
    locations: [],
    liveDestination: true,
    head: head({ liveDestination: true }),
    now,
  });
  assert.match(live.blockers.join(" "), /live operational destination/i);
  assert.match(live.locationDetail, /does not link a client/i);
  const expired = reviewGhlConfigDraft({
    draft: {
      locationId: "loc_other",
      workflowId: "wf_exact",
      mappings: {
        desired_coverage: "field_coverage",
        branch_of_service: "field_branch",
        primary_reason: "field_reason",
      },
    },
    preview: { ...readyPreview(), fetchedAt: "2020-01-01T00:00:00.000Z" },
    locations: [connected("loc_other")],
    liveDestination: false,
    head: head(),
    now,
  });
  assert.equal(expired.snapshotStatus, "expired");
  assert.equal(expired.canSubmit, false);
});

test("a previously captured snapshot is not current verification", () => {
  const preview = {
    ...readyPreview(),
    fromCache: true,
    snapshotVerification: "previously_captured" as const,
    errors: ["This snapshot was previously captured for this location. It is not current GoHighLevel verification."],
  };
  const review = reviewGhlConfigDraft({
    draft: {
      locationId: "loc_other",
      workflowId: "wf_exact",
      mappings: {
        desired_coverage: "field_coverage",
        branch_of_service: "field_branch",
        primary_reason: "field_reason",
      },
    },
    preview,
    locations: [connected("loc_other")],
    liveDestination: false,
    head: head(),
    now,
  });
  assert.equal(review.snapshotStatus, "previously_captured");
  assert.match(review.snapshotDetail, /not current GoHighLevel verification/);
  assert.equal(review.canSubmit, false);
  assert.match(ghlConfigRequestErrorMessage("snapshot_not_current"), /not a complete GoHighLevel discovery/);
});

test("a head that claims delivery or enrollment changed is not readable", () => {
  const readable = parseGhlConfigHead(rawHead());
  assert.equal(readable?.revision, 2);
  assert.equal(readable?.configuration, null);
  const armed = parseGhlConfigHead({ ...rawHead(), deliveryArmed: true });
  assert.equal(armed, null);
  const enrolled = parseGhlConfigHead({ ...rawHead(), enrollmentPerformed: true });
  assert.equal(enrolled, null);
});

function connected(locationId: string) {
  return { locationId, locationName: locationId, connectionStatus: "connected", lastError: null };
}

function head(overrides: Partial<GhlConfigHead> = {}): GhlConfigHead {
  return {
    clientAccountId: "phase2j_demo",
    revision: 2,
    destinationUpdatedAt: freshAt,
    liveDestination: false,
    configuration: null,
    ...overrides,
  };
}

function rawHead() {
  return {
    ...head(),
    ok: true,
    destinationUpdated: false,
    deliveryArmed: false,
    enrollmentPerformed: false,
    routingChanged: false,
    liveDestinationChanged: false,
  };
}

function readyPreview(): GhlLocationPreview {
  return {
    locationId: "loc_other",
    fetchedAt: freshAt,
    fromCache: false,
    snapshotVerification: null,
    workflows: [
      { id: "wf_web", name: "Intake Webform" },
      { id: "wf_exact", name: "Exact workflow" },
    ],
    fields: [
      { id: "field_coverage", name: "Desired Coverage", key: null, fieldKey: "contact.desired_coverage" },
      { id: "field_branch", name: "Branch of Service", key: null, fieldKey: "contact.branch_of_service" },
      { id: "field_reason", name: "Primary Reason", key: null, fieldKey: "contact.primary_reason" },
    ],
    errors: [],
  };
}
